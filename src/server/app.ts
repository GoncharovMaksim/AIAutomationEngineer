import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { gameRepository } from '../db/gameRepository.js';
import { crawlWorker } from '../services/worker.js';

interface ClientQuota {
  freeRunsUsed: number;
  lastRunAt: number;
}

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // IP Quota Tracker for Free Demo Runs
  const clientQuotas = new Map<string, ClientQuota>();
  let lastManualRunTimestamp = 0;
  const MANUAL_RUN_COOLDOWN_MS = 60 * 1000;

  function getClientIp(req: express.Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }

  function isAdmin(req: express.Request): boolean {
    const token = req.headers['x-admin-key'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    return token === config.adminSecret;
  }

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
  app.get('/api/auth/status', (req, res) => {
    const admin = isAdmin(req);
    const ip = getClientIp(req);
    const quota = clientQuotas.get(ip) || { freeRunsUsed: 0, lastRunAt: 0 };
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

  // Admin Login endpoint
  app.post('/api/auth/login', (req, res) => {
    const { password } = req.body || {};
    if (password === config.adminSecret) {
      return res.json({
        success: true,
        token: config.adminSecret,
        message: 'Авторизация администратора успешна'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Неверный пароль. Для проверки используйте демо-пароль: skytec-admin-2026'
    });
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
    const quota = clientQuotas.get(ip) || { freeRunsUsed: 0, lastRunAt: 0 };

    // Check demo quota if not admin
    if (!admin && quota.freeRunsUsed >= config.demoMaxFreeRuns) {
      return res.status(403).json({
        success: false,
        code: 'QUOTA_EXCEEDED',
        message: `Демо-лимит (${config.demoMaxFreeRuns} бесплатных запуска) исчерпан. Пожалуйста, авторизуйтесь как администратор.`
      });
    }

    const now = Date.now();
    const lastRunForUser = admin ? lastManualRunTimestamp : Math.max(lastManualRunTimestamp, quota.lastRunAt);
    const elapsed = now - lastRunForUser;

    if (elapsed < MANUAL_RUN_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((MANUAL_RUN_COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({
        success: false,
        message: `Слишком частые запуски. Пожалуйста, подождите ${waitSeconds} сек. перед следующим запуском.`
      });
    }

    lastManualRunTimestamp = now;

    if (!admin) {
      quota.freeRunsUsed += 1;
      quota.lastRunAt = now;
      clientQuotas.set(ip, quota);
    }

    // Launch worker asynchronously
    crawlWorker.runJob(true).catch(err => {
      console.error('[API] Worker run error:', err);
    });

    const remaining = admin ? 999 : Math.max(0, config.demoMaxFreeRuns - quota.freeRunsUsed);

    res.json({
      success: true,
      message: 'Процесс сбора данных запущен в фоне.',
      isAdmin: admin,
      freeRunsRemaining: remaining
    });
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
