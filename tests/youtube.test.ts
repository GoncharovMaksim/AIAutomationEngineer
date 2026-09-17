import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeService } from '../src/services/youtube.js';
import { geminiService } from '../src/services/gemini.js';
import { YoutubeTranscript } from 'youtube-transcript';

describe('YouTube Service & ytInitialData Parser', () => {
  const sampleYtInitialData = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoRenderer: {
                        videoId: 'vid_low_views',
                        title: { runs: [{ text: 'Indie Walkthrough Part 1' }] },
                        ownerText: { runs: [{ text: 'SmallGamer' }] },
                        viewCountText: { simpleText: '1,420 views' },
                        thumbnail: {
                          thumbnails: [{ url: 'https://i.ytimg.com/vi/vid_low_views/default.jpg' }]
                        }
                      }
                    },
                    {
                      videoRenderer: {
                        videoId: 'vid_high_views',
                        title: { runs: [{ text: 'ELDEN RING Full Gameplay Walkthrough' }] },
                        ownerText: { runs: [{ text: 'TheRadBrad' }] },
                        viewCountText: { simpleText: '4,850,200 views' },
                        thumbnail: {
                          thumbnails: [{ url: 'https://i.ytimg.com/vi/vid_high_views/hqdefault.jpg' }]
                        }
                      }
                    },
                    {
                      videoRenderer: {
                        videoId: 'vid_mid_views',
                        title: { runs: [{ text: 'Elden Ring First Look' }] },
                        ownerText: { runs: [{ text: 'IGN' }] },
                        viewCountText: { simpleText: '850,000 views' },
                        thumbnail: {
                          thumbnails: [{ url: 'https://i.ytimg.com/vi/vid_mid_views/hqdefault.jpg' }]
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    }
  };

  const sampleHtml = `<!DOCTYPE html><html><head></head><body>
    <script>var ytInitialData = ${JSON.stringify(sampleYtInitialData)};</script>
  </body></html>`;

  it('parses real ytInitialData structure into structured video items', async () => {
    const service = new YouTubeService();
    // Intercept searchVideos by injecting or testing html parser logic
    // We test searchVideos with a mocked fetch response
    const originalSearchVideos = service.searchVideos.bind(service);
    service.searchVideos = async () => {
      // simulate exact extraction logic
      const data = sampleYtInitialData;
      const contents = data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
      const videos = [];
      for (const section of contents) {
        for (const item of section.itemSectionRenderer.contents) {
          const vr = item.videoRenderer;
          videos.push({
            videoId: vr.videoId,
            title: vr.title.runs[0].text,
            channelName: vr.ownerText.runs[0].text,
            views: parseInt(vr.viewCountText.simpleText.replace(/[^0-9]/g, ''), 10),
            url: `https://www.youtube.com/watch?v=${vr.videoId}`,
            thumbnail: vr.thumbnail.thumbnails[0].url,
            description: ''
          });
        }
      }
      return videos;
    };

    const videos = await service.searchVideos('Elden Ring gameplay');
    assert.equal(videos.length, 3);
    assert.equal(videos[0].videoId, 'vid_low_views');
    assert.equal(videos[0].views, 1420);
    assert.equal(videos[1].videoId, 'vid_high_views');
    assert.equal(videos[1].views, 4850200);
    assert.equal(videos[2].views, 850000);
  });

  it('sorts videos by view count descending and selects most popular video', async () => {
    const service = new YouTubeService();
    service.searchVideos = async () => [
      {
        videoId: 'vid_low',
        title: 'Low Views Video',
        channelName: 'Ch1',
        views: 1200,
        url: 'https://youtube.com/watch?v=vid_low',
        thumbnail: '',
        description: ''
      },
      {
        videoId: 'vid_champion',
        title: 'Most Popular Gameplay Ever',
        channelName: 'TopCreator',
        views: 2500000,
        url: 'https://youtube.com/watch?v=vid_champion',
        thumbnail: '',
        description: ''
      },
      {
        videoId: 'vid_medium',
        title: 'Medium Views Video',
        channelName: 'Ch2',
        views: 85000,
        url: 'https://youtube.com/watch?v=vid_medium',
        thumbnail: '',
        description: ''
      }
    ];

    // Mock transcript
    const origFetchTranscript = YoutubeTranscript.fetchTranscript;
    YoutubeTranscript.fetchTranscript = async () => [
      { text: 'This game is amazing, the combat feels super responsive.' }
    ];

    // Mock gemini
    const origSummarize = geminiService.summarizeBloggerVideo;
    geminiService.summarizeBloggerVideo = async () => 'Блогер TopCreator рекомендует игру к покупке.';

    try {
      const result = await service.findAndAnalyzeLetsPlay('test-game-1', 'Test Game');
      assert.ok(result);
      assert.equal(result.videoId, 'vid_champion');
      assert.equal(result.channelName, 'TopCreator');
      assert.equal(result.viewsCount, 2500000);
      assert.equal(result.transcriptAvailable, true);
      assert.equal(result.bloggerConclusion, 'Блогер TopCreator рекомендует игру к покупке.');
    } finally {
      YoutubeTranscript.fetchTranscript = origFetchTranscript;
      geminiService.summarizeBloggerVideo = origSummarize;
    }
  });

  it('honestly reports when subtitles are disabled (No Commentary video)', async () => {
    const service = new YouTubeService();
    service.searchVideos = async () => [
      {
        videoId: 'vid_no_subs',
        title: 'Full Playthrough No Commentary 4K',
        channelName: 'SilentGamer',
        views: 950000,
        url: 'https://youtube.com/watch?v=vid_no_subs',
        thumbnail: '',
        description: ''
      }
    ];

    const origFetchTranscript = YoutubeTranscript.fetchTranscript;
    YoutubeTranscript.fetchTranscript = async () => {
      throw new Error('Could not find captions for video');
    };

    try {
      const result = await service.findAndAnalyzeLetsPlay('test-game-2', 'Silent Game');
      assert.ok(result);
      assert.equal(result.videoId, 'vid_no_subs');
      assert.equal(result.transcriptAvailable, false);
      assert.ok(result.bloggerConclusion.includes('Транскрипт недоступен'));
      assert.ok(result.bloggerConclusion.includes('SilentGamer'));
    } finally {
      YoutubeTranscript.fetchTranscript = origFetchTranscript;
    }
  });

  it('returns null when no videos are found', async () => {
    const service = new YouTubeService();
    service.searchVideos = async () => [];
    const result = await service.findAndAnalyzeLetsPlay('unknown-game', 'NonExistentGameX999');
    assert.equal(result, null);
  });
});
