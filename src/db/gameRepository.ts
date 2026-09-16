import { db, cosineSimilarity } from './database.js';

export interface GamePlatformInput {
  platform: string;
  metascore?: number | null;
  userscore?: number | null;
}

export interface GameInput {
  id: string;
  title: string;
  slug: string;
  coverImage?: string;
  developer?: string;
  description?: string;
  videoUrl?: string;
  embedding?: number[];
  platforms: GamePlatformInput[];
  todayDate: string;
}

export interface ReviewsSummaryInput {
  gameId: string;
  criticsSummaryPros: string;
  criticsSummaryCons: string;
  usersSummaryPros: string;
  usersSummaryCons: string;
}

export interface YoutubeLetsplayInput {
  gameId: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  channelName?: string;
  viewsCount?: number;
  bloggerConclusion: string;
  transcriptSample?: string;
}

export interface GameFilters {
  search?: string;
  platform?: string;
  sortBy?: 'metascore' | 'userscore' | 'title' | 'recent';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export const gameRepository = {
  upsertGame(game: GameInput) {
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

    // Upsert platforms
    if (game.platforms && game.platforms.length > 0) {
      for (const p of game.platforms) {
        db.prepare(`
          INSERT INTO game_platforms (game_id, platform, metascore, userscore)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(game_id, platform) DO UPDATE SET
            metascore = excluded.metascore,
            userscore = excluded.userscore
        `).run(game.id, p.platform, p.metascore ?? null, p.userscore ?? null);
      }
    }
  },

  updateGameEmbedding(gameId: string, embedding: number[]) {
    db.prepare('UPDATE games SET embedding = ? WHERE id = ?').run(JSON.stringify(embedding), gameId);
  },

  upsertReviewsSummary(summary: ReviewsSummaryInput) {
    db.prepare(`
      INSERT INTO reviews_summary (game_id, critics_summary_pros, critics_summary_cons, users_summary_pros, users_summary_cons, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(game_id) DO UPDATE SET
        critics_summary_pros = excluded.critics_summary_pros,
        critics_summary_cons = excluded.critics_summary_cons,
        users_summary_pros = excluded.users_summary_pros,
        users_summary_cons = excluded.users_summary_cons,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      summary.gameId,
      summary.criticsSummaryPros,
      summary.criticsSummaryCons,
      summary.usersSummaryPros,
      summary.usersSummaryCons
    );
  },

  upsertYoutubeLetsplay(lp: YoutubeLetsplayInput) {
    db.prepare(`
      INSERT INTO youtube_letsplays (game_id, video_id, video_title, video_url, channel_name, views_count, blogger_conclusion, transcript_sample, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(game_id) DO UPDATE SET
        video_id = excluded.video_id,
        video_title = excluded.video_title,
        video_url = excluded.video_url,
        channel_name = excluded.channel_name,
        views_count = excluded.views_count,
        blogger_conclusion = excluded.blogger_conclusion,
        transcript_sample = excluded.transcript_sample,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      lp.gameId,
      lp.videoId,
      lp.videoTitle,
      lp.videoUrl,
      lp.channelName || null,
      lp.viewsCount || 0,
      lp.bloggerConclusion,
      lp.transcriptSample || null
    );
  },

  getAllGames(filters: GameFilters = {}) {
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

    // Sorting
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

    // Fetch platforms for each game
    const platformsStmt = db.prepare('SELECT platform, metascore, userscore FROM game_platforms WHERE game_id = ?');
    return rows.map(r => ({
      ...r,
      embedding: undefined, // do not send heavy embedding in list
      platforms: platformsStmt.all(r.id)
    }));
  },

  getGameById(id: string) {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as any;
    if (!game) return null;

    const platforms = db.prepare('SELECT platform, metascore, userscore FROM game_platforms WHERE game_id = ?').all(id);
    const reviews = db.prepare('SELECT * FROM reviews_summary WHERE game_id = ?').get(id);
    const youtube = db.prepare('SELECT * FROM youtube_letsplays WHERE game_id = ?').get(id);
    const similarGames = this.findSimilarGames(id, 4);

    return {
      ...game,
      embedding: undefined,
      platforms,
      reviews,
      youtube,
      similarGames
    };
  },

  getAllPlatforms(): string[] {
    const rows = db.prepare('SELECT DISTINCT platform FROM game_platforms ORDER BY platform ASC').all() as { platform: string }[];
    return rows.map(r => r.platform).filter(Boolean);
  },

  findSimilarGames(gameId: string, limit = 4) {
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
      // Boost if same developer
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

    // Sort descending by similarityScore
    scoredGames.sort((a, b) => b.similarityScore - a.similarityScore);
    return scoredGames.slice(0, limit);
  },

  // Crawl State
  getCrawlState() {
    return db.prepare('SELECT * FROM crawl_state WHERE id = 1').get() as any;
  },

  updateCrawlState(updates: {
    last_run_date?: string;
    see_all_page?: number;
    total_processed_today?: number;
    status?: string;
    current_game?: string;
    current_step?: string;
  }) {
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
  },

  // Worker Logs
  addWorkerLog(level: 'info' | 'warn' | 'error' | 'success', message: string, gameId?: string) {
    db.prepare('INSERT INTO worker_logs (level, message, game_id) VALUES (?, ?, ?)').run(level, message, gameId || null);
    // Keep last 500 logs only
    db.prepare('DELETE FROM worker_logs WHERE id NOT IN (SELECT id FROM worker_logs ORDER BY id DESC LIMIT 500)').run();
  },

  getRecentLogs(limit = 100) {
    return db.prepare('SELECT * FROM worker_logs ORDER BY id DESC LIMIT ?').all(limit);
  }
};
