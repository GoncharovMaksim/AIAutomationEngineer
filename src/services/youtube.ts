import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { YoutubeTranscript } from 'youtube-transcript';
import { geminiService } from './gemini.js';
import { YoutubeLetsplayInput } from '../db/gameRepository.js';
import { config } from '../config.js';

interface ScrapedVideo {
  videoId: string;
  title: string;
  channelName: string;
  views: number;
  url: string;
  thumbnail: string;
  description: string;
}

export class YouTubeService {
  /**
   * Directly scrape YouTube search results via undici proxy agent
   * Extracts 100% real video IDs, titles, channels, view counts, and thumbnails
   */
  async searchVideos(query: string, proxyAgent?: ProxyAgent): Promise<ScrapedVideo[]> {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`;
    const fetchOptions: any = {
      signal: AbortSignal.timeout(25000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };
    if (proxyAgent) {
      fetchOptions.dispatcher = proxyAgent;
    }

    const res = await undiciFetch(url, fetchOptions);
    if (!res.ok) {
      throw new Error(`YouTube search returned HTTP status ${res.status}`);
    }

    const html = await res.text();
    const match = html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s) || html.match(/ytInitialData\s*=\s*({.+?});/s);
    if (!match) {
      throw new Error('Could not parse ytInitialData from YouTube response');
    }

    const data = JSON.parse(match[1]);
    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (!contents || !Array.isArray(contents)) {
      return [];
    }

    const videos: ScrapedVideo[] = [];
    for (const section of contents) {
      const itemSection = section.itemSectionRenderer?.contents || [];
      for (const item of itemSection) {
        const vr = item.videoRenderer;
        if (vr && vr.videoId) {
          const videoId = vr.videoId;
          const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || '';
          const channelName = vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || 'YouTube Creator';
          const viewsText = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || '0';
          const views = parseInt(viewsText.replace(/[^0-9]/g, ''), 10) || 0;
          const thumbnail = vr.thumbnail?.thumbnails?.pop()?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
          const description = vr.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map((r: any) => r.text).join('') ||
                              vr.descriptionSnippet?.runs?.map((r: any) => r.text).join('') || '';

          videos.push({
            videoId,
            title,
            channelName,
            views,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnail,
            description
          });
        }
      }
    }

    return videos;
  }

  async findAndAnalyzeLetsPlay(gameId: string, gameTitle: string, maxAttempts = 3): Promise<YoutubeLetsplayInput | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let activeProxyUrl: string | undefined = undefined;
      try {
        const query = `${gameTitle} gameplay walkthrough lets play`;
        const proxyAgent = config.getProxyAgent();
        activeProxyUrl = config.getActiveProxyUrl();
        if (proxyAgent) {
          console.log(`[YouTube] (Attempt ${attempt}/${maxAttempts}) Searching via proxy (${activeProxyUrl}): "${query}"`);
        } else {
          console.log(`[YouTube] (Attempt ${attempt}/${maxAttempts}) Searching (direct connection): "${query}"`);
        }

        const searchResults = await this.searchVideos(query, proxyAgent);
        if (!searchResults || searchResults.length === 0) {
          console.warn(`[YouTube] No real videos found for "${gameTitle}"`);
          return null;
        }

        // Pick the most popular video by view count (as explicitly required by TZ)
        searchResults.sort((a, b) => b.views - a.views);
        const topVideo = searchResults[0];
        const videoId = topVideo.videoId;
        const videoTitle = topVideo.title;
        const videoUrl = topVideo.url;
        const channelName = topVideo.channelName;
        const viewsCount = topVideo.views;
        console.log(`[YouTube] Selected top video "${videoTitle}" by "${channelName}" with ${viewsCount.toLocaleString()} views (ID: ${videoId})`);

        let transcriptText = '';
        try {
          const customFetch = (url: any, init: any = {}) => {
            const fetchOpts = { ...init, signal: AbortSignal.timeout(8000) };
            if (proxyAgent) fetchOpts.dispatcher = proxyAgent;
            return undiciFetch(url, fetchOpts);
          };

          const transcriptEntries = await YoutubeTranscript.fetchTranscript(videoId, {
            fetch: customFetch as any
          });
          transcriptText = transcriptEntries.map((t: any) => t.text).join(' ');
          console.log(`[YouTube] Extracted real transcript (${transcriptText.length} chars) for video ${videoId}`);
        } catch (transcriptErr: any) {
          console.warn(`[YouTube] Subtitles unavailable for ${videoId} (${transcriptErr.message}). Using real video metadata & description...`);
          transcriptText = `Видео летсплея игры "${gameTitle}" от канала "${channelName}" с названием "${videoTitle}". Просмотры: ${viewsCount.toLocaleString()}. Описание автора: ${topVideo.description}`;
        }

        console.log(`[YouTube] Generating AI blogger conclusion for "${gameTitle}"...`);
        const bloggerConclusion = await geminiService.summarizeBloggerVideo(gameTitle, transcriptText);

        if (activeProxyUrl) {
          config.markProxySuccess(activeProxyUrl);
        }

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
        if (activeProxyUrl) {
          config.markProxyFailed(activeProxyUrl);
        }
        console.warn(`[YouTube] Attempt ${attempt}/${maxAttempts} failed for "${gameTitle}": ${err.message}`);
        if (attempt < maxAttempts) {
          config.rotateProxy();
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          console.error(`[YouTube] All ${maxAttempts} attempts exhausted for "${gameTitle}"`);
          return null;
        }
      }
    }
    return null;
  }
}

export const youtubeService = new YouTubeService();
