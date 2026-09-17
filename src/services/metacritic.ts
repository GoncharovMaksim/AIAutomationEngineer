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
  private pagesOpenedCount = 0;
  private currentProxyUrl: string | null = null;

  private async getBrowser(): Promise<Browser> {
    // Re-create browser if closed or after 10 page navigations to free memory
    if (this.browser && (!this.browser.connected || this.pagesOpenedCount >= 10)) {
      await this.close();
    }

    if (!this.browser || !this.browser.connected) {
      this.pagesOpenedCount = 0;
      this.currentProxyUrl = config.getActiveProxyUrl() || null;
      const launchOptions: any = {
        headless: config.headless,
        protocolTimeout: 180_000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run'
        ]
      };

      if (this.currentProxyUrl) {
        try {
          const u = new URL(this.currentProxyUrl);
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
    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts++;
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        this.pagesOpenedCount++;

        // Authenticate using the EXACT same proxy URL configured for this browser instance
        if (this.currentProxyUrl) {
          try {
            const u = new URL(this.currentProxyUrl);
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

        return page;
      } catch (err: any) {
        console.warn(`[Metacritic] createPage failed (attempt ${attempts}): ${err.message}. Rotating proxy & recycling browser...`);
        config.rotateProxy();
        await this.close();
        if (attempts >= 3) throw err;
      }
    }
    throw new Error('[Metacritic] Could not create page after recycling browser.');
  }

  private async withPageRetry<T>(action: (page: Page) => Promise<T>, maxRetries = 4): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let page: Page | null = null;
      try {
        page = await this.createPage();
        const activeProxy = this.currentProxyUrl;
        const result = await action(page);
        if (activeProxy) config.markProxySuccess(activeProxy);
        return result;
      } catch (err: any) {
        lastError = err;
        const failedProxy = this.currentProxyUrl;
        if (failedProxy) config.markProxyFailed(failedProxy);
        console.warn(`[Metacritic] Page action failed (attempt ${attempt}/${maxRetries}): ${err.message}. Rotating proxy & recycling browser...`);
        config.rotateProxy();
        await this.close();
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000));
        }
      } finally {
        if (page) {
          await page.close().catch(() => {});
        }
      }
    }
    throw lastError;
  }

  /**
   * 1. Get initial 20 game URLs from https://www.metacritic.com/game/
   */
  async getNewReleasesUrls(): Promise<string[]> {
    return this.withPageRetry(async (page) => {
      console.log('[Metacritic] Fetching New Releases from https://www.metacritic.com/game/ ...');
      await page.goto('https://www.metacritic.com/game/', {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      const urls = await page.evaluate(() => {
        // Target specifically the New Releases carousel section
        const headings = Array.from(document.querySelectorAll('h2, h3, div, span'));
        const nrHeading = headings.find(h => h.textContent?.trim().toLowerCase() === 'new releases');
        const carousel = nrHeading?.closest('.global-carousel');
        let anchors = carousel ? Array.from(carousel.querySelectorAll('a')) : [];
        if (anchors.length === 0) {
          anchors = Array.from(document.querySelectorAll('a'));
        }

        const found = new Set<string>();
        const blacklist = ['all', 'pc', 'ps5', 'ps4', 'xbox-series-x', 'xbox-one', 'nintendo-switch', 'news', 'features'];

        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          // We want /game/<slug>/ excluding top level sections like /game/all/, /game/ps5/, etc.
          const match = href.match(/^\/game\/([a-z0-9-]+)\/?$/i);
          if (match) {
            const slug = match[1].toLowerCase();
            if (!blacklist.includes(slug)) {
              found.add(`https://www.metacritic.com/game/${slug}/`);
            }
          }
        }
        return Array.from(found);
      });

      if (urls.length === 0) {
        throw new Error('Discovered 0 games on /game/ page (proxy blocked or challenge received)');
      }

      console.log(`[Metacritic] Discovered ${urls.length} games on /game/ page`);
      return urls;
    });
  }

  /**
   * 2. Get game URLs from SEE ALL page: https://www.metacritic.com/browse/game/all/all/all-time/new/?page=N
   */
  async getSeeAllPageUrls(pageNumber: number): Promise<string[]> {
    return this.withPageRetry(async (page) => {
      const url = `https://www.metacritic.com/browse/game/all/all/all-time/new/?page=${pageNumber}`;
      console.log(`[Metacritic] Fetching SEE ALL page ${pageNumber} from ${url} ...`);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      const urls = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        const found = new Set<string>();
        const blacklist = ['all', 'pc', 'ps5', 'ps4', 'xbox-series-x', 'xbox-one', 'nintendo-switch', 'news', 'features'];

        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          const match = href.match(/^\/game\/([a-z0-9-]+)\/?$/i);
          if (match) {
            const slug = match[1].toLowerCase();
            if (!blacklist.includes(slug)) {
              found.add(`https://www.metacritic.com/game/${slug}/`);
            }
          }
        }
        return Array.from(found);
      });

      if (urls.length === 0 && pageNumber === 1) {
        throw new Error(`Discovered 0 games on SEE ALL page ${pageNumber} (proxy blocked or challenge received)`);
      }

      console.log(`[Metacritic] Discovered ${urls.length} games on SEE ALL page ${pageNumber}`);
      return urls;
    });
  }

  /**
   * 3. Scrape full game details from game page
   */
  async scrapeGameDetails(gameUrl: string, todayDate: string): Promise<ScrapedGameData | null> { return this.scrapeGamePage(gameUrl, todayDate); }

  async scrapeGamePage(gameUrl: string, todayDate: string): Promise<ScrapedGameData | null> {
    try {
      return await this.withPageRetry(async (page) => {
        console.log(`[Metacritic] Scraping game page: ${gameUrl} ...`);
        await page.goto(gameUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector(
          'a.product-score-card--platform, a[href*="critic-reviews"][href*="platform="], .product-score-card--platform',
          { timeout: 8000 }
        ).catch(() => {});

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
        const platformCards = Array.from(
          document.querySelectorAll('a.product-score-card--platform, a[href*="critic-reviews"][href*="platform="], .product-score-card--platform')
        ).map(card => {
          const href = card.getAttribute('href') || '';
          const platformParam = href.match(/platform=([a-z0-9-]+)/i)?.[1] || '';
          
          // Extract numeric score from the last numeric span (Nuxt score badge) or text fallback
          const spans = Array.from(card.querySelectorAll('span'));
          const scoreSpan = spans.reverse().find(s => /^\d{1,3}$/.test(s.textContent?.trim() || ''));
          const score = scoreSpan
            ? parseInt(scoreSpan.textContent!.trim(), 10)
            : (() => {
                const m = card.textContent?.match(/([0-9]{1,3})\s*$/) || card.textContent?.match(/Critic Reviews\s*([0-9]{1,3})/i);
                return m ? parseInt(m[1], 10) : null;
              })();

          return {
            platformParam,
            score
          };
        }).filter(c => c.platformParam && c.score !== null && c.score >= 1 && c.score <= 100);

        // 2. Look for userscore in DOM
        let userscore: number | null = null;
        // Check direct score badges first
        const directUserScoreEl = document.querySelector(
          '[data-testid="score-user"], [class*="c-siteReviewScore_user"], [class*="c-productScoreInfo_scoreNumber"], .c-productScoreInfo_scoreNumber span'
        );
        if (directUserScoreEl?.textContent) {
          const parsed = parseFloat(directUserScoreEl.textContent.trim());
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 10) {
            userscore = parsed;
          }
        }

        // Fallback: scan score containers
        if (userscore === null) {
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

      // Quality Guard log
      if (!pageInfo.platformCards || pageInfo.platformCards.length === 0) {
        console.warn(`[QualityGuard] ℹ️ Nuxt platform cards not found on ${gameUrl}. Falling back to JSON-LD platform list & aggregate rating.`);
      } else {
        console.log(`[QualityGuard] ✅ Successfully extracted ${pageInfo.platformCards.length} platform cards with individual scores on ${gameUrl}.`);
      }

      // Map platforms with individual scores
      const platforms: GamePlatformInput[] = [];

      if (pageInfo.platformCards && pageInfo.platformCards.length > 0) {
        for (const card of pageInfo.platformCards) {
          let metascore = card.score;
          let userscore = pageInfo.userscore;

          // Optional deep per-platform subpage traversal if DEEP_PLATFORM_SCRAPING is enabled
          if (config.deepPlatformScraping && card.platformParam) {
            const deep = await this.scrapePlatformScore(slug, card.platformParam);
            if (deep.metascore !== null) metascore = deep.metascore;
            if (deep.userscore !== null) userscore = deep.userscore;
          }

          platforms.push({
            platform: formatPlatformName(card.platformParam),
            metascore,
            userscore
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
    }, 2);
  } catch (err: any) {
    console.error(`[Metacritic] Error scraping ${gameUrl}:`, err.message);
    return null;
  }
}

  /**
   * Helper to scrape quotes from critic-reviews or user-reviews subpages
   */
  private async scrapeReviewsSubpage(baseUrl: string, subpath: 'critic-reviews' | 'user-reviews'): Promise<string[]> {
    const url = `${baseUrl.replace(/\/$/, '')}/${subpath}/`;
    try {
      return await this.withPageRetry(async (page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

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
      }, 2);
    } catch (err: any) {
      console.warn(`[Metacritic] scrapeReviewsSubpage failed for ${url}: ${err.message}`);
      return [];
    }
  }

  /**
   * Optional deep-scraping: visits /critic-reviews/?platform=X to get platform-specific aggregate ratings
   */
  async scrapePlatformScore(slug: string, platformParam: string): Promise<{ metascore: number | null; userscore: number | null }> {
    const url = `https://www.metacritic.com/game/${slug}/critic-reviews/?platform=${platformParam}`;
    try {
      return await this.withPageRetry(async (page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        return page.evaluate(() => {
          let ld: any = null;
          try {
            const s = document.querySelector('script[type="application/ld+json"]');
            if (s?.textContent) ld = JSON.parse(s.textContent);
          } catch {}
          const metascore = ld?.aggregateRating?.ratingValue ? parseInt(ld.aggregateRating.ratingValue, 10) : null;
          let userscore: number | null = null;
          const userEl = document.querySelector('[data-testid="score-user"], [class*="c-siteReviewScore_user"]');
          if (userEl?.textContent) {
            const val = parseFloat(userEl.textContent.trim());
            if (!isNaN(val) && val >= 0 && val <= 10) userscore = val;
          }
          return { metascore, userscore };
        });
      }, 2);
    } catch {
      return { metascore: null, userscore: null };
    }
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
      this.pagesOpenedCount = 0;
    }
    this.currentProxyUrl = null;
  }
}

export const metacriticScraper = new MetacriticScraper();
