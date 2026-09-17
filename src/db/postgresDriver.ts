import pg from 'pg';
const { Pool } = pg;
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

export class PostgresDriver implements IGameRepository {
  private pool: pg.Pool | null = null;
  private connectionString: string;

  constructor(customUrl?: string) {
    this.connectionString = customUrl || config.databaseUrl;
  }

  async init(): Promise<void> {
    if (this.pool) return;

    this.pool = new Pool({
      connectionString: this.connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query(`
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
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS game_platforms (
          id SERIAL PRIMARY KEY,
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
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS youtube_letsplays (
          game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
          video_id TEXT NOT NULL,
          video_title TEXT NOT NULL,
          video_url TEXT NOT NULL,
          channel_name TEXT,
          views_count BIGINT,
          blogger_conclusion TEXT,
          transcript_sample TEXT,
          transcript_available BOOLEAN DEFAULT FALSE,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS crawl_state (
          id INTEGER PRIMARY KEY,
          last_run_date TEXT NOT NULL,
          see_all_page INTEGER DEFAULT 1,
          total_processed_today INTEGER DEFAULT 0,
          status TEXT DEFAULT 'idle',
          current_game TEXT,
          current_step TEXT,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS worker_logs (
          id SERIAL PRIMARY KEY,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          game_id TEXT,
          timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ip_quotas (
          ip TEXT PRIMARY KEY,
          free_runs_used INTEGER DEFAULT 0,
          last_run_at BIGINT DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      try {
        await client.query('ALTER TABLE reviews_summary ADD COLUMN IF NOT EXISTS reviews_hash TEXT');
      } catch {}

      try {
        await client.query('ALTER TABLE youtube_letsplays ADD COLUMN IF NOT EXISTS transcript_available BOOLEAN DEFAULT FALSE');
      } catch {}

      // Initialize crawl_state row 1 if empty
      const stateRes = await client.query('SELECT * FROM crawl_state WHERE id = 1');
      if (stateRes.rows.length === 0) {
        const today = new Date().toISOString().split('T')[0];
        await client.query(`
          INSERT INTO crawl_state (id, last_run_date, see_all_page, total_processed_today, status, current_game, current_step)
          VALUES (1, $1, 1, 0, 'idle', '', 'Ready')
        `, [today]);
      }
    } finally {
      client.release();
    }
  }

  private getPool(): pg.Pool {
    if (!this.pool) {
      throw new Error('[PostgresDriver] Database is not initialized. Call init() first.');
    }
    return this.pool;
  }

  async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {}
      this.pool = null;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.pool) return false;
      const res = await this.pool.query('SELECT 1 as alive');
      return res.rows?.[0]?.alive === 1;
    } catch {
      return false;
    }
  }

  async upsertGame(game: GameInput): Promise<void> {
    const pool = this.getPool();
    const embeddingStr = game.embedding ? JSON.stringify(game.embedding) : null;

    const query = `
      INSERT INTO games (id, title, slug, cover_image, developer, description, video_url, embedding, last_processed_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT(id) DO UPDATE SET
        title = EXCLUDED.title,
        cover_image = COALESCE(EXCLUDED.cover_image, games.cover_image),
        developer = COALESCE(EXCLUDED.developer, games.developer),
        description = COALESCE(EXCLUDED.description, games.description),
        video_url = COALESCE(EXCLUDED.video_url, games.video_url),
        embedding = COALESCE(EXCLUDED.embedding, games.embedding),
        last_processed_date = EXCLUDED.last_processed_date,
        updated_at = CURRENT_TIMESTAMP
    `;
    await pool.query(query, [
      game.id,
      game.title,
      game.slug,
      game.coverImage || null,
      game.developer || null,
      game.description || null,
      game.videoUrl || null,
      embeddingStr,
      game.todayDate
    ]);

    if (game.platforms && game.platforms.length > 0) {
      for (const p of game.platforms) {
        await pool.query(`
          INSERT INTO game_platforms (game_id, platform, metascore, userscore)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT(game_id, platform) DO UPDATE SET
            metascore = EXCLUDED.metascore,
            userscore = EXCLUDED.userscore
        `, [game.id, p.platform, p.metascore ?? null, p.userscore ?? null]);
      }
    }
  }

  async updateGameEmbedding(gameId: string, embedding: number[]): Promise<void> {
    const pool = this.getPool();
    await pool.query('UPDATE games SET embedding = $1 WHERE id = $2', [JSON.stringify(embedding), gameId]);
  }

  async upsertReviewsSummary(summary: ReviewsSummaryInput): Promise<void> {
    const pool = this.getPool();
    await pool.query(`
      INSERT INTO reviews_summary (game_id, critics_summary_pros, critics_summary_cons, users_summary_pros, users_summary_cons, reviews_hash, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT(game_id) DO UPDATE SET
        critics_summary_pros = EXCLUDED.critics_summary_pros,
        critics_summary_cons = EXCLUDED.critics_summary_cons,
        users_summary_pros = EXCLUDED.users_summary_pros,
        users_summary_cons = EXCLUDED.users_summary_cons,
        reviews_hash = EXCLUDED.reviews_hash,
        updated_at = CURRENT_TIMESTAMP
    `, [
      summary.gameId,
      summary.criticsSummaryPros,
      summary.criticsSummaryCons,
      summary.usersSummaryPros,
      summary.usersSummaryCons,
      summary.reviewsHash || null
    ]);
  }

  async upsertYoutubeLetsplay(lp: YoutubeLetsplayInput): Promise<void> {
    const pool = this.getPool();
    await pool.query(`
      INSERT INTO youtube_letsplays (game_id, video_id, video_title, video_url, channel_name, views_count, blogger_conclusion, transcript_sample, transcript_available, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT(game_id) DO UPDATE SET
        video_id = EXCLUDED.video_id,
        video_title = EXCLUDED.video_title,
        video_url = EXCLUDED.video_url,
        channel_name = EXCLUDED.channel_name,
        views_count = EXCLUDED.views_count,
        blogger_conclusion = EXCLUDED.blogger_conclusion,
        transcript_sample = EXCLUDED.transcript_sample,
        transcript_available = EXCLUDED.transcript_available,
        updated_at = CURRENT_TIMESTAMP
    `, [
      lp.gameId,
      lp.videoId,
      lp.videoTitle,
      lp.videoUrl,
      lp.channelName || null,
      lp.viewsCount || 0,
      lp.bloggerConclusion,
      lp.transcriptSample || null,
      lp.transcriptAvailable ? true : false
    ]);
  }

  async getAllGames(filters: GameFilters = {}): Promise<any[]> {
    const pool = this.getPool();
    let query = `
      SELECT g.*, 
        MAX(gp.metascore) as max_metascore,
        AVG(gp.userscore) as avg_userscore,
        STRING_AGG(gp.platform, ', ') as platforms_str
      FROM games g
      LEFT JOIN game_platforms gp ON g.id = gp.game_id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`g.title ILIKE $${params.length}`);
    }

    if (filters.platform) {
      params.push(filters.platform);
      conditions.push(`EXISTS (SELECT 1 FROM game_platforms p WHERE p.game_id = g.id AND p.platform = $${params.length})`);
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
      params.push(filters.limit);
      query += ` LIMIT $${params.length}`;
      if (filters.offset && filters.offset > 0) {
        params.push(filters.offset);
        query += ` OFFSET $${params.length}`;
      }
    }

    const { rows } = await pool.query(query, params);

    // Fetch platforms for all games
    const platformsRes = await pool.query('SELECT game_id, platform, metascore, userscore FROM game_platforms');
    const platformsByGameId = new Map<string, any[]>();
    for (const p of platformsRes.rows) {
      const list = platformsByGameId.get(p.game_id) || [];
      list.push({ platform: p.platform, metascore: p.metascore, userscore: p.userscore });
      platformsByGameId.set(p.game_id, list);
    }

    return rows.map(r => ({
      ...r,
      embedding: undefined,
      platforms: platformsByGameId.get(r.id) || []
    }));
  }

  async getGameById(id: string): Promise<any | null> {
    const pool = this.getPool();
    const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
    if (gameRes.rows.length === 0) return null;
    const game = gameRes.rows[0];

    const platformsRes = await pool.query('SELECT platform, metascore, userscore FROM game_platforms WHERE game_id = $1', [id]);
    const reviewsRes = await pool.query('SELECT * FROM reviews_summary WHERE game_id = $1', [id]);
    const youtubeRes = await pool.query('SELECT * FROM youtube_letsplays WHERE game_id = $1', [id]);
    const similarGames = await this.findSimilarGames(id, 4);

    return {
      ...game,
      embedding: undefined,
      platforms: platformsRes.rows,
      reviews: reviewsRes.rows[0] || null,
      youtube: youtubeRes.rows[0] || null,
      similarGames
    };
  }

  async getAllPlatforms(): Promise<string[]> {
    const pool = this.getPool();
    const res = await pool.query('SELECT DISTINCT platform FROM game_platforms ORDER BY platform ASC');
    return res.rows.map(r => r.platform).filter(Boolean);
  }

  async findSimilarGames(gameId: string, limit = 4): Promise<any[]> {
    const pool = this.getPool();
    const curRes = await pool.query('SELECT id, developer, embedding FROM games WHERE id = $1', [gameId]);
    if (curRes.rows.length === 0) return [];
    const currentGame = curRes.rows[0];

    const othersRes = await pool.query('SELECT id, title, slug, cover_image, developer, embedding FROM games WHERE id != $1', [gameId]);
    if (othersRes.rows.length === 0) return [];

    let currentVec: number[] | null = null;
    if (currentGame.embedding) {
      try {
        currentVec = JSON.parse(currentGame.embedding);
      } catch {}
    }

    const scoredGames = othersRes.rows.map(other => {
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
    const pool = this.getPool();
    const res = await pool.query('SELECT * FROM crawl_state WHERE id = 1');
    return res.rows[0] as CrawlState;
  }

  async getProcessedGameIdsForDate(date: string): Promise<string[]> {
    const pool = this.getPool();
    const res = await pool.query('SELECT id FROM games WHERE last_processed_date = $1', [date]);
    return res.rows.map(r => r.id);
  }

  async updateCrawlState(updates: {
    last_run_date?: string;
    see_all_page?: number;
    total_processed_today?: number;
    status?: string;
    current_game?: string;
    current_step?: string;
  }): Promise<void> {
    const pool = this.getPool();
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(val);
      }
    }
    if (fields.length === 0) return;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    await pool.query(`UPDATE crawl_state SET ${fields.join(', ')} WHERE id = 1`, values);
  }

  async addWorkerLog(level: 'info' | 'warn' | 'error' | 'success', message: string, gameId?: string): Promise<void> {
    const pool = this.getPool();
    await pool.query('INSERT INTO worker_logs (level, message, game_id) VALUES ($1, $2, $3)', [level, message, gameId || null]);
    await pool.query('DELETE FROM worker_logs WHERE id NOT IN (SELECT id FROM worker_logs ORDER BY id DESC LIMIT 500)');
  }

  async getRecentLogs(limit = 100): Promise<WorkerLog[]> {
    const pool = this.getPool();
    const res = await pool.query('SELECT * FROM worker_logs ORDER BY id DESC LIMIT $1', [limit]);
    return res.rows as WorkerLog[];
  }

  async pruneOldLogs(keepCount = 500): Promise<void> {
    const pool = this.getPool();
    try {
      await pool.query('DELETE FROM worker_logs WHERE id NOT IN (SELECT id FROM worker_logs ORDER BY id DESC LIMIT $1)', [keepCount]);
    } catch (e: any) {
      console.warn('[PostgresDriver] pruneOldLogs warning:', e.message);
    }
  }

  async getClientQuota(ip: string): Promise<{ freeRunsUsed: number; lastRunAt: number }> {
    const pool = this.getPool();
    const res = await pool.query('SELECT free_runs_used, last_run_at FROM ip_quotas WHERE ip = $1', [ip]);
    return {
      freeRunsUsed: res.rows[0] ? Number(res.rows[0].free_runs_used) : 0,
      lastRunAt: res.rows[0] ? Number(res.rows[0].last_run_at) : 0
    };
  }

  async recordClientRun(ip: string): Promise<{ freeRunsUsed: number; lastRunAt: number }> {
    const pool = this.getPool();
    const now = Date.now();
    await pool.query(`
      INSERT INTO ip_quotas (ip, free_runs_used, last_run_at, updated_at)
      VALUES ($1, 1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT(ip) DO UPDATE SET
        free_runs_used = ip_quotas.free_runs_used + 1,
        last_run_at = EXCLUDED.last_run_at,
        updated_at = CURRENT_TIMESTAMP
    `, [ip, now]);
    return this.getClientQuota(ip);
  }

  async checkpointWal(): Promise<void> {
    // No-op for PostgreSQL
  }

  async resetDatabase(): Promise<void> {
    const pool = this.getPool();
    const today = new Date().toISOString().split('T')[0];
    await pool.query(`
      TRUNCATE TABLE games CASCADE;
      TRUNCATE TABLE worker_logs CASCADE;
      UPDATE crawl_state SET 
        last_run_date = $1,
        see_all_page = 1,
        total_processed_today = 0,
        status = 'idle',
        current_game = '',
        current_step = 'Database reset'
      WHERE id = 1;
    `, [today]);
  }
}
