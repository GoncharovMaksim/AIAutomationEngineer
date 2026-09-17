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
  reviewsHash?: string;
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
  transcriptAvailable?: boolean;
}

export interface GameFilters {
  search?: string;
  platform?: string;
  sortBy?: 'metascore' | 'userscore' | 'title' | 'recent';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CrawlState {
  id: number;
  last_run_date: string;
  see_all_page: number;
  total_processed_today: number;
  status: string;
  current_game: string;
  current_step: string;
  updated_at: string;
}

export interface WorkerLog {
  id: number;
  level: string;
  message: string;
  game_id?: string | null;
  timestamp: string;
}

export interface IGameRepository {
  init(): Promise<void>;
  close(): Promise<void>;
  isHealthy(): Promise<boolean>;

  upsertGame(game: GameInput): Promise<void>;
  updateGameEmbedding(gameId: string, embedding: number[]): Promise<void>;
  upsertReviewsSummary(summary: ReviewsSummaryInput): Promise<void>;
  upsertYoutubeLetsplay(lp: YoutubeLetsplayInput): Promise<void>;

  getAllGames(filters?: GameFilters): Promise<any[]>;
  getGameById(id: string): Promise<any | null>;
  getAllPlatforms(): Promise<string[]>;
  findSimilarGames(gameId: string, limit?: number): Promise<any[]>;

  getCrawlState(): Promise<CrawlState>;
  getProcessedGameIdsForDate(date: string): Promise<string[]>;
  updateCrawlState(updates: {
    last_run_date?: string;
    see_all_page?: number;
    total_processed_today?: number;
    status?: string;
    current_game?: string;
    current_step?: string;
  }): Promise<void>;
  acquireWorkerLock(): Promise<boolean>;
  releaseWorkerLock(): Promise<void>;

  addWorkerLog(level: 'info' | 'warn' | 'error' | 'success', message: string, gameId?: string): Promise<void>;
  getRecentLogs(limit?: number): Promise<WorkerLog[]>;
  pruneOldLogs(keepCount?: number): Promise<void>;
  getClientQuota(ip: string): Promise<{ freeRunsUsed: number; lastRunAt: number }>;
  recordClientRun(ip: string): Promise<{ freeRunsUsed: number; lastRunAt: number }>;
  checkpointWal(): Promise<void>;
  resetDatabase(): Promise<void>;
}
