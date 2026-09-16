import puppeteerExtra from 'puppeteer-extra';
const puppeteer = (puppeteerExtra as any).default || puppeteerExtra;
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { config } from '../config.js';
import { GameInput, GamePlatformInput } from '../db/gameRepository.js';

puppeteer.use(StealthPlugin());

export interface ScrapedGameData {
  gameInput: GameInput;
  criticReviews: string[];
  userReviews: string[];
}

export class MetacriticScraper {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.connected) {
      const launchOptions: any = {
        headless: config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run'
        ]
      };

      const proxy = config.getActiveProxyUrl();
      if (proxy) {
        try {
          const u = new URL(proxy);
          launchOptions.args.push(`--proxy-server=${u.protocol}//${u.host}`);
        } catch {}
      }

      if (config.executablePath) {
        launchOptions.executablePath = config.executablePath;
      }

      this.browser = (await puppeteer.launch(launchOptions)) as Browser;
    }
    return this.browser!;
  }

  private async createPage(): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    const proxy = config.getActiveProxyUrl();
    if (proxy) {
      try {
        const u = new URL(proxy);
        if (u.username && u.password) {
          await page.authenticate({
            username: decodeURIComponent(u.username),
            password: decodeURIComponent(u.password)
          });
        }
      } catch {}
    }

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Block images, fonts and media to save bandwidth and speed up page load
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    return page;
  }

  /**
   * 1. Get initial 20 game URLs from https://www.metacritic.com/game/
   */
  async getNewReleasesUrls(): Promise<string[]> {
    const page = await this.createPage();
    try {
      console.log('[Metacritic] Fetching New Releases from https://www.metacritic.com/game/ ...');
      await page.goto('https://www.metacritic.com/game/', {
        waitUntil: 'domcontentloaded',
        timeout: 40000
      });

      const urls = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        const found = new Set<string>();

        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          // We want /game/<slug>/ excluding top level sections like /game/all/, /game/ps5/, etc.
          const match = href.match(/^\/game\/([a-z0-9-]+)\/?$/i);
          if (match) {
            const slug = match[1].toLowerCase();
            const blacklist = ['all', 'pc', 'ps5', 'ps4', 'xbox-series-x', 'xbox-one', 'nintendo-switch', 'news', 'features'];
            if (!blacklist.includes(slug)) {
              found.add(`https://www.metacritic.com/game/${slug}/`);
            }
          }
        }
        return Array.from(found);
      });

      console.log(`[Metacritic] Discovered ${urls.length} games on /game/ page`);
      return urls;
    } finally {
      await page.close();
    }
  }

  /**
   * 2. Get game URLs from SEE ALL page: https://www.metacritic.com/browse/game/all/all-time/new/?page=N
   */
  async getSeeAllPageUrls(pageNumber: number): Promise<string[]> {
    const page = await this.createPage();
    try {
      const url = `https://www.metacritic.com/browse/game/all/all-time/new/?page=${pageNumber}`;
      console.log(`[Metacritic] Fetching SEE ALL page ${pageNumber} from ${url} ...`);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 40000
      });

      const urls = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        const found = new Set<string>();

        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          const match = href.match(/^\/game\/([a-z0-9-]+)\/?$/i);
          if (match) {
            const slug = match[1].toLowerCase();
            const blacklist = ['all', 'pc', 'ps5', 'ps4', 'xbox-series-x', 'xbox-one', 'nintendo-switch', 'news', 'features'];
            if (!blacklist.includes(slug)) {
              found.add(`https://www.metacritic.com/game/${slug}/`);
            }
          }
        }
        return Array.from(found);
      });

      console.log(`[Metacritic] Discovered ${urls.length} games on SEE ALL page ${pageNumber}`);
      return urls;
    } finally {
      await page.close();
    }
  }

  /**
   * 3. Scrape full game details from game page
   */
  async scrapeGameDetails(gameUrl: string, todayDate: string): Promise<ScrapedGameData | null> { return this.scrapeGamePage(gameUrl, todayDate); }

  async scrapeGamePage(gameUrl: string, todayDate: string): Promise<ScrapedGameData | null> {
    const page = await this.createPage();
    try {
      console.log(`[Metacritic] Scraping game page: ${gameUrl} ...`);
      await page.goto(gameUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });

      // Extract JSON-LD and page DOM info
      const pageInfo = await page.evaluate(() => {
        let ld: any = null;
        try {
          const script = document.querySelector('script[type="application/ld+json"]');
          if (script && script.textContent) {
            ld = JSON.parse(script.textContent);
          }
        } catch {}

        const title = ld?.name || document.querySelector('h1')?.textContent?.trim() || '';
        const description = ld?.description || document.querySelector('.c-productDetails_description, [class*="description"]')?.textContent?.trim() || '';
        const coverImage = ld?.image ||
          document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
          document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
          (document.querySelector('img[src*="catalog"], img[src*="hub"], .c-productHero_image img') as HTMLImageElement)?.src || '';

        // Video URL (trailer)
        let videoUrl = ld?.trailer?.embedUrl || ld?.trailer?.contentUrl || '';
        if (!videoUrl) {
          const videoEl = document.querySelector('video, iframe[src*="youtube"], iframe[src*="video"], a[href*="video"]');
          if (videoEl?.tagName === 'IFRAME') videoUrl = (videoEl as HTMLIFrameElement).src;
          else if (videoEl?.tagName === 'VIDEO') videoUrl = (videoEl as HTMLVideoElement).src;
        }

        // Developer
        const devSpans = Array.from(document.querySelectorAll('span, div, a'));
        const devLabel = devSpans.find(s => s.textContent?.trim() === 'Developer:');
        const developer = devLabel?.parentElement?.querySelector('a, span:last-child')?.textContent?.trim() ||
                          (ld?.author ? (Array.isArray(ld.author) ? ld.author[0]?.name : ld.author?.name) : '') ||
                          (ld?.publisher ? (Array.isArray(ld.publisher) ? ld.publisher[0]?.name : ld.publisher?.name) : '') ||
                          'Unknown Developer';

        // Platforms & Scores
        const metascoreFromLd = ld?.aggregateRating?.ratingValue ? parseInt(ld.aggregateRating.ratingValue, 10) : null;
        const platformsList: string[] = Array.isArray(ld?.gamePlatform) ? ld.gamePlatform : (ld?.gamePlatform ? [ld.gamePlatform] : ['PC']);

        // 1. Check for specific platform score cards in "All Platforms" section
        const platformCards = Array.from(document.querySelectorAll('.product-score-card--platform')).map(card => {
          const href = card.getAttribute('href') || '';
          const platformParam = href.match(/platform=([a-z0-9-]+)/i)?.[1] || '';
          const scoreMatch = card.textContent?.match(/([0-9]{1,3})\s*$/) || card.textContent?.match(/Critic Reviews\s*([0-9]{1,3})/i);
          const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
          return {
            platformParam,
            score
          };
        }).filter(c => c.platformParam && c.score !== null);

        // 2. Look for userscore in DOM
        let userscore: number | null = null;
        const scoreWrappers = Array.from(document.querySelectorAll('[data-testid="global-score-wrapper"], [class*="productScoreInfo"], div'));
        for (const w of scoreWrappers) {
          const txt = w.textContent?.trim() || '';
          if (txt.toLowerCase().includes('user score') && (txt.toLowerCase().includes('based on') || txt.toLowerCase().includes('rating'))) {
            const match = txt.match(/([0-9]{1,2}\.[0-9])/);
            if (match) {
              userscore = parseFloat(match[1]);
              break;
            }
          }
        }

        return {
          title,
          description,
          coverImage,
          videoUrl,
          developer,
          metascoreFromLd,
          platformsList,
          platformCards,
          userscore
        };
      });

      if (!pageInfo.title) {
        console.warn(`[Metacritic] Could not find title on ${gameUrl}`);
        return null;
      }

      // Extract slug from URL
      const slugMatch = gameUrl.match(/\/game\/([a-z0-9-]+)/i);
      const slug = slugMatch ? slugMatch[1].toLowerCase() : pageInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const gameId = slug;

      // Platform normalization helper
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

      // Map platforms with individual scores
      const platforms: GamePlatformInput[] = [];

      if (pageInfo.platformCards && pageInfo.platformCards.length > 0) {
        for (const card of pageInfo.platformCards) {
          platforms.push({
            platform: formatPlatformName(card.platformParam),
            metascore: card.score,
            userscore: pageInfo.userscore
          });
        }
      }

      // If any platform from pageInfo.platformsList is missing in platforms, add it
      for (const p of pageInfo.platformsList) {
        const norm = formatPlatformName(p);
        if (!platforms.some(item => item.platform.toLowerCase() === norm.toLowerCase())) {
          platforms.push({
            platform: norm,
            metascore: pageInfo.metascoreFromLd,
            userscore: pageInfo.userscore
          });
        }
      }

      if (platforms.length === 0) {
        platforms.push({
          platform: 'PC',
          metascore: pageInfo.metascoreFromLd,
          userscore: pageInfo.userscore
        });
      }

      // Scrape critic reviews
      const criticReviews = await this.scrapeReviewsSubpage(gameUrl, 'critic-reviews');
      // Scrape user reviews
      const userReviews = await this.scrapeReviewsSubpage(gameUrl, 'user-reviews');

      return {
        gameInput: {
          id: gameId,
          title: pageInfo.title,
          slug,
          coverImage: pageInfo.coverImage,
          developer: pageInfo.developer,
          description: pageInfo.description,
          videoUrl: pageInfo.videoUrl,
          platforms,
          todayDate
        },
        criticReviews,
        userReviews
      };
    } catch (err: any) {
      console.error(`[Metacritic] Error scraping ${gameUrl}:`, err.message);
      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * Helper to scrape quotes from critic-reviews or user-reviews subpages
   */
  private async scrapeReviewsSubpage(baseUrl: string, subpath: 'critic-reviews' | 'user-reviews'): Promise<string[]> {
    const page = await this.createPage();
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/${subpath}/`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});

      const quotes = await page.evaluate(() => {
        // Collect quotes from review cards
        const reviewCards = Array.from(document.querySelectorAll('.c-siteReview, [class*="ReviewCard"], div.bg-gray-50, div[class*="min-h"]'));
        const texts: string[] = [];

        for (const card of reviewCards) {
          const txt = card.textContent?.trim().replace(/\s+/g, ' ') || '';
          // Filter out short or navigation texts
          if (txt.length > 60 && !txt.includes('Explore') && !txt.includes('Privacy Policy')) {
            texts.push(txt.slice(0, 400));
          }
        }

        return texts.slice(0, 10);
      });

      return quotes;
    } catch {
      return [];
    } finally {
      await page.close();
    }
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
    }
  }
}

export const metacriticScraper = new MetacriticScraper();
