import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { cosineSimilarity } from './database.js';
import {
  IGameRepository,
  GameInput,
  ReviewsSummaryInput,
  YoutubeLetsplayInput,
  GameFilters,
  CrawlState,
  WorkerLog
} from './types.js';

export class SqliteDriver implements IGameRepository {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(customDbPath?: string) {
    this.dbPath = customDbPath || config.dbPath;
  }

  async init(): Promise<void> {
    if (this.db) return;

    if (this.dbPath !== ':memory:') {
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
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
        reviews_hash TEXT,
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
        transcript_available INTEGER DEFAULT 0,
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

        CREATE TABLE IF NOT EXISTS ip_quotas (
        ip TEXT PRIMARY KEY,
        free_runs_used INTEGER DEFAULT 0,
        last_run_at INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      this.db.exec('ALTER TABLE reviews_summary ADD COLUMN reviews_hash TEXT;');
    } catch {}

    try {
      this.db.exec('ALTER TABLE youtube_letsplays ADD COLUMN transcript_available INTEGER DEFAULT 0;');
    } catch {}

    // Initialize crawl_state row 1 if empty
    const state = this.db.prepare('SELECT * FROM crawl_state WHERE id = 1').get();
    if (!state) {
      const today = new Date().toISOString().split('T')[0];
      this.db.prepare(`
        INSERT INTO crawl_state (id, last_run_date, see_all_page, total_processed_today, status, current_game, current_step)
        VALUES (1, ?, 1, 0, 'idle', '', 'Ready')
      `).run(today);
    }
  }

  private getClient(): Database.Database {
    if (!this.db) {
      throw new Error('[SqliteDriver] Database is not initialized. Call init() first.');
    }
    return this.db;
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.db) return false;
      const res = this.db.prepare('SELECT 1 as alive').get() as any;
      return res?.alive === 1;
    } catch {
      return false;
    }
  }

  async upsertGame(game: GameInput): Promise<void> {
    const db = this.getClient();
    const existing = db.prepare('SELECT id FROM games WHERE id = ?').get(game.id);
    const embeddingStr = game.embedding ? JSON.stringify(game.embedding) : null;

    if (existing) {
      db.prepare(`
        UPDATE games
        SET title = ?, cover_image = COALESCE(?, cover_image), developer = COALESCE(?, developer),
            description = COALESCE(?, description), video_url = COALESCE(?, video_url),
            embedding = COALESCE(?, embedding), last_processed_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        game.title,
        game.coverImage || null,
        game.developer || null,
        game.description || null,
        game.videoUrl || null,
        embeddingStr,
        game.todayDate,
        game.id
      );
    } else {
      db.prepare(`
        INSERT INTO games (id, title, slug, cover_image, developer, description, video_url, embedding, last_processed_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        game.id,
        game.title,
        game.slug,
        game.coverImage || null,
        game.developer || null,
        game.description || null,
        game.videoUrl || null,
        embeddingStr,
        game.todayDate
      );
    }

    if (game.platforms && game.platforms.length > 0) {
      const stmt = db.prepare(`
        INSERT INTO game_platforms (game_id, platform, metascore, userscore)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(game_id, platform) DO UPDATE SET
          metascore = excluded.metascore,
          userscore = excluded.userscore
      `);
      for (const p of game.platforms) {
        stmt.run(game.id, p.platform, p.metascore ?? null, p.userscore ?? null);
      }
    }
  }

  async updateGameEmbedding(gameId: string, embedding: number[]): Promise<void> {
    const db = this.getClient();
    db.prepare('UPDATE games SET embedding = ? WHERE id = ?').run(JSON.stringify(embedding), gameId);
  }

  async upsertReviewsSummary(summary: ReviewsSummaryInput): Promise<void> {
    const db = this.getClient();
    db.prepare(`
      INSERT INTO reviews_summary (game_id, critics_summary_pros, critics_summary_cons, users_summary_pros, users_summary_cons, reviews_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(game_id) DO UPDATE SET
        critics_summary_pros = excluded.critics_summary_pros,
        critics_summary_cons = excluded.critics_summary_cons,
        users_summary_pros = excluded.users_summary_pros,
        users_summary_cons = excluded.users_summary_cons,
        reviews_hash = excluded.reviews_hash,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      summary.gameId,
      summary.criticsSummaryPros,
      summary.criticsSummaryCons,
      summary.usersSummaryPros,
      summary.usersSummaryCons,
      summary.reviewsHash || null
    );
  }

  async upsertYoutubeLetsplay(lp: YoutubeLetsplayInput): Promise<void> {
    const db = this.getClient();
    db.prepare(`
      INSERT INTO youtube_letsplays (game_id, video_id, video_title, video_url, channel_name, views_count, blogger_conclusion, transcript_sample, transcript_available, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(game_id) DO UPDATE SET
        video_id = excluded.video_id,
        video_title = excluded.video_title,
        video_url = excluded.video_url,
        channel_name = excluded.channel_name,
        views_count = excluded.views_count,
        blogger_conclusion = excluded.blogger_conclusion,
        transcript_sample = excluded.transcript_sample,
        transcript_available = excluded.transcript_available,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      lp.gameId,
      lp.videoId,
      lp.videoTitle,
      lp.videoUrl,
      lp.channelName || null,
      lp.viewsCount || 0,
      lp.bloggerConclusion,
      lp.transcriptSample || null,
      lp.transcriptAvailable ? 1 : 0
    );
  }

  async getAllGames(filters: GameFilters = {}): Promise<any[]> {
    const db = this.getClient();
    let query = `
      SELECT g.*, 
        MAX(gp.metascore) as max_metascore,
        AVG(gp.userscore) as avg_userscore,
        GROUP_CONCAT(gp.platform, ', ') as platforms_str
      FROM games g
      LEFT JOIN game_platforms gp ON g.id = gp.game_id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (filters.search) {
      conditions.push(`g.title LIKE ?`);
      params.push(`%${filters.search}%`);
    }

    if (filters.platform) {
      conditions.push(`EXISTS (SELECT 1 FROM game_platforms p WHERE p.game_id = g.id AND p.platform = ?)`);
      params.push(filters.platform);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` GROUP BY g.id`;

    const sortOrder = (filters.sortOrder || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    if (filters.sortBy === 'metascore') {
      query += ` ORDER BY max_metascore ${sortOrder} NULLS LAST`;
    } else if (filters.sortBy === 'userscore') {
      query += ` ORDER BY avg_userscore ${sortOrder} NULLS LAST`;
    } else if (filters.sortBy === 'title') {
      query += ` ORDER BY g.title ${sortOrder}`;
    } else {
      query += ` ORDER BY g.updated_at ${sortOrder}`;
    }

    if (filters.limit && filters.limit > 0) {
      query += ` LIMIT ?`;
      params.push(filters.limit);
      if (filters.offset && filters.offset > 0) {
        query += ` OFFSET ?`;
        params.push(filters.offset);
      }
    }

    const rows = db.prepare(query).all(...params) as any[];
    const platformsStmt = db.prepare('SELECT platform, metascore, userscore FROM game_platforms WHERE game_id = ?');

    return rows.map(r => ({
      ...r,
      embedding: undefined,
      platforms: platformsStmt.all(r.id)
    }));
  }

  async getGameById(id: string): Promise<any | null> {
    const db = this.getClient();
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as any;
    if (!game) return null;

    const platforms = db.prepare('SELECT platform, metascore, userscore FROM game_platforms WHERE game_id = ?').all(id);
    const reviews = db.prepare('SELECT * FROM reviews_summary WHERE game_id = ?').get(id);
    const youtube = db.prepare('SELECT * FROM youtube_letsplays WHERE game_id = ?').get(id);
    const similarGames = await this.findSimilarGames(id, 4);

    return {
      ...game,
      embedding: undefined,
      platforms,
      reviews,
      youtube,
      similarGames
    };
  }

  async getAllPlatforms(): Promise<string[]> {
    const db = this.getClient();
    const rows = db.prepare('SELECT DISTINCT platform FROM game_platforms ORDER BY platform ASC').all() as { platform: string }[];
    return rows.map(r => r.platform).filter(Boolean);
  }

  async findSimilarGames(gameId: string, limit = 4): Promise<any[]> {
    const db = this.getClient();
    const currentGame = db.prepare('SELECT id, developer, embedding FROM games WHERE id = ?').get(gameId) as any;
    if (!currentGame) return [];

    const otherGames = db.prepare('SELECT id, title, slug, cover_image, developer, embedding FROM games WHERE id != ?').all(gameId) as any[];
    if (otherGames.length === 0) return [];

    let currentVec: number[] | null = null;
    if (currentGame.embedding) {
      try {
        currentVec = JSON.parse(currentGame.embedding);
      } catch {}
    }

    const scoredGames = otherGames.map(other => {
      let score = 0;
      if (currentVec && other.embedding) {
        try {
          const otherVec = JSON.parse(other.embedding);
          score = cosineSimilarity(currentVec, otherVec);
        } catch {}
      }
      if (currentGame.developer && other.developer && currentGame.developer.toLowerCase() === other.developer.toLowerCase()) {
        score += 0.2;
      }
      return {
        id: other.id,
        title: other.title,
        slug: other.slug,
        cover_image: other.cover_image,
        developer: other.developer,
        similarityScore: score
      };
    });

    scoredGames.sort((a, b) => b.similarityScore - a.similarityScore);
    return scoredGames.slice(0, limit);
  }

  async getCrawlState(): Promise<CrawlState> {
    const db = this.getClient();
    return db.prepare('SELECT * FROM crawl_state WHERE id = 1').get() as CrawlState;
  }

  async getProcessedGameIdsForDate(date: string): Promise<string[]> {
    const db = this.getClient();
    const rows = db.prepare('SELECT id FROM games WHERE last_processed_date = ?').all(date) as { id: string }[];
    return rows.map(r => r.id);
  }

  async updateCrawlState(updates: {
    last_run_date?: string;
    see_all_page?: number;
    total_processed_today?: number;
    status?: string;
    current_game?: string;
    current_step?: string;
  }): Promise<void> {
    const db = this.getClient();
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (fields.length === 0) return;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    db.prepare(`UPDATE crawl_state SET ${fields.join(', ')} WHERE id = 1`).run(...values);
  }

  async acquireWorkerLock(): Promise<boolean> {
    const db = this.getClient();
    const row = db.prepare('SELECT status, updated_at FROM crawl_state WHERE id = 1').get() as { status: string; updated_at: string } | undefined;
    if (row && row.status === 'running') {
      const updatedAtMs = new Date(row.updated_at).getTime();
      const isStale = !isNaN(updatedAtMs) && (Date.now() - updatedAtMs > 30 * 60 * 1000);
      if (!isStale) {
        return false;
      }
    }
    const result = db.prepare(`
      UPDATE crawl_state 
      SET status = 'running', updated_at = CURRENT_TIMESTAMP 
      WHERE id = 1 AND (status != 'running' OR updated_at < datetime('now', '-30 minutes'))
    `).run();
    return result.changes > 0;
  }

  async releaseWorkerLock(): Promise<void> {
    const db = this.getClient();
    db.prepare(`UPDATE crawl_state SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run();
  }

  async addWorkerLog(level: 'info' | 'warn' | 'error' | 'success', message: string, gameId?: string): Promise<void> {
    const db = this.getClient();
    db.prepare('INSERT INTO worker_logs (level, message, game_id) VALUES (?, ?, ?)').run(level, message, gameId || null);
    db.prepare('DELETE FROM worker_logs WHERE id NOT IN (SELECT id FROM worker_logs ORDER BY id DESC LIMIT 500)').run();
  }

  async getRecentLogs(limit = 100): Promise<WorkerLog[]> {
    const db = this.getClient();
    return db.prepare('SELECT * FROM worker_logs ORDER BY id DESC LIMIT ?').all(limit) as WorkerLog[];
  }

  async pruneOldLogs(keepCount = 500): Promise<void> {
    const db = this.getClient();
    try {
      db.prepare('DELETE FROM worker_logs WHERE id NOT IN (SELECT id FROM worker_logs ORDER BY id DESC LIMIT ?)').run(keepCount);
    } catch (e: any) {
      console.warn('[SqliteDriver] pruneOldLogs warning:', e.message);
    }
  }

  async getClientQuota(ip: string): Promise<{ freeRunsUsed: number; lastRunAt: number }> {
    const db = this.getClient();
    const row = db.prepare('SELECT free_runs_used, last_run_at FROM ip_quotas WHERE ip = ?').get(ip) as any;
    return {
      freeRunsUsed: row ? Number(row.free_runs_used) : 0,
      lastRunAt: row ? Number(row.last_run_at) : 0
    };
  }

  async recordClientRun(ip: string): Promise<{ freeRunsUsed: number; lastRunAt: number }> {
    const db = this.getClient();
    const now = Date.now();
    db.prepare(`
      INSERT INTO ip_quotas (ip, free_runs_used, last_run_at, updated_at)
      VALUES (?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(ip) DO UPDATE SET
        free_runs_used = ip_quotas.free_runs_used + 1,
        last_run_at = excluded.last_run_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(ip, now);
    return this.getClientQuota(ip);
  }

  async createAdminSession(token: string, expiresAt: number): Promise<void> {
    const db = this.getClient();
    db.prepare(`
      INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)
      ON CONFLICT(token) DO UPDATE SET expires_at = excluded.expires_at
    `).run(token, expiresAt);
  }

  async isValidAdminSession(token: string): Promise<boolean> {
    const db = this.getClient();
    const row = db.prepare('SELECT expires_at FROM admin_sessions WHERE token = ?').get(token) as { expires_at: number } | undefined;
    if (!row) return false;
    if (Date.now() > row.expires_at) {
      db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
      return false;
    }
    return true;
  }

  async checkpointWal(): Promise<void> {
    const db = this.getClient();
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e: any) {
      console.warn('[SqliteDriver] WAL checkpoint warning:', e.message);
    }
  }

  async resetDatabase(): Promise<void> {
    const db = this.getClient();
    const today = new Date().toISOString().split('T')[0];
    db.exec(`
      DELETE FROM games;
      DELETE FROM worker_logs;
      UPDATE crawl_state SET 
        last_run_date = '${today}',
        see_all_page = 1,
        total_processed_today = 0,
        status = 'idle',
        current_game = '',
        current_step = 'Database reset'
      WHERE id = 1;
    `);
    await this.checkpointWal();
  }
}
