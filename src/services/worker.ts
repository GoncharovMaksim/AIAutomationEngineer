import { EventEmitter } from 'events';
import { metacriticScraper } from './metacritic.js';
import { geminiService } from './gemini.js';
import { youtubeService } from './youtube.js';
import { gameRepository } from '../db/gameRepository.js';
import { db } from '../db/database.js';

export interface WorkerProgressEvent {
  status: 'idle' | 'running' | 'completed' | 'error';
  currentGame: string;
  currentStep: string;
  processedCount: number;
  totalTarget: number;
  todayDate: string;
  seeAllPage: number;
}

export class CrawlWorker extends EventEmitter {
  private isRunning = false;

  get running() {
    return this.isRunning;
  }

  /**
   * Main entrypoint for processing 20 games
   */
  async runJob(isManual = false): Promise<boolean> {
    if (this.isRunning) {
      this.log('warn', 'Worker run requested, but a job is already in progress.');
      return false;
    }

    this.isRunning = true;
    const today = new Date().toISOString().split('T')[0];
    let state = gameRepository.getCrawlState();

    // Check if new day started
    if (state.last_run_date !== today) {
      this.log('info', `New day detected (${today} vs ${state.last_run_date}). Resetting daily crawl state.`);
      gameRepository.updateCrawlState({
        last_run_date: today,
        see_all_page: 1,
        total_processed_today: 0,
        status: 'running',
        current_step: 'New day initialized'
      });
      state = gameRepository.getCrawlState();
    } else {
      gameRepository.updateCrawlState({
        status: 'running',
        current_step: isManual ? 'Manual run started' : 'Hourly run started'
      });
    }

    this.emitProgress('running', '', 'Starting batch processing', 0, 20);

    try {
      // Determine which source to use
      let gameUrls: string[] = [];
      const isFirstBatchToday = state.total_processed_today === 0;

      if (isFirstBatchToday) {
        this.log('info', 'Batch 1 of the day: Scraping Games / New Releases section...');
        this.emitProgress('running', '', 'Scraping New Releases', 0, 20);
        gameUrls = await metacriticScraper.getNewReleasesUrls();
      }

      // If New Releases had fewer than 20 or if this is subsequent batch today, fetch from SEE ALL
      if (gameUrls.length < 20) {
        const pageToFetch = isFirstBatchToday ? 1 : state.see_all_page;
        this.log('info', `Fetching additional games from SEE ALL (page ${pageToFetch})...`);
        this.emitProgress('running', '', `Scraping SEE ALL page ${pageToFetch}`, 0, 20);
        const seeAllUrls = await metacriticScraper.getSeeAllPageUrls(pageToFetch);
        gameUrls = [...new Set([...gameUrls, ...seeAllUrls])];

        // Advance see_all_page for subsequent runs
        gameRepository.updateCrawlState({ see_all_page: pageToFetch + 1 });
      }

      this.log('info', `Discovered ${gameUrls.length} total potential game links. Filtering unprocessed today...`);

      // Filter out games already processed today
      const alreadyProcessedToday = new Set(
        (db.prepare('SELECT id FROM games WHERE last_processed_date = ?').all(today) as { id: string }[]).map(r => r.id)
      );

      const targetUrls: string[] = [];
      for (const url of gameUrls) {
        const slugMatch = url.match(/\/game\/([a-z0-9-]+)/i);
        const slug = slugMatch ? slugMatch[1].toLowerCase() : '';
        if (slug && !alreadyProcessedToday.has(slug)) {
          targetUrls.push(url);
          if (targetUrls.length >= 20) break;
        }
      }

      this.log('info', `Selected ${targetUrls.length} new games to process today (target: 20).`);

      if (targetUrls.length === 0) {
        this.log('info', 'No new unprocessed games found in current pages. Next hourly run will check further pages.');
        gameRepository.updateCrawlState({
          status: 'idle',
          current_step: 'No new games today',
          current_game: ''
        });
        this.emitProgress('idle', '', 'Finished (no new games)', 0, 20);
        this.isRunning = false;
        return true;
      }

      // Process each game
      let processedInThisRun = 0;

      for (let i = 0; i < targetUrls.length; i++) {
        const url = targetUrls[i];
        const stepIndex = i + 1;
        this.log('info', `[${stepIndex}/${targetUrls.length}] Scraping: ${url}`);
        this.emitProgress('running', url, `Scraping details (${stepIndex}/${targetUrls.length})`, stepIndex, targetUrls.length);

        try {
          // 1. Scrape Metacritic details
          const scraped = await metacriticScraper.scrapeGameDetails(url, today);
          if (!scraped) {
            this.log('warn', `Could not parse data for ${url}, skipping.`);
            continue;
          }

          const { gameInput, criticReviews, userReviews } = scraped;
          this.emitProgress('running', gameInput.title, `AI Review Analysis (${stepIndex}/${targetUrls.length})`, stepIndex, targetUrls.length);

          // 2. Compute Embedding for Similar Games
          const embeddingText = `${gameInput.title}. Developer: ${gameInput.developer}. Platforms: ${gameInput.platforms.map(p => p.platform).join(', ')}. ${gameInput.description || ''}`;
          try {
            const emb = await geminiService.getEmbedding(embeddingText);
            if (emb) gameInput.embedding = emb;
          } catch (embErr: any) {
            this.log('warn', `Embedding generation skipped for ${gameInput.title}: ${embErr.message}`);
          }

          // 3. Save / Update game in SQLite
          gameRepository.upsertGame(gameInput);
          this.log('success', `Saved game "${gameInput.title}" to database.`);

          // 4. AI Summarize Critic and User Reviews
          try {
            const reviewsSummary = await geminiService.summarizeReviews(gameInput.title, criticReviews, userReviews);
            gameRepository.upsertReviewsSummary({
              gameId: gameInput.id,
              criticsSummaryPros: reviewsSummary.criticsSummaryPros,
              criticsSummaryCons: reviewsSummary.criticsSummaryCons,
              usersSummaryPros: reviewsSummary.usersSummaryPros,
              usersSummaryCons: reviewsSummary.usersSummaryCons
            });
            this.log('success', `Generated AI reviews summary for "${gameInput.title}".`);
          } catch (sumErr: any) {
            this.log('warn', `Failed to summarize reviews for "${gameInput.title}": ${sumErr.message}`);
          }

          // 5. Additional Part 1: YouTube Let's Play & Blogger Conclusion
          this.emitProgress('running', gameInput.title, `YouTube Let's Play Analysis (${stepIndex}/${targetUrls.length})`, stepIndex, targetUrls.length);
          try {
            const youtubeResult = await youtubeService.findAndAnalyzeLetsPlay(gameInput.id, gameInput.title);
            if (youtubeResult) {
              gameRepository.upsertYoutubeLetsplay(youtubeResult);
              this.log('success', `Found & analyzed YouTube Let's Play for "${gameInput.title}" (${youtubeResult.videoTitle}).`);
            }
          } catch (ytErr: any) {
            this.log('warn', `YouTube processing error for "${gameInput.title}": ${ytErr.message}`);
          }

          processedInThisRun++;
          const newTotalToday = (gameRepository.getCrawlState().total_processed_today || 0) + 1;
          gameRepository.updateCrawlState({
            total_processed_today: newTotalToday,
            current_game: gameInput.title
          });

          // Polite delay between games
          await new Promise(res => setTimeout(res, 1500));
        } catch (itemErr: any) {
          this.log('error', `Error processing game at ${url}: ${itemErr.message}`);
        }
      }

      this.log('success', `Batch complete! Successfully processed ${processedInThisRun} games.`);
      gameRepository.updateCrawlState({
        status: 'idle',
        current_step: `Completed batch of ${processedInThisRun} games`,
        current_game: ''
      });
      this.emitProgress('idle', '', `Completed (${processedInThisRun} games processed)`, processedInThisRun, targetUrls.length);
      return true;
    } catch (err: any) {
      this.log('error', `Critical worker error: ${err.message}`);
      gameRepository.updateCrawlState({
        status: 'error',
        current_step: `Error: ${err.message}`
      });
      this.emitProgress('error', '', `Error: ${err.message}`, 0, 20);
      return false;
    } finally {
      this.isRunning = false;
      await metacriticScraper.close();
    }
  }

  private log(level: 'info' | 'warn' | 'error' | 'success', message: string, gameId?: string) {
    console.log(`[Worker][${level.toUpperCase()}] ${message}`);
    gameRepository.addWorkerLog(level, message, gameId);
    this.emit('log', { level, message, gameId, timestamp: new Date().toISOString() });
  }

  private emitProgress(
    status: 'idle' | 'running' | 'completed' | 'error',
    currentGame: string,
    currentStep: string,
    processedCount: number,
    totalTarget: number
  ) {
    const state = gameRepository.getCrawlState();
    const event: WorkerProgressEvent = {
      status,
      currentGame,
      currentStep,
      processedCount,
      totalTarget,
      todayDate: state.last_run_date,
      seeAllPage: state.see_all_page
    };
    this.emit('progress', event);
  }
}

export const crawlWorker = new CrawlWorker();
