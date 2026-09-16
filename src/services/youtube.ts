import youtubeSr from 'youtube-sr';
const YouTube = (youtubeSr as any).default || youtubeSr;
import { YoutubeTranscript } from 'youtube-transcript';
import { geminiService } from './gemini.js';
import { YoutubeLetsplayInput } from '../db/gameRepository.js';

export class YouTubeService {
  async findAndAnalyzeLetsPlay(gameId: string, gameTitle: string): Promise<YoutubeLetsplayInput | null> {
    try {
      const query = `${gameTitle} gameplay walkthrough lets play`;
      console.log(`[YouTube] Searching for: "${query}"`);

      const searchResults = await YouTube.search(query, { limit: 10, type: 'video' });
      if (!searchResults || searchResults.length === 0) {
        console.warn(`[YouTube] No videos found for "${gameTitle}"`);
        return null;
      }

      // Pick the most popular video by view count (as explicitly required by TZ)
      const sortedVideos = [...searchResults].sort((a: any, b: any) => (b.views || 0) - (a.views || 0));
      const topVideo = sortedVideos[0];
      const videoId = topVideo.id || '';
      const videoTitle = topVideo.title || `${gameTitle} Gameplay`;
      const videoUrl = topVideo.url || `https://www.youtube.com/watch?v=${videoId}`;
      const channelName = topVideo.channel?.name || 'YouTube Streamer';
      const viewsCount = topVideo.views || 0;
      console.log(`[YouTube] Selected top video "${videoTitle}" with ${viewsCount.toLocaleString()} views`);

      let transcriptText = '';
      try {
        const transcriptEntries = await YoutubeTranscript.fetchTranscript(videoId);
        transcriptText = transcriptEntries.map((t: any) => t.text).join(' ');
        console.log(`[YouTube] Extracted transcript (${transcriptText.length} chars) for video ${videoId}`);
      } catch (transcriptErr: any) {
        console.warn(`[YouTube] Could not fetch subtitles for ${videoId}:`, transcriptErr.message);
        // Fallback: use title and channel context
        transcriptText = `Видео летсплея игры ${gameTitle} от автора ${channelName} с названием "${videoTitle}". Количество просмотров: ${viewsCount}.`;
      }

      console.log(`[YouTube] Generating AI blogger conclusion for "${gameTitle}"...`);
      const bloggerConclusion = await geminiService.summarizeBloggerVideo(gameTitle, transcriptText);

      return {
        gameId,
        videoId,
        videoTitle,
        videoUrl,
        channelName,
        viewsCount,
        bloggerConclusion,
        transcriptSample: transcriptText.slice(0, 500)
      };
    } catch (err: any) {
      console.error(`[YouTube] Error analyzing video for "${gameTitle}":`, err.message);
      return null;
    }
  }
}

export const youtubeService = new YouTubeService();
