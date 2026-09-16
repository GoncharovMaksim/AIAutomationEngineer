import cron from 'node-cron';
import { crawlWorker } from './worker.js';
import { gameRepository } from '../db/gameRepository.js';

export function startScheduler() {
  console.log('[Scheduler] Initializing cron job: running every hour (0 * * * *)');

  // Run once every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Triggering scheduled hourly game crawling job...');
    await crawlWorker.runJob(false);
  });

  // Check if database has 0 games on startup, and trigger initial run automatically if idle
  const allGames = gameRepository.getAllGames();
  if (allGames.length === 0) {
    console.log('[Scheduler] Database is empty on startup. Triggering initial 20 games crawl...');
    setTimeout(() => {
      crawlWorker.runJob(false).catch(err => {
        console.error('[Scheduler] Initial crawl failed:', err);
      });
    }, 2000);
  }
}
