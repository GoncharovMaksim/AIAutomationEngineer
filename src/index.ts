import http from 'http';
import { config } from './config.js';
import { initDatabase } from './db/database.js';
import { createApp } from './server/app.js';
import { setupWebSocket } from './server/ws.js';
import { startScheduler } from './services/scheduler.js';

async function bootstrap() {
  console.log('--- Metacritic AI Game Analyzer Server ---');
  console.log(`Node environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Port: ${config.port}`);

  // 1. Initialize SQLite schema
  initDatabase();
  console.log('[DB] SQLite database initialized successfully.');

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
    console.log(`[Server] REST API available at http://localhost:${config.port}/api/games`);
    console.log(`[Server] WebSocket available at ws://localhost:${config.port}/ws`);
  });
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Fatal startup error:', err);
  process.exit(1);
});
