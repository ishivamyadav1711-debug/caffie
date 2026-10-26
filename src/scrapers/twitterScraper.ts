/**
 * X (Twitter) High-Intent Tweet Scraper
 * Uses Playwright with Stealth plugin in visible mode (headless: false)
 * with user agent emulation and 10s interactive settle time.
 */

let chromium: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pExtra = require('playwright-extra');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  chromium = pExtra?.chromium;
  if (chromium && StealthPlugin) {
    chromium.use(StealthPlugin());
  }
} catch {
  // Optional dependency for local Twitter scraping
}

export interface TwitterLead {
  platform: 'twitter';
  author: string;
  text: string;
  url: string;
  scrapedAt: string;
}

export async function scrapeTwitter(
  query: string = 'looking for alloy wheels',
  limit: number = 10
): Promise<TwitterLead[]> {
  if (!chromium) {
    console.warn('[X/Twitter Scraper] Optional dependency playwright-extra is not installed.');
    return [];
  }
  console.log(`[X/Twitter Scraper] Launching visible browser for query: "${query}"...`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,800',
      ],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      locale: 'en-US',
    });

    const page = await context.newPage();
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;

    console.log(`[X/Twitter Scraper] Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch((err: any) => {
      console.warn(`[X/Twitter Scraper] Navigation notice: ${err.message}`);
    });

    console.log('[X/Twitter Scraper] Waiting 10 seconds for feed to load (visible browser window open)...');
    await page.waitForTimeout(10000);

    // Check if login dialog / wall is present
    const isLoginWall = await page.evaluate(() => {
      return Boolean(
        document.querySelector('input[autocomplete="username"]') ||
        document.querySelector('[data-testid="loginButton"]') ||
        window.location.href.includes('/i/flow/login')
      );
    });

    if (isLoginWall) {
      console.log('[X/Twitter Scraper] Login prompt detected on screen.');
    }

    // Try extracting any rendered tweet articles
    const leads: TwitterLead[] = await page.evaluate((maxResults: number) => {
      const results: any[] = [];
      const articles = document.querySelectorAll('article[data-testid="tweet"]');

      for (const article of Array.from(articles)) {
        if (results.length >= maxResults) break;

        const textEl = article.querySelector('[data-testid="tweetText"]');
        const userEl = article.querySelector('[data-testid="User-Name"]');
        const linkEl = article.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;

        const text = textEl?.textContent?.trim() || '';
        const author = userEl?.textContent?.trim() || 'Unknown User';
        const href = linkEl?.getAttribute('href') || '';
        const url = href ? (href.startsWith('http') ? href : `https://x.com${href}`) : '';

        if (text || url) {
          results.push({
            platform: 'twitter',
            author,
            text,
            url,
            scrapedAt: new Date().toISOString(),
          });
        }
      }

      return results;
    }, limit);

    console.log(`[X/Twitter Scraper] Extracted ${leads.length} tweets from current session.`);
    return leads;
  } catch (err: any) {
    console.error(`[X/Twitter Scraper] Error during scraping: ${err.message || err}`);
    return [];
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}
