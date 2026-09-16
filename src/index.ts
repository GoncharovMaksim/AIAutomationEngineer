import http from 'http';
import { config, validateConfig } from './config.js';
import { gameRepository } from './db/gameRepository.js';
import { createApp } from './server/app.js';
import { setupWebSocket, closeWebSocketServer } from './server/ws.js';
import { startScheduler } from './services/scheduler.js';
import { metacriticScraper } from './services/metacritic.js';

async function bootstrap() {
  console.log('--- Metacritic AI Game Analyzer Server ---');
  console.log(`Node environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Port: ${config.port}`);

  // Validate environment variables
  validateConfig();

  // 1. Initialize Database (Dual-Driver: PostgreSQL or SQLite WAL)
  await gameRepository.init();
  console.log('[DB] Database initialized successfully.');

  // 2. Setup Express & HTTP Server
  const app = createApp();
  const server = http.createServer(app);

  // 3. Setup WebSocket for real-time monitoring
  setupWebSocket(server);

  // 4. Start cron hourly scheduler
  startScheduler();

  // 5. Start listening
  server.listen(config.port, () => {
    console.log(`[Server] Server listening on http://localhost:${config.port}`);
    console.log(`[Server] Healthcheck: http://localhost:${config.port}/health`);
    console.log(`[Server] REST API available at http://localhost:${config.port}/api/games`);
    console.log(`[Server] WebSocket available at ws://localhost:${config.port}/ws`);
  });

  // Graceful Shutdown handling (SIGTERM & SIGINT)
  let isShuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

    try {
      server.close(() => {
        console.log('[Server] HTTP server closed.');
      });

      await closeWebSocketServer();
      console.log('[Server] WebSockets closed.');

      await metacriticScraper.close();
      console.log('[Server] Puppeteer browser closed.');

      await gameRepository.close();
      console.log('[Server] Database connections closed.');

      console.log('[Server] Graceful shutdown completed cleanly.');
      process.exit(0);
    } catch (shutdownErr) {
      console.error('[Server] Error during graceful shutdown:', shutdownErr);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Fatal startup error:', err);
  process.exit(1);
});
