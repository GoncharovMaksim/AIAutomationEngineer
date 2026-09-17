import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { createApp } from '../src/server/app.js';
import { gameRepository } from '../src/db/gameRepository.js';

describe('Auth, Quota & Health API Endpoints', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    await gameRepository.init();
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await gameRepository.close();
  });

  async function request(path: string, options: { method?: string; headers?: any; body?: any } = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await res.json();
    return { status: res.status, body, headers: res.headers };
  }

  it('GET /health returns 200 with database: connected', async () => {
    const { status, body } = await request('/health');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.database, 'connected');
    assert.ok(body.uptime >= 0);
  });

  it('GET /api/auth/status returns default 3 free runs for guest', async () => {
    const { status, body, headers } = await request('/api/auth/status');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.isAdmin, false);
    assert.strictEqual(body.data.maxFreeRuns, 3);
    assert.strictEqual(body.data.freeRunsRemaining, 3);
    assert.strictEqual(headers.get('x-ratelimit-limit'), '150');
    assert.ok(headers.get('x-ratelimit-remaining') !== null);
  });

  it('POST /api/auth/login rejects wrong password', async () => {
    const { status, body } = await request('/api/auth/login', {
      method: 'POST',
      body: { password: 'wrong-password' }
    });
    assert.strictEqual(status, 401);
    assert.strictEqual(body.success, false);
  });

  it('POST /api/auth/login accepts demo admin password and returns secure session token', async () => {
    const { status, body } = await request('/api/auth/login', {
      method: 'POST',
      body: { password: 'skytec-admin-2026' }
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.ok(body.token && body.token.startsWith('adm_'), 'Token must be an opaque session token');

    // Verify session token works for authentication
    const authCheck = await request('/api/auth/status', {
      headers: { 'x-admin-key': body.token }
    });
    assert.strictEqual(authCheck.status, 200);
    assert.strictEqual(authCheck.body.data.isAdmin, true);
    assert.strictEqual(authCheck.body.data.freeRunsRemaining, 999);
  });

  it('GET /api/auth/status detects master admin key', async () => {
    const { status, body } = await request('/api/auth/status', {
      headers: { 'x-admin-key': 'skytec-admin-2026' }
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.isAdmin, true);
    assert.strictEqual(body.data.freeRunsRemaining, 999);
  });

  it('GET /api/games includes standard RateLimit headers for public clients', async () => {
    const { status, headers } = await request('/api/games');
    assert.strictEqual(status, 200);
    assert.strictEqual(headers.get('x-ratelimit-limit'), '150');
    const remaining = parseInt(headers.get('x-ratelimit-remaining') || '0', 10);
    assert.ok(remaining < 150 && remaining >= 0);
  });
});
