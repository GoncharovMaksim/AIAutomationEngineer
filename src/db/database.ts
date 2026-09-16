import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

// Ensure data folder exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.dbPath);
// Enable WAL mode for high performance and concurrent reads
db.pragma('journal_mode = WAL');

// Initialize schema
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
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

    CREATE TABLE IF NOT EXISTS game_platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      metascore INTEGER,
      userscore REAL,
      UNIQUE(game_id, platform)
    );

    CREATE TABLE IF NOT EXISTS reviews_summary (
      game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      critics_summary_pros TEXT,
      critics_summary_cons TEXT,
      users_summary_pros TEXT,
      users_summary_cons TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS youtube_letsplays (
      game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL,
      video_title TEXT NOT NULL,
      video_url TEXT NOT NULL,
      channel_name TEXT,
      views_count INTEGER,
      blogger_conclusion TEXT,
      transcript_sample TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS crawl_state (
      id INTEGER PRIMARY KEY,
      last_run_date TEXT NOT NULL,
      see_all_page INTEGER DEFAULT 1,
      total_processed_today INTEGER DEFAULT 0,
      status TEXT DEFAULT 'idle',
      current_game TEXT,
      current_step TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS worker_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      game_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Initialize crawl_state if empty
  const state = db.prepare('SELECT * FROM crawl_state WHERE id = 1').get();
  if (!state) {
    const today = new Date().toISOString().split('T')[0];
    db.prepare(`
      INSERT INTO crawl_state (id, last_run_date, see_all_page, total_processed_today, status, current_game, current_step)
      VALUES (1, ?, 1, 0, 'idle', '', 'Ready')
    `).run(today);
  }
}

// Vector similarity helper (Cosine Similarity)
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
