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
  // Returns a ProxyAgent with round-robin rotation if proxies are available
  getProxyAgent(): ProxyAgent | undefined {
    if (proxies.length > 0) {
      const selectedProxy = proxies[currentProxyIndex % proxies.length];
      currentProxyIndex++;
      return new ProxyAgent(selectedProxy.url);
    }
    return undefined;
  },
  rotateProxy(): void {
    if (proxies.length > 0) {
      currentProxyIndex = (currentProxyIndex + 1) % proxies.length;
    }
  },
  // Get active proxy URL with round-robin rotation
  getActiveProxyUrl(): string | undefined {
    if (proxies.length > 0) {
      return proxies[currentProxyIndex % proxies.length].url;
    }
    return undefined;
  }
};

export function validateConfig() {
  if (!config.geminiApiKey || config.geminiApiKey === 'your_gemini_api_key_here') {
    console.warn('[Config] ⚠️ WARNING: GEMINI_API_KEY is not configured or still set to placeholder in .env!');
  } else {
    console.log('[Config] ✅ GEMINI_API_KEY is present.');
  }

  if (proxies.length > 0) {
    console.log(`[Config] ✅ Configured ${proxies.length} proxy/proxies with round-robin rotation.`);
  } else {
    console.log('[Config] ℹ️ No proxies configured. Direct connections will be used.');
  }
}
