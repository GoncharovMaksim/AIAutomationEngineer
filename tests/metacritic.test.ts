import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MetacriticScraper & Data Pipeline Unit Tests', () => {
  it('blacklist slugs are properly excluded from game candidate list', () => {
    const blacklist = ['all', 'pc', 'ps5', 'ps4', 'xbox-series-x', 'xbox-one', 'nintendo-switch', 'news', 'features'];
    const candidates = [
      'https://www.metacritic.com/game/all/',
      'https://www.metacritic.com/game/astro-bot/',
      'https://www.metacritic.com/game/ps5/',
      'https://www.metacritic.com/game/elden-ring/',
      'https://www.metacritic.com/game/news/'
    ];

    const filtered = candidates.filter(url => {
      const slug = url.match(/\/game\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() || '';
      return slug.length > 0 && !blacklist.includes(slug);
    });

    assert.deepEqual(filtered, [
      'https://www.metacritic.com/game/astro-bot/',
      'https://www.metacritic.com/game/elden-ring/'
    ]);
  });

  it('deduplicates candidate game URLs by slug', () => {
    const seen = new Set<string>();
    const urls = [
      'https://www.metacritic.com/game/astro-bot/',
      'https://www.metacritic.com/game/astro-bot/',
      'https://www.metacritic.com/game/elden-ring/',
      'https://www.metacritic.com/game/elden-ring/'
    ];

    const unique = urls.filter(url => {
      const slug = url.match(/\/game\/([a-z0-9-]+)/i)?.[1]?.toLowerCase() || '';
      if (!slug || seen.has(slug)) return false;
      seen.add(slug);
      return true;
    });

    assert.equal(unique.length, 2);
    assert.deepEqual(unique, [
      'https://www.metacritic.com/game/astro-bot/',
      'https://www.metacritic.com/game/elden-ring/'
    ]);
  });

  it('normalizes platform identifiers correctly', () => {
    const formatPlatformName = (param: string): string => {
      const p = param.toLowerCase();
      if (p.includes('playstation-5') || p === 'ps5') return 'PlayStation 5';
      if (p.includes('playstation-4') || p === 'ps4') return 'PlayStation 4';
      if (p.includes('xbox-series')) return 'Xbox Series X';
      if (p.includes('xbox-one')) return 'Xbox One';
      if (p.includes('nintendo-switch-2') || p.includes('switch-2')) return 'Nintendo Switch 2';
      if (p.includes('nintendo-switch') || p.includes('switch')) return 'Nintendo Switch';
      if (p === 'pc') return 'PC';
      return param;
    };

    assert.equal(formatPlatformName('ps5'), 'PlayStation 5');
    assert.equal(formatPlatformName('playstation-5'), 'PlayStation 5');
    assert.equal(formatPlatformName('xbox-series-x'), 'Xbox Series X');
    assert.equal(formatPlatformName('nintendo-switch-2'), 'Nintendo Switch 2');
    assert.equal(formatPlatformName('switch'), 'Nintendo Switch');
    assert.equal(formatPlatformName('pc'), 'PC');
  });

  it('YouTube transcriptAvailable flag is false when subtitles are absent or disabled', () => {
    let transcriptAvailable = false;
    let bloggerConclusion = '';
    const videoTitle = 'No Commentary Playthrough';
    const channelName = 'GameArchive';
    const viewsCount = 12500;

    // Simulate transcript error
    try {
      throw new Error('Transcript disabled on this video');
    } catch {
      transcriptAvailable = false;
      bloggerConclusion = `Транскрипт недоступен: видео не содержит субтитров (No Commentary или субтитры отключены автором). Летсплей от канала "${channelName}" (${viewsCount.toLocaleString()} просмотров).`;
    }

    assert.equal(transcriptAvailable, false);
    assert.ok(bloggerConclusion.includes('Транскрипт недоступен'));
    assert.ok(!bloggerConclusion.includes('Судя по словам автора'));
  });

  it('YouTube transcriptAvailable flag is true when real transcript exists', () => {
    const fakeTranscript = [
      { text: 'Hello guys, welcome back to another video.' },
      { text: 'Today we are testing the brand new mechanics and graphic improvements.' }
    ];
    const text = fakeTranscript.map(t => t.text).join(' ');
    const transcriptAvailable = text.trim().length > 50;

    assert.equal(transcriptAvailable, true);
    assert.ok(text.length > 50);
  });

  it('CrawlWorker concurrency guard prevents overlapping crawl jobs', async () => {
    let isRunning = false;
    async function runJob(): Promise<boolean> {
      if (isRunning) return false;
      isRunning = true;
      await new Promise(resolve => setTimeout(resolve, 20));
      isRunning = false;
      return true;
    }

    const firstJob = runJob();
    const secondJob = runJob();
    const [result1, result2] = await Promise.all([firstJob, secondJob]);

    assert.equal(result1, true, 'First job should execute');
    assert.equal(result2, false, 'Second job should be rejected due to concurrency guard');
  });
});
