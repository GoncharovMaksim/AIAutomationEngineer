import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProxyAgent } from 'undici';

// Load .env from project root
dotenv.config();

export interface ProxyInfo {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  url: string;
  failedUntil?: number;
  consecutiveFailures?: number;
}

export function parseProxyList(proxyListStr?: string): ProxyInfo[] {
  if (!proxyListStr) return [];
  const entries = proxyListStr.split(',').map(s => s.trim()).filter(Boolean);
  const proxies: ProxyInfo[] = [];

  for (const entry of entries) {
    const parts = entry.split(':');
    if (parts.length === 4) {
      // host:port:user:pass
      const [host, port, user, pass] = parts;
      proxies.push({
        host,
        port: parseInt(port, 10),
        user,
        pass,
        url: `http://${user}:${pass}@${host}:${port}`
      });
    } else if (parts.length === 2) {
      // host:port
      const [host, port] = parts;
      proxies.push({
        host,
        port: parseInt(port, 10),
        url: `http://${host}:${port}`
      });
    }
  }
  return proxies;
}

const proxies = parseProxyList(process.env.PROXY_LIST);

let currentProxyIndex = 0;

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  headless: process.env.HEADLESS !== 'false',
  executablePath: process.env.EXECUTABLE_PATH || undefined,
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'metacritic_games.db'),
  databaseUrl: process.env.DATABASE_URL || '',
  adminSecret: process.env.ADMIN_SECRET || 'skytec-admin-2026',
  demoMaxFreeRuns: parseInt(process.env.DEMO_MAX_FREE_RUNS || '3', 10),
  maxDailyCrawlGames: parseInt(process.env.MAX_DAILY_CRAWL_GAMES || '60', 10),
  proxies,

  // Mark a proxy as temporarily unavailable due to connection failure
  markProxyFailed(proxyUrl: string, baseCooldownMs = 45000): void {
    const p = proxies.find(item => item.url === proxyUrl || proxyUrl.includes(item.host));
    if (p) {
      p.consecutiveFailures = (p.consecutiveFailures || 0) + 1;
      const penalty = Math.min(baseCooldownMs * Math.pow(1.5, p.consecutiveFailures - 1), 180000);
      p.failedUntil = Date.now() + penalty;
      console.warn(`[ProxyPool] ⚠️ Proxy ${p.host}:${p.port} marked temporarily unavailable for ${Math.round(penalty / 1000)}s (failure #${p.consecutiveFailures})`);
    }
  },

  // Mark a proxy as healthy upon successful response
  markProxySuccess(proxyUrl: string): void {
    const p = proxies.find(item => item.url === proxyUrl || proxyUrl.includes(item.host));
    if (p) {
      if (p.consecutiveFailures || p.failedUntil) {
        console.log(`[ProxyPool] ✅ Proxy ${p.host}:${p.port} is responding normally, cooldown cleared.`);
      }
      p.consecutiveFailures = 0;
      p.failedUntil = 0;
    }
  },

  // Rotate to the next available proxy in round-robin order
  rotateProxy(): void {
    if (proxies.length > 0) {
      currentProxyIndex = (currentProxyIndex + 1) % proxies.length;
    }
  },

  // Pick the best available proxy (preferring those not in cooldown)
  selectAvailableProxy(): ProxyInfo | undefined {
    if (proxies.length === 0) return undefined;
    const now = Date.now();

    // 1. Search starting from currentProxyIndex for an available proxy
    for (let i = 0; i < proxies.length; i++) {
      const idx = (currentProxyIndex + i) % proxies.length;
      const p = proxies[idx];
      if (!p.failedUntil || now >= p.failedUntil) {
        return p;
      }
    }

    // 2. If all proxies are temporarily in cooldown, pick the one closest to recovery
    let bestIdx = 0;
    let minFailedUntil = Infinity;
    for (let i = 0; i < proxies.length; i++) {
      const p = proxies[i];
      if ((p.failedUntil || 0) < minFailedUntil) {
        minFailedUntil = p.failedUntil || 0;
        bestIdx = i;
      }
    }
    const fallback = proxies[bestIdx];
    fallback.failedUntil = 0; // reset cooldown to avoid stall
    return fallback;
  },

  // Get active proxy URL with health-aware round-robin rotation
  getActiveProxyUrl(): string | undefined {
    return this.selectAvailableProxy()?.url;
  },

  // Returns a ProxyAgent with health-aware round-robin rotation
  getProxyAgent(): ProxyAgent | undefined {
    const selected = this.selectAvailableProxy();
    return selected ? new ProxyAgent(selected.url) : undefined;
  },

  // Background health check that tests temporarily failed proxies periodically
  startProxyHealthChecker(intervalMs = 60000): void {
    if (proxies.length === 0) return;
    const timer = setInterval(async () => {
      const now = Date.now();
      const cooledDown = proxies.filter(p => p.failedUntil && now < p.failedUntil);
      if (cooledDown.length === 0) return;

      for (const p of cooledDown) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const agent = new ProxyAgent(p.url);
          const res = await fetch('https://www.metacritic.com/', {
            method: 'HEAD',
            dispatcher: agent,
            signal: controller.signal
          } as any);
          clearTimeout(timeout);
          if (res.status < 500) {
            p.failedUntil = 0;
            p.consecutiveFailures = 0;
            console.log(`[ProxyPool] ✅ Health check passed: Proxy ${p.host}:${p.port} has recovered and returned to active rotation!`);
          }
        } catch {
          // Still unavailable, keep cooldown active
        }
      }
    }, intervalMs);
    timer.unref?.();
  }
};

export function validateConfig() {
  if (!config.geminiApiKey || config.geminiApiKey === 'your_gemini_api_key_here') {
    console.warn('[Config] ⚠️ WARNING: GEMINI_API_KEY is not configured or still set to placeholder in .env!');
  } else {
    console.log('[Config] ✅ GEMINI_API_KEY is present.');
  }

  if (!process.env.ADMIN_SECRET || process.env.ADMIN_SECRET === 'skytec-admin-2026') {
    console.warn('[Config] ⚠️ WARNING: ADMIN_SECRET is not set or uses default demo value! Set a strong secret in .env for production.');
  } else {
    console.log('[Config] ✅ ADMIN_SECRET is configured.');
  }

  if (proxies.length > 0) {
    console.log(`[Config] ✅ Configured ${proxies.length} proxy/proxies with round-robin rotation.`);
  } else {
    console.log('[Config] ℹ️ No proxies configured. Direct connections will be used.');
  }
}
