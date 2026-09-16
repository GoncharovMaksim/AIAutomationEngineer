import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { crawlWorker, WorkerProgressEvent } from '../services/worker.js';
import { gameRepository } from '../db/gameRepository.js';

let activeWss: WebSocketServer | null = null;

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  activeWss = wss;

  function broadcast(type: string, data: any) {
    const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  wss.on('connection', async (ws: WebSocket) => {
    try {
      // Send initial status and recent logs
      const state = await gameRepository.getCrawlState();
      const recentLogs = await gameRepository.getRecentLogs(50);

      ws.send(JSON.stringify({
        type: 'init',
        data: {
          state,
          isRunning: crawlWorker.running,
          logs: recentLogs.reverse()
        }
      }));
    } catch (err) {
      console.error('[WebSocket] Error sending initial state:', err);
    }
  });

  // Forward worker events
  crawlWorker.on('progress', (event: WorkerProgressEvent) => {
    broadcast('progress', event);
  });

  crawlWorker.on('log', (logEntry) => {
    broadcast('log', logEntry);
  });

  console.log('[WebSocket] Real-time WebSocket server initialized on /ws');
  return wss;
}

export function closeWebSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!activeWss) return resolve();
    for (const client of activeWss.clients) {
      try {
        client.terminate();
      } catch {}
    }
    activeWss.close(() => {
      activeWss = null;
      resolve();
    });
  });
}
