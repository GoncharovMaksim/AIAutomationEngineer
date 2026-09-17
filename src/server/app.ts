import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { gameRepository } from '../db/gameRepository.js';
import { crawlWorker } from '../services/worker.js';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import crypto from 'crypto';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Persistent IP Quota Tracker via GameRepository
  const MANUAL_RUN_COOLDOWN_MS = 60 * 1000;
  const activeAdminSessions = new Map<string, number>();

  function getClientIp(req: express.Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }

  function isAdmin(req: express.Request): boolean {
    const token = req.headers['x-admin-key'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (!token || typeof token !== 'string') return false;
    // Master admin key for CI/scripts OR active short-lived session token
    if (token === config.adminSecret) return true;
    const expiresAt = activeAdminSessions.get(token);
    if (expiresAt && expiresAt > Date.now()) {
      return true;
    }
    return false;
  }

  // Public API Rate Limiter (sliding window per IP)
  const apiRateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const RATE_LIMIT_MAX_REQUESTS = 150;

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of apiRateLimitMap.entries()) {
      if (now > data.resetAt) {
        apiRateLimitMap.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  if (cleanupInterval.unref) cleanupInterval.unref();

  const publicApiRateLimiter = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (isAdmin(req)) return next();

    const ip = getClientIp(req);
    const now = Date.now();
    let client = apiRateLimitMap.get(ip);

    if (!client || now > client.resetAt) {
      client = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
      apiRateLimitMap.set(ip, client);
    } else {
      client.count++;
    }

    const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - client.count);
    const resetSeconds = Math.ceil((client.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', resetSeconds.toString());

    if (client.count > RATE_LIMIT_MAX_REQUESTS) {
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Превышен лимит запросов (${RATE_LIMIT_MAX_REQUESTS} в минуту). Пожалуйста, подождите ${resetSeconds} сек.`
      });
    }

    next();
  };

  app.use('/api', publicApiRateLimiter);

  // Healthcheck endpoint for Docker / K8s / Cloud
  app.get('/health', async (req, res) => {
    try {
      const isDbHealthy = await gameRepository.isHealthy();
      res.status(isDbHealthy ? 200 : 503).json({
        status: isDbHealthy ? 'ok' : 'degraded',
        uptime: Math.round(process.uptime()),
        database: isDbHealthy ? 'connected' : 'error',
        memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      res.status(500).json({ status: 'error', error: err.message });
    }
  });

  // Auth Status check
  app.get('/api/auth/status', async (req, res) => {
    const admin = isAdmin(req);
    const ip = getClientIp(req);
    const quota = await gameRepository.getClientQuota(ip);
    const remaining = admin ? 999 : Math.max(0, config.demoMaxFreeRuns - quota.freeRunsUsed);

    res.json({
      success: true,
      data: {
        isAdmin: admin,
        maxFreeRuns: config.demoMaxFreeRuns,
        freeRunsRemaining: remaining,
        freeRunsUsed: quota.freeRunsUsed
      }
    });
  });

  // Admin Login endpoint (generates secure, short-lived session token)
  app.post('/api/auth/login', (req, res) => {
    const { password } = req.body || {};
    if (password === config.adminSecret) {
      const sessionToken = 'adm_' + crypto.randomBytes(24).toString('hex');
      activeAdminSessions.set(sessionToken, Date.now() + 24 * 60 * 60 * 1000);
      return res.json({
        success: true,
        token: sessionToken,
        message: 'Авторизация администратора успешна'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Неверный пароль администратора.'
    });
  });

  // Simple in-memory image cache to make repeated image requests instant
  const imageCache = new Map<string, { buffer: Buffer; contentType: string; expiresAt: number }>();

  // Image Proxy endpoint to bypass regional CDN blocks & hotlinking restrictions
  app.get('/api/proxy/image', async (req, res) => {
    const imageUrl = req.query.url as string;
    if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
      return res.status(400).send('Invalid url parameter');
    }

    const cached = imageCache.get(imageUrl);
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return res.send(cached.buffer);
    }

    const maxAttempts = config.proxies.length > 0 ? 3 : 1;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const proxy = config.selectAvailableProxy();
      try {
        const fetchOptions: any = {
          signal: AbortSignal.timeout(6000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.metacritic.com/',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          }
        };
        if (proxy) {
          fetchOptions.dispatcher = new ProxyAgent(proxy.url);
        }

        const imgRes = await undiciFetch(imageUrl, fetchOptions);
        if (imgRes.ok) {
          if (proxy) config.markProxySuccess(proxy.url);
          const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
          const arrayBuffer = await imgRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          imageCache.set(imageUrl, { buffer, contentType, expiresAt: Date.now() + 6 * 3600 * 1000 });

          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
          return res.send(buffer);
        } else {
          lastError = new Error(`HTTP ${imgRes.status} ${imgRes.statusText}`);
        }
      } catch (err: any) {
        if (proxy) config.markProxyFailed(proxy.url);
        lastError = err;
      }
    }

    // Fallback: direct attempt without proxy
    try {
      const directRes = await undiciFetch(imageUrl, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.metacritic.com/',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      });
      if (directRes.ok) {
        const contentType = directRes.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await directRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        imageCache.set(imageUrl, { buffer, contentType, expiresAt: Date.now() + 6 * 3600 * 1000 });
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        return res.send(buffer);
      }
    } catch (err: any) {
      lastError = err;
    }

    console.error(`[ImageProxy] All attempts failed for ${imageUrl}:`, lastError?.message);
    return res.status(502).send('Failed to proxy image');
  });

  // 1. Get all games with search, platform filter, and sorting
  app.get('/api/games', async (req, res) => {
    try {
      const { search, platform, sortBy, sortOrder, limit, offset } = req.query;
      const games = await gameRepository.getAllGames({
        search: search ? String(search) : undefined,
        platform: platform ? String(platform) : undefined,
        sortBy: sortBy as any,
        sortOrder: sortOrder as any,
        limit: limit ? parseInt(String(limit), 10) : undefined,
        offset: offset ? parseInt(String(offset), 10) : undefined
      });
      res.json({
        success: true,
        count: games.length,
        limit: limit ? parseInt(String(limit), 10) : undefined,
        offset: offset ? parseInt(String(offset), 10) : undefined,
        data: games
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Get distinct platforms for filter dropdown
  app.get('/api/platforms', async (req, res) => {
    try {
      const platforms = await gameRepository.getAllPlatforms();
      res.json({ success: true, data: platforms });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Get single game by ID (with platforms, AI reviews, YouTube, and similar games)
  app.get('/api/games/:id', async (req, res) => {
    try {
      const game = await gameRepository.getGameById(req.params.id);
      if (!game) {
        return res.status(404).json({ success: false, error: 'Game not found' });
      }
      res.json({ success: true, data: game });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Get worker status & recent logs (monitoring)
  app.get('/api/worker/status', async (req, res) => {
    try {
      const state = await gameRepository.getCrawlState();
      const logs = await gameRepository.getRecentLogs(50);
      res.json({
        success: true,
        data: {
          state,
          isRunning: crawlWorker.running,
          logs
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. Force run button trigger with Freemium quota (3 free runs) + Admin bypass
  app.post('/api/worker/run', async (req, res) => {
    if (crawlWorker.running) {
      return res.status(409).json({
        success: false,
        message: 'Процесс обработки уже выполняется!'
      });
    }

    const admin = isAdmin(req);
    const ip = getClientIp(req);
    const quota = await gameRepository.getClientQuota(ip);

    // Check demo quota if not admin
    if (!admin && quota.freeRunsUsed >= config.demoMaxFreeRuns) {
      return res.status(403).json({
        success: false,
        code: 'QUOTA_EXCEEDED',
        message: `Демо-лимит (${config.demoMaxFreeRuns} бесплатных запуска) исчерпан. Пожалуйста, авторизуйтесь как администратор.`
      });
    }

    const now = Date.now();
    const elapsed = now - (quota.lastRunAt || 0);

    if (elapsed < MANUAL_RUN_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((MANUAL_RUN_COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({
        success: false,
        message: `Слишком частые запуски. Пожалуйста, подождите ${waitSeconds} сек. перед следующим запуском.`
      });
    }

    let currentRunsUsed = quota.freeRunsUsed;
    // Always persist last_run_at timestamp to database to ensure cooldown survives process restarts
    const updated = await gameRepository.recordClientRun(admin ? 'admin' : ip);
    if (!admin) {
      currentRunsUsed = updated.freeRunsUsed;
    }

    const { deepScraping } = req.body || {};
    const deepScrapingOverride = typeof deepScraping === 'boolean' ? deepScraping : undefined;

    // Launch worker asynchronously
    crawlWorker.runJob(true, deepScrapingOverride).catch(err => {
      console.error('[API] Worker run error:', err);
    });

    const remaining = admin ? 999 : Math.max(0, config.demoMaxFreeRuns - currentRunsUsed);

    res.json({
      success: true,
      message: 'Процесс сбора данных запущен в фоне.',
      isAdmin: admin,
      freeRunsRemaining: remaining
    });
  });

  // Admin Restart endpoint (allows remote restart without SSH)
  app.post('/api/admin/restart', (req, res) => {
    if (!isAdmin(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    res.json({ success: true, message: 'Server restarting...' });
    setTimeout(() => {
      console.log('[Server] Admin triggered reload. Exiting process for PM2 restart...');
      process.exit(0);
    }, 500);
  });

  // Admin Database Reset endpoint (clears all games and starts clean 20-game crawl)
  app.post('/api/admin/reset-database', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    try {
      if (crawlWorker.running) {
        return res.status(409).json({ success: false, message: 'Сборщик уже выполняется. Дождитесь окончания.' });
      }
      await gameRepository.resetDatabase();
      const autoStart = req.query.autoStart === 'true' || req.body?.autoStart === true;
      if (autoStart) {
        crawlWorker.runJob(true).catch(err => console.error('[API] Auto-crawl error:', err));
      }
      res.json({
        success: true,
        message: autoStart
          ? 'База данных очищена! Автоматический сбор первых 20 игр запущен.'
          : 'База данных успешно очищена и состояние сброшено.'
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Serve Frontend build in production if available
  const frontendDist = path.resolve(process.cwd(), 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws') && req.path !== '/health') {
        res.sendFile(path.join(frontendDist, 'index.html'));
      } else {
        next();
      }
    });
  }

  return app;
}
