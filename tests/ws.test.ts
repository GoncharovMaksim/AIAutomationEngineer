import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { WebSocket } from 'ws';
import { createApp } from '../src/server/app.js';
import { setupWebSocket, closeWebSocketServer } from '../src/server/ws.js';
import { crawlWorker } from '../src/services/worker.js';
import { gameRepository } from '../src/db/gameRepository.js';

describe('WebSocket Server & Broadcast Events', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    await gameRepository.init();
    const app = createApp();
    server = http.createServer(app);
    setupWebSocket(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await closeWebSocketServer();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('receives initial state on connection', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    const message = await new Promise<any>((resolve, reject) => {
      ws.on('message', (data) => {
        try {
          resolve(JSON.parse(data.toString()));
        } catch (e) {
          reject(e);
        }
      });
      ws.on('error', reject);
    });

    assert.equal(message.type, 'init');
    assert.ok(message.data);
    assert.ok(typeof message.data.isRunning === 'boolean');
    assert.ok(Array.isArray(message.data.logs));

    ws.close();
  });

  it('broadcasts crawl progress events to all connected clients', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    // Skip init message
    await new Promise<void>((resolve) => {
      ws.once('message', () => resolve());
    });

    // Listen for progress broadcast
    const progressPromise = new Promise<any>((resolve) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'progress') {
          resolve(parsed);
        }
      });
    });

    // Worker emits progress
    crawlWorker.emit('progress', {
      status: 'running',
      currentGame: 'Elden Ring',
      step: 'Scraping critic reviews (5/20)',
      currentStep: 5,
      totalSteps: 20
    });

    const event = await progressPromise;
    assert.equal(event.type, 'progress');
    assert.equal(event.data.status, 'running');
    assert.equal(event.data.currentGame, 'Elden Ring');
    assert.equal(event.data.currentStep, 5);
    assert.equal(event.data.totalSteps, 20);
    assert.ok(event.timestamp);

    ws.close();
  });

  it('broadcasts worker logs to all connected clients', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await new Promise<void>((resolve) => {
      ws.once('message', () => resolve());
    });

    const logPromise = new Promise<any>((resolve) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'log') {
          resolve(parsed);
        }
      });
    });

    crawlWorker.emit('log', {
      id: 9999,
      level: 'success',
      message: 'Test log broadcast verified',
      timestamp: new Date().toISOString()
    });

    const event = await logPromise;
    assert.equal(event.type, 'log');
    assert.equal(event.data.level, 'success');
    assert.equal(event.data.message, 'Test log broadcast verified');

    ws.close();
  });
});
