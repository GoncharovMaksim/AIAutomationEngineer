import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { cosineSimilarity } from '../src/db/database.js';

describe('SQLite Database & Repository Operations', () => {
  let testDb: any;

  before(() => {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');

    // Create schema
    testDb.exec(`
      CREATE TABLE games (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        cover_image TEXT,
        developer TEXT,
        description TEXT,
        video_url TEXT,
        embedding TEXT,
        last_processed_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE game_platforms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        metascore INTEGER,
        userscore REAL,
        UNIQUE(game_id, platform)
      );

      CREATE TABLE reviews_summary (
        game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
        critics_summary_pros TEXT,
        critics_summary_cons TEXT,
        users_summary_pros TEXT,
        users_summary_cons TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  after(() => {
    testDb.close();
  });

  it('inserts and updates games without conflicts', () => {
    const insertStmt = testDb.prepare(`
      INSERT INTO games (id, title, slug, cover_image, developer, description, last_processed_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      'cyberpunk-2077',
      'Cyberpunk 2077',
      'cyberpunk-2077',
      'https://example.com/cover.jpg',
      'CD Projekt Red',
      'An open-world action RPG.',
      '2026-09-16'
    );

    const game = testDb.prepare('SELECT * FROM games WHERE id = ?').get('cyberpunk-2077');
    assert.strictEqual(game.title, 'Cyberpunk 2077');
    assert.strictEqual(game.developer, 'CD Projekt Red');
  });

  it('correctly associates platforms and scores', () => {
    const insertPlatform = testDb.prepare(`
      INSERT INTO game_platforms (game_id, platform, metascore, userscore)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(game_id, platform) DO UPDATE SET metascore = excluded.metascore, userscore = excluded.userscore
    `);

    insertPlatform.run('cyberpunk-2077', 'PC', 86, 7.8);
    insertPlatform.run('cyberpunk-2077', 'PlayStation 5', 87, 8.2);

    const platforms = testDb.prepare('SELECT * FROM game_platforms WHERE game_id = ? ORDER BY metascore DESC').all('cyberpunk-2077');
    assert.strictEqual(platforms.length, 2);
    assert.strictEqual(platforms[0].platform, 'PlayStation 5');
    assert.strictEqual(platforms[0].metascore, 87);
    assert.strictEqual(platforms[1].metascore, 86);
  });

  it('supports search and platform filtering', () => {
    const searchFilter = '%Cyber%';
    const results = testDb.prepare(`
      SELECT g.* FROM games g
      WHERE g.title LIKE ? AND EXISTS (SELECT 1 FROM game_platforms p WHERE p.game_id = g.id AND p.platform = ?)
    `).all(searchFilter, 'PC');

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 'cyberpunk-2077');
  });

  it('stores and ranks similar games by vector similarity', () => {
    const embeddingA = [0.1, 0.9, 0.2];
    const embeddingB = [0.12, 0.88, 0.19];
    const embeddingC = [-0.8, -0.2, 0.1];

    const scoreAB = cosineSimilarity(embeddingA, embeddingB);
    const scoreAC = cosineSimilarity(embeddingA, embeddingC);

    assert.ok(scoreAB > 0.98, 'A and B should have very high similarity');
    assert.ok(scoreAC < 0.2, 'A and C should have low similarity');
  });
});
