import { EventEmitter } from 'events';
import crypto from 'crypto';
import { metacriticScraper } from './metacritic.js';
import { geminiService } from './gemini.js';
import { youtubeService } from './youtube.js';
import { gameRepository } from '../db/gameRepository.js';
import { config } from '../config.js';

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
      await this.log('warn', 'Worker run requested, but a job is already in progress.');
      return false;
    }

    this.isRunning = true;
    const today = new Date().toISOString().split('T')[0];
    let state = await gameRepository.getCrawlState();

    // Check if new day started
    if (state.last_run_date !== today) {
      await this.log('info', `New day detected (${today} vs ${state.last_run_date}). Resetting daily crawl state.`);
      await gameRepository.updateCrawlState({
        last_run_date: today,
        see_all_page: 1,
        total_processed_today: 0,
        status: 'running',
        current_step: 'New day initialized'
      });
      state = await gameRepository.getCrawlState();
    } else {
      // Enforce daily scheduled crawl limit (bypassed if manually triggered via web UI)
      if (!isManual && state.total_processed_today >= config.maxDailyCrawlGames) {
        await this.log('info', `[Scheduler] 🛑 Плановый дневной лимит (${config.maxDailyCrawlGames} игр) достигнут. Ожидание следующего дня. (Для принудительного запуска используйте кнопку в веб-интерфейсе).`);
        await gameRepository.updateCrawlState({
          status: 'idle',
          current_step: `Daily quota reached (${state.total_processed_today}/${config.maxDailyCrawlGames})`,
          current_game: ''
        });
        await this.emitProgress('idle', '', `Daily limit reached (${state.total_processed_today}/${config.maxDailyCrawlGames})`, state.total_processed_today, config.maxDailyCrawlGames);
        this.isRunning = false;
        return false;
      }

      await gameRepository.updateCrawlState({
        status: 'running',
        current_step: isManual ? 'Manual run started' : 'Hourly run started'
      });
    }

    await this.emitProgress('running', '', 'Starting batch processing', 0, 20);

    try {
      // Filter out games already processed today via repository abstraction
      const processedTodayIds = await gameRepository.getProcessedGameIdsForDate(today);
      const alreadyProcessedToday = new Set(processedTodayIds);

      const targetUrls: string[] = [];
      const seenSlugs = new Set<string>();

      const addCandidateUrls = (urls: string[]) => {
        for (const url of urls) {
          const slugMatch = url.match(/\/game\/([a-z0-9-]+)/i);
          const slug = slugMatch ? slugMatch[1].toLowerCase() : '';
          if (slug && !alreadyProcessedToday.has(slug) && !seenSlugs.has(slug)) {
            seenSlugs.add(slug);
            targetUrls.push(url);
            if (targetUrls.length >= 20) break;
          }
        }
      };

      const isFirstBatchToday = state.total_processed_today === 0;

      if (isFirstBatchToday) {
        await this.log('info', 'Batch 1 of the day: Scraping Games / New Releases section...');
        await this.emitProgress('running', '', 'Scraping New Releases', 0, 20);
        const newReleasesUrls = await metacriticScraper.getNewReleasesUrls();
        addCandidateUrls(newReleasesUrls);
      }

      // If New Releases had fewer than 20 or for subsequent batches today, loop through SEE ALL pages
      let pageToFetch = isFirstBatchToday ? 1 : state.see_all_page;
      const MAX_PAGES_TO_SCAN = 10;
      let pagesScanned = 0;

      while (targetUrls.length < 20 && pagesScanned < MAX_PAGES_TO_SCAN) {
        await this.log('info', `Scanning SEE ALL page ${pageToFetch} (found ${targetUrls.length}/20 target games)...`);
        await this.emitProgress('running', '', `Scraping SEE ALL page ${pageToFetch}`, targetUrls.length, 20);
        const seeAllUrls = await metacriticScraper.getSeeAllPageUrls(pageToFetch);
        if (!seeAllUrls || seeAllUrls.length === 0) {
          await this.log('info', `No more games found on SEE ALL page ${pageToFetch}.`);
          pageToFetch++;
          break;
        }

        addCandidateUrls(seeAllUrls);
        pageToFetch++;
        pagesScanned++;
      }

      // Advance see_all_page for subsequent runs
      await gameRepository.updateCrawlState({ see_all_page: pageToFetch });

      await this.log('info', `Selected ${targetUrls.length} new games to process today (target: 20).`);

      if (targetUrls.length === 0) {
        await this.log('info', 'No new unprocessed games found in current pages. Next hourly run will check further pages.');
        await gameRepository.updateCrawlState({
          status: 'idle',
          current_step: 'No new games today',
          current_game: ''
        });
        await this.emitProgress('idle', '', 'Finished (no new games)', 0, 20);
        this.isRunning = false;
        return true;
      }

      // Process each game
      let processedInThisRun = 0;

      for (let i = 0; i < targetUrls.length; i++) {
        const url = targetUrls[i];
        const stepIndex = i + 1;
        await this.log('info', `[${stepIndex}/${targetUrls.length}] Scraping: ${url}`);
        await this.emitProgress('running', url, `Scraping details (${stepIndex}/${targetUrls.length})`, stepIndex, targetUrls.length);

        try {
          // 1. Scrape Metacritic details
          const scraped = await metacriticScraper.scrapeGameDetails(url, today);
          if (!scraped) {
            await this.log('warn', `Could not parse data for ${url}, skipping.`);
            continue;
          }

          const { gameInput, criticReviews, userReviews } = scraped;
          const existingGame = await gameRepository.getGameById(gameInput.id);

          // 2. Compute Embedding for Similar Games (reuse existing to save quota)
          if (existingGame?.embedding) {
            gameInput.embedding = existingGame.embedding;
          } else {
            const embeddingText = `${gameInput.title}. Developer: ${gameInput.developer}. Platforms: ${gameInput.platforms.map(p => p.platform).join(', ')}. ${gameInput.description || ''}`;
            try {
              const emb = await geminiService.getEmbedding(embeddingText);
              if (emb) gameInput.embedding = emb;
            } catch (embErr: any) {
              await this.log('warn', `Embedding generation skipped for ${gameInput.title}: ${embErr.message}`);
            }
          }

          // 3. Save / Update game in Database
          await gameRepository.upsertGame(gameInput);
          await this.log('success', `Saved game "${gameInput.title}" to database.`);

          // 4. AI Summarize Critic and User Reviews (deduplicate via review hash)
          const reviewsPayload = `${criticReviews.join('||')}###${userReviews.join('||')}`;
          const reviewsHash = crypto.createHash('sha256').update(reviewsPayload).digest('hex');

          if (existingGame?.reviews && existingGame.reviews.reviews_hash === reviewsHash) {
            await this.log('info', `Reviews for "${gameInput.title}" unchanged. Reusing cached AI summary (tokens saved).`);
          } else {
            await this.emitProgress('running', gameInput.title, `AI Review Analysis (${stepIndex}/${targetUrls.length})`, stepIndex, targetUrls.length);
            try {
              const reviewsSummary = await geminiService.summarizeReviews(gameInput.title, criticReviews, userReviews);
              await gameRepository.upsertReviewsSummary({
                gameId: gameInput.id,
                criticsSummaryPros: reviewsSummary.criticsSummaryPros,
                criticsSummaryCons: reviewsSummary.criticsSummaryCons,
                usersSummaryPros: reviewsSummary.usersSummaryPros,
                usersSummaryCons: reviewsSummary.usersSummaryCons,
                reviewsHash
              });
              await this.log('success', `Generated AI reviews summary for "${gameInput.title}".`);
            } catch (sumErr: any) {
              await this.log('warn', `Failed to summarize reviews for "${gameInput.title}": ${sumErr.message}`);
            }
          }

          // 5. Additional Part 1: YouTube Let's Play & Blogger Conclusion (reuse if already analyzed)
          if (existingGame?.youtube && existingGame.youtube.video_id) {
            await this.log('info', `YouTube Let's Play for "${gameInput.title}" already analyzed. Preserving existing record.`);
          } else {
            await this.emitProgress('running', gameInput.title, `YouTube Let's Play Analysis (${stepIndex}/${targetUrls.length})`, stepIndex, targetUrls.length);
            try {
              const youtubeResult = await youtubeService.findAndAnalyzeLetsPlay(gameInput.id, gameInput.title);
              if (youtubeResult) {
                await gameRepository.upsertYoutubeLetsplay(youtubeResult);
                await this.log('success', `Found & analyzed YouTube Let's Play for "${gameInput.title}" (${youtubeResult.videoTitle}).`);
              }
            } catch (ytErr: any) {
              await this.log('warn', `YouTube processing error for "${gameInput.title}": ${ytErr.message}`);
            }
          }

          processedInThisRun++;
          const curState = await gameRepository.getCrawlState();
          const newTotalToday = (curState.total_processed_today || 0) + 1;
          await gameRepository.updateCrawlState({
            total_processed_today: newTotalToday,
            current_game: gameInput.title
          });

          // Polite delay between games
          await new Promise(res => setTimeout(res, 1500));
        } catch (itemErr: any) {
          await this.log('error', `Error processing game at ${url}: ${itemErr.message}`);
        }
      }

      // Maintenance: rotate logs and checkpoint WAL to save disk space
      try {
        await gameRepository.pruneOldLogs(500);
        await gameRepository.checkpointWal();
      } catch (maintErr: any) {
        console.warn('[Maintenance] DB maintenance warning:', maintErr.message);
      }

      await this.log('success', `Batch complete! Successfully processed ${processedInThisRun} games.`);
      await gameRepository.updateCrawlState({
        status: 'idle',
        current_step: `Completed batch of ${processedInThisRun} games`,
        current_game: ''
      });
      await this.emitProgress('idle', '', `Completed (${processedInThisRun} games processed)`, processedInThisRun, targetUrls.length);
      return true;
    } catch (err: any) {
      await this.log('error', `Critical worker error: ${err.message}`);
      await gameRepository.updateCrawlState({
        status: 'error',
        current_step: `Error: ${err.message}`
      });
      await this.emitProgress('error', '', `Error: ${err.message}`, 0, 20);
      return false;
    } finally {
      this.isRunning = false;
      await metacriticScraper.close();
    }
  }

  private async log(level: 'info' | 'warn' | 'error' | 'success', message: string, gameId?: string) {
    console.log(`[Worker][${level.toUpperCase()}] ${message}`);
    try {
      await gameRepository.addWorkerLog(level, message, gameId);
    } catch (err) {
      console.error('[Worker] Failed to write worker log to DB:', err);
    }
    this.emit('log', { level, message, gameId, timestamp: new Date().toISOString() });
  }

  private async emitProgress(
    status: 'idle' | 'running' | 'completed' | 'error',
    currentGame: string,
    currentStep: string,
    processedCount: number,
    totalTarget: number
  ) {
    let todayDate = new Date().toISOString().split('T')[0];
    let seeAllPage = 1;
    try {
      const state = await gameRepository.getCrawlState();
      todayDate = state.last_run_date;
      seeAllPage = state.see_all_page;
    } catch {}

    const event: WorkerProgressEvent = {
      status,
      currentGame,
      currentStep,
      processedCount,
      totalTarget,
      todayDate,
      seeAllPage
    };
    this.emit('progress', event);
  }
}

export const crawlWorker = new CrawlWorker();
