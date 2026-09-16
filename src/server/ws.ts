import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { crawlWorker, WorkerProgressEvent } from '../services/worker.js';
import { gameRepository } from '../db/gameRepository.js';

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(type: string, data: any) {
    const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    // Send initial status and recent logs
    const state = gameRepository.getCrawlState();
    const recentLogs = gameRepository.getRecentLogs(50);

    ws.send(JSON.stringify({
      type: 'init',
      data: {
        state,
        isRunning: crawlWorker.running,
        logs: recentLogs.reverse()
      }
    }));
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
