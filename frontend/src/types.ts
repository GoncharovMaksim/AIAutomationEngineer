export interface GamePlatform {
  platform: string;
  metascore: number | null;
  userscore: number | null;
}

export interface GameItem {
  id: string;
  title: string;
  slug: string;
  cover_image: string | null;
  developer: string | null;
  description: string | null;
  video_url: string | null;
  max_metascore: number | null;
  avg_userscore: number | null;
  platforms: GamePlatform[];
  updated_at: string;
}

export interface ReviewsSummary {
  critics_summary_pros: string;
  critics_summary_cons: string;
  users_summary_pros: string;
  users_summary_cons: string;
  updated_at: string;
}

export interface YoutubeLetsplay {
  video_id: string;
  video_title: string;
  video_url: string;
  channel_name: string | null;
  views_count: number;
  blogger_conclusion: string;
  transcript_sample: string | null;
  updated_at: string;
}

export interface SimilarGame {
  id: string;
  title: string;
  slug: string;
  cover_image: string | null;
  developer: string | null;
  similarityScore: number;
}

export interface GameDetail extends GameItem {
  reviews: ReviewsSummary | null;
  youtube: YoutubeLetsplay | null;
  similarGames: SimilarGame[];
}

export interface WorkerLog {
  id?: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  game_id?: string | null;
  timestamp: string;
}

export interface CrawlState {
  id: number;
  last_run_date: string;
  see_all_page: number;
  total_processed_today: number;
  status: 'idle' | 'running' | 'error';
  current_game: string;
  current_step: string;
  updated_at: string;
}

export interface WorkerProgressPayload {
  status: 'idle' | 'running' | 'completed' | 'error';
  currentGame: string;
  currentStep: string;
  processedCount: number;
  totalTarget: number;
  todayDate: string;
  seeAllPage: number;
}
