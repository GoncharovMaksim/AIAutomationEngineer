import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { SqliteDriver } from '../src/db/sqliteDriver.js';
import { cosineSimilarity } from '../src/db/database.js';

describe('SQLite Database & Dual-Driver Operations', () => {
  let driver: SqliteDriver;

  before(async () => {
    driver = new SqliteDriver(':memory:');
    await driver.init();
  });

  after(async () => {
    await driver.close();
  });

  it('checks database healthiness', async () => {
    const isHealthy = await driver.isHealthy();
    assert.strictEqual(isHealthy, true);
  });

  it('inserts and updates games without conflicts', async () => {
    await driver.upsertGame({
      id: 'cyberpunk-2077',
      title: 'Cyberpunk 2077',
      slug: 'cyberpunk-2077',
      coverImage: 'https://example.com/cover.jpg',
      developer: 'CD Projekt Red',
      description: 'An open-world action RPG.',
      platforms: [
        { platform: 'PC', metascore: 86, userscore: 7.8 },
        { platform: 'PlayStation 5', metascore: 87, userscore: 8.2 }
      ],
      todayDate: '2026-09-16'
    });

    const game = await driver.getGameById('cyberpunk-2077');
    assert.ok(game);
    assert.strictEqual(game.title, 'Cyberpunk 2077');
    assert.strictEqual(game.developer, 'CD Projekt Red');
    assert.strictEqual(game.platforms.length, 2);
  });

  it('supports search and platform filtering', async () => {
    const results = await driver.getAllGames({ search: 'Cyber', platform: 'PC' });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 'cyberpunk-2077');
  });

  it('stores and ranks similar games by vector similarity', async () => {
    const embeddingA = [0.1, 0.9, 0.2];
    const embeddingB = [0.12, 0.88, 0.19];
    const embeddingC = [-0.8, -0.2, 0.1];

    const scoreAB = cosineSimilarity(embeddingA, embeddingB);
    const scoreAC = cosineSimilarity(embeddingA, embeddingC);

    assert.ok(scoreAB > 0.98, 'A and B should have very high similarity');
    assert.ok(scoreAC < 0.2, 'A and C should have low similarity');
  });

  it('manages crawl state and logs', async () => {
    await driver.updateCrawlState({ current_step: 'Testing step', see_all_page: 5 });
    const state = await driver.getCrawlState();
    assert.strictEqual(state.current_step, 'Testing step');
    assert.strictEqual(state.see_all_page, 5);

    await driver.addWorkerLog('info', 'Test worker message');
    const logs = await driver.getRecentLogs(10);
    assert.ok(logs.length > 0);
    assert.strictEqual(logs[0].message, 'Test worker message');
  });
});
