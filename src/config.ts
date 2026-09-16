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

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  headless: process.env.HEADLESS !== 'false',
  executablePath: process.env.EXECUTABLE_PATH || undefined,
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'metacritic_games.db'),
  proxies,
  // Returns a ProxyAgent if proxies are available
  getProxyAgent(): ProxyAgent | undefined {
    if (proxies.length > 0) {
      // Pick first proxy (or rotate)
      return new ProxyAgent(proxies[0].url);
    }
    return undefined;
  },
  // Get active proxy URL for puppeteer args if needed
  getActiveProxyUrl(): string | undefined {
    return proxies.length > 0 ? proxies[0].url : undefined;
  }
};
