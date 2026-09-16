import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { gameRepository } from '../db/gameRepository.js';
import { crawlWorker } from '../services/worker.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API Routes
  // 1. Get all games with search, platform filter, and sorting
  app.get('/api/games', (req, res) => {
    try {
      const { search, platform, sortBy, sortOrder } = req.query;
      const games = gameRepository.getAllGames({
        search: search ? String(search) : undefined,
        platform: platform ? String(platform) : undefined,
        sortBy: sortBy as any,
        sortOrder: sortOrder as any
      });
      res.json({ success: true, data: games });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Get distinct platforms for filter dropdown
  app.get('/api/platforms', (req, res) => {
    try {
      const platforms = gameRepository.getAllPlatforms();
      res.json({ success: true, data: platforms });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Get single game by ID (with platforms, AI reviews, YouTube, and similar games)
  app.get('/api/games/:id', (req, res) => {
    try {
      const game = gameRepository.getGameById(req.params.id);
      if (!game) {
        return res.status(404).json({ success: false, error: 'Game not found' });
      }
      res.json({ success: true, data: game });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Get worker status & recent logs (monitoring)
  app.get('/api/worker/status', (req, res) => {
    try {
      const state = gameRepository.getCrawlState();
      const logs = gameRepository.getRecentLogs(50);
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

  // 5. Force run button trigger
  app.post('/api/worker/run', async (req, res) => {
    if (crawlWorker.running) {
      return res.status(409).json({
        success: false,
        message: 'Процесс обработки уже выполняется!'
      });
    }

    // Launch worker asynchronously
    crawlWorker.runJob(true).catch(err => {
      console.error('[API] Worker run error:', err);
    });

    res.json({
      success: true,
      message: 'Процесс сбора данных запущен в фоне.'
    });
  });

  // Serve Frontend build in production if available
  const frontendDist = path.resolve(process.cwd(), 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
        res.sendFile(path.join(frontendDist, 'index.html'));
      } else {
        next();
      }
    });
  }

  return app;
}
