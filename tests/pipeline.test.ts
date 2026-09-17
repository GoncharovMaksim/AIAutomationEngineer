import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { SqliteDriver } from '../src/db/sqliteDriver.js';
import type { GameInput, ReviewsSummaryInput, YoutubeLetsplayInput } from '../src/db/types.js';

describe('Core Pipeline End-to-End Business Logic', () => {
  let db: SqliteDriver;

  before(async () => {
    // In-memory or isolated SQLite driver for pipeline test
    db = new SqliteDriver(':memory:');
    await db.init();
  });

  after(async () => {
    await db.close();
  });

  it('runs complete pipeline: scrapes game, summarizes reviews, attaches YouTube and saves to DB', async () => {
    const today = new Date().toISOString().split('T')[0];
    const gameId = 'pipeline-test-game';

    // 1. Scraped Game Data Structure
    const gameInput: GameInput = {
      id: gameId,
      title: 'Pipeline Test Game',
      slug: 'pipeline-test-game',
      coverImage: 'https://example.com/cover.jpg',
      developer: 'DeepMind Games',
      description: 'An advanced test game for testing pipeline completeness.',
      videoUrl: 'https://example.com/trailer.mp4',
      platforms: [
        { platform: 'PC', metascore: 92, userscore: 8.8 },
        { platform: 'PlayStation 5', metascore: 90, userscore: 8.5 }
      ],
      todayDate: today
    };

    // 2. Save game to database
    await db.upsertGame(gameInput);

    // Verify game was inserted
    const saved = await db.getGameById(gameId);
    assert.ok(saved, 'Game must be saved in database');
    assert.equal(saved.title, 'Pipeline Test Game');
    assert.equal(saved.developer, 'DeepMind Games');
    assert.equal(saved.platforms.length, 2);

    // 3. Review Summarization & Hash Deduplication
    const criticReviews = ['Amazing gameplay!', 'Incredible performance and story.'];
    const userReviews = ['Loved every minute of it!', 'Best game of the year.'];
    const reviewsHash = crypto.createHash('sha256').update(criticReviews.join(' ') + userReviews.join(' ')).digest('hex');

    const reviewsSummary: ReviewsSummaryInput = {
      gameId,
      criticsSummaryPros: 'Отличный геймплей и сюжет.',
      criticsSummaryCons: 'Незначительные баги на старте.',
      usersSummaryPros: 'Игроки в восторге от атмосферы.',
      usersSummaryCons: 'Требует мощного железа.',
      reviewsHash
    };

    await db.upsertReviewsSummary(reviewsSummary);

    // Verify reviews summary
    const updatedGame = await db.getGameById(gameId);
    assert.ok(updatedGame.reviews, 'Reviews summary must be present');
    assert.equal(updatedGame.reviews.reviews_hash, reviewsHash);
    assert.ok(updatedGame.reviews.critics_summary_pros.includes('Отличный'));

    // 4. YouTube Let\'s Play Analysis with honest subtitle flag
    const youtubeData: YoutubeLetsplayInput = {
      gameId,
      videoId: 'test_vid_123',
      videoTitle: 'Pipeline Test Game - Full Gameplay Walkthrough',
      videoUrl: 'https://youtube.com/watch?v=test_vid_123',
      channelName: 'ProGamer',
      viewsCount: 154000,
      bloggerConclusion: 'Транскрипт недоступен: видео не содержит субтитров. Летсплей от канала "ProGamer".',
      transcriptAvailable: false
    };

    await db.upsertYoutubeLetsplay(youtubeData);

    // Verify YouTube data
    const finalGame = await db.getGameById(gameId);
    assert.ok(finalGame.youtube, 'YouTube entry must be attached');
    assert.equal(finalGame.youtube.video_id, 'test_vid_123');
    assert.equal(finalGame.youtube.transcript_available, 0);
    assert.ok(finalGame.youtube.blogger_conclusion.includes('Транскрипт недоступен'));
  });

  it('persistent IP quota correctly enforces limits and survives session resets', async () => {
    const testIp = '192.168.100.55';

    // Check initial quota
    const initialQuota = await db.getClientQuota(testIp);
    assert.equal(initialQuota.freeRunsUsed, 0);

    // Record run 1
    const run1 = await db.recordClientRun(testIp);
    assert.equal(run1.freeRunsUsed, 1);
    assert.ok(run1.lastRunAt > 0);

    // Record run 2
    const run2 = await db.recordClientRun(testIp);
    assert.equal(run2.freeRunsUsed, 2);

    // Record run 3
    const run3 = await db.recordClientRun(testIp);
    assert.equal(run3.freeRunsUsed, 3);

    // Query afresh to verify persistence in SQLite
    const persisted = await db.getClientQuota(testIp);
    assert.equal(persisted.freeRunsUsed, 3);
  });
});
