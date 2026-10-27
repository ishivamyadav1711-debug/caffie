import dns from 'dns';
import * as cheerio from 'cheerio';
import {
  SocialConnector,
  SocialConnectorResult,
  ConnectorFetchOptions,
  SocialSignalRecord,
  CollectionStatus,
  FeedRegistryEntry,
} from '../types';
import { createContentHash, normalizeUtcDate, sanitizeString } from '../hashUtils';

// Standard public feeds registry (curated, independent public business & tech discussion feeds)
// Zero Reddit RSS feeds: Reddit social signals are ingested exclusively via the native Reddit connector
export const DEFAULT_FEED_REGISTRY: FeedRegistryEntry[] = [
  {
    id: 'wptavern_news_rss',
    name: 'WordPress Tavern News',
    url: 'https://wptavern.com/feed',
    enabled: true,
    pollingIntervalMinutes: 60,
    scope: 'wordpress_ecosystem',
  },
  {
    id: 'smashingmag_rss',
    name: 'Smashing Magazine Web Design RSS',
    url: 'https://www.smashingmagazine.com/feed/',
    enabled: true,
    pollingIntervalMinutes: 120,
    scope: 'web_design_development',
  },
  {
    id: 'hn_frontpage_rss',
    name: 'Hacker News Frontpage RSS',
    url: 'https://news.ycombinator.com/rss',
    enabled: true,
    pollingIntervalMinutes: 60,
    scope: 'tech_news',
  },
];

const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // 127.0.0.0/8 (Loopback)
  /^10\./,                           // 10.0.0.0/8 (Private)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12 (Private)
  /^192\.168\./,                     // 192.168.0.0/16 (Private)
  /^169\.254\./,                     // 169.254.0.0/16 (Link-local)
  /^0\./,                            // 0.0.0.0/8
  /^localhost$/i,
  /^::1$/,                           // IPv6 loopback
  /^[fF][cCdD]/,                     // Unique local address fc00::/7
  /^[fF][eE][89aAbB]/,               // Link-local fe80::/10
];

const MAX_FEED_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB maximum response size

/**
 * Validates whether a hostname resolves to a safe, public, non-SSRF IP.
 */
export async function isSafePublicUrl(urlStr: string): Promise<{ safe: boolean; reason?: string; resolvedIp?: string }> {
  try {
    const parsed = new URL(urlStr);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, reason: 'Invalid protocol: only http and https allowed' };
    }

    const hostname = parsed.hostname.toLowerCase().trim();

    // Check direct hostname string against localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return { safe: false, reason: 'Localhost destinations are strictly prohibited' };
    }

    // Resolve DNS
    const lookup = await dns.promises.lookup(hostname, { all: true });
    if (!lookup || lookup.length === 0) {
      return { safe: false, reason: 'DNS lookup returned no addresses' };
    }

    for (const addr of lookup) {
      for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(addr.address)) {
          return {
            safe: false,
            reason: `Resolved IP (${addr.address}) belongs to private/internal range`,
            resolvedIp: addr.address,
          };
        }
      }
    }

    return { safe: true, resolvedIp: lookup[0]?.address };
  } catch (err: any) {
    return { safe: false, reason: `DNS resolution failed: ${err.message}` };
  }
}

export class PublicRssConnector implements SocialConnector {
  readonly platform = 'rss' as const;
  readonly name = 'Public RSS & Atom Feed Connector';

  private registry: FeedRegistryEntry[] = [...DEFAULT_FEED_REGISTRY];
  private userAgent = 'Mozilla/5.0 (compatible; LeadPilot-FeedReader/1.0; +https://leadpilot.co)';

  isAvailable(): boolean {
    return true;
  }

  getRegistry(): FeedRegistryEntry[] {
    return this.registry;
  }

  addFeed(feed: FeedRegistryEntry): void {
    if (!this.registry.some((f) => f.id === feed.id || f.url === feed.url)) {
      this.registry.push(feed);
    }
  }

  async collect(options: ConnectorFetchOptions = {}): Promise<SocialConnectorResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs || 8000;
    const limit = Math.min(Math.max(options.limit || 15, 1), 50);

    // If specific feedUrl is passed, fetch only that; otherwise fetch all enabled feeds in registry
    const targetFeeds = options.feedUrl
      ? [{ id: 'custom_feed', name: 'Custom Feed', url: options.feedUrl, enabled: true, pollingIntervalMinutes: 60, scope: 'custom' }]
      : this.registry.filter((f) => f.enabled);

    if (targetFeeds.length === 0) {
      return {
        records: [],
        diagnostic: {
          platform: this.platform,
          accessMethod: 'public_rss',
          status: 'EMPTY',
          recordsFound: 0,
          durationMs: Date.now() - startTime,
          error: 'No active RSS feeds configured in registry',
        },
      };
    }

    const allRecords: SocialSignalRecord[] = [];
    const errors: string[] = [];

    for (const feed of targetFeeds) {
      try {
        const feedRecords = await this.fetchAndParseFeed(feed.url, timeoutMs, limit, feed.name);
        allRecords.push(...feedRecords);
      } catch (err: any) {
        errors.push(`[${feed.name}] ${err.message}`);
      }
    }

    const status: CollectionStatus = allRecords.length > 0 ? 'SUCCESS' : (errors.length > 0 ? 'FAILED' : 'EMPTY');

    return {
      records: allRecords,
      diagnostic: {
        platform: this.platform,
        accessMethod: 'public_rss',
        status,
        recordsFound: allRecords.length,
        durationMs: Date.now() - startTime,
        error: errors.length > 0 ? errors.join('; ') : undefined,
      },
    };
  }

  /**
   * Fetches an RSS or Atom feed with full SSRF check, redirect validation, and byte size limit.
   */
  public async fetchAndParseFeed(
    feedUrl: string,
    timeoutMs: number,
    limit: number,
    feedSource = 'RSS Feed'
  ): Promise<SocialSignalRecord[]> {
    // 1. SSRF Safety Check
    const ssrfCheck = await isSafePublicUrl(feedUrl);
    if (!ssrfCheck.safe) {
      throw new Error(`SSRF Security Guard Blocked Feed URL: ${ssrfCheck.reason}`);
    }

    // 2. Fetch with manual redirect handling to ensure redirects do not target internal IPs
    let currentUrl = feedUrl;
    let res: Response | null = null;
    const maxRedirects = 3;

    for (let r = 0; r <= maxRedirects; r++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        res = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual', // Enforce manual redirect inspection
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      // Check if redirect
      if (res.status >= 301 && res.status <= 308) {
        const location = res.headers.get('location');
        if (!location) throw new Error(`HTTP ${res.status} redirect without Location header`);

        const nextUrl = new URL(location, currentUrl).toString();
        const nextCheck = await isSafePublicUrl(nextUrl);
        if (!nextCheck.safe) {
          throw new Error(`SSRF Blocked Redirect Destination (${nextUrl}): ${nextCheck.reason}`);
        }
        currentUrl = nextUrl;
        continue;
      }

      break;
    }

    if (!res || !res.ok) {
      throw new Error(`HTTP ${res?.status || 'Unknown'} from feed endpoint`);
    }

    // Check Content-Length header if present
    const contentLength = Number(res.headers.get('content-length'));
    if (!isNaN(contentLength) && contentLength > MAX_FEED_SIZE_BYTES) {
      throw new Error(`Feed response size (${contentLength} bytes) exceeds safety limit of 2MB`);
    }

    const xmlText = await res.text();
    if (xmlText.length > MAX_FEED_SIZE_BYTES) {
      throw new Error(`Feed text payload exceeds safety limit of 2MB`);
    }

    return this.parseFeedXml(xmlText, currentUrl, limit, feedSource);
  }

  /**
   * Robustly parses either RSS 2.0 or Atom 1.0 XML into SocialSignalRecord array.
   */
  public parseFeedXml(
    xmlContent: string,
    feedUrl: string,
    limit: number,
    feedSource = 'RSS Feed'
  ): SocialSignalRecord[] {
    const $ = cheerio.load(xmlContent, { xml: true });
    const records: SocialSignalRecord[] = [];

    // --- Format A: RSS 2.0 (<rss><channel><item>) ---
    const rssItems = $('item');
    if (rssItems.length > 0) {
      rssItems.slice(0, limit).each((_, el) => {
        const item = $(el);
        const title = sanitizeString(item.find('title').first().text(), 500);
        const rawLink = item.find('link').first().text().trim();
        const guid = item.find('guid').first().text().trim() || rawLink;
        const description = item.find('description').first().text() || item.find('content\\:encoded').first().text() || '';
        
        // Clean HTML tags from content description
        const cleanContent = cheerio.load(description).text().trim() || title;
        const author = item.find('dc\\:creator').first().text().trim() || item.find('author').first().text().trim() || null;
        const pubDateStr = item.find('pubDate').first().text().trim() || item.find('dc\\:date').first().text().trim();

        if (title || cleanContent) {
          const recordId = sanitizeString(guid || rawLink || createContentHash('rss', feedUrl, title));
          const sourceUrl = rawLink || feedUrl;

          records.push({
            source_platform: 'rss',
            source_record_id: recordId,
            source_url: sourceUrl,
            author_handle: author ? sanitizeString(author) : null,
            publication_timestamp: normalizeUtcDate(pubDateStr),
            retrieved_at: new Date().toISOString(),
            title: title || 'Untitled RSS Item',
            content_text: sanitizeString(cleanContent, 5000),
            content_hash: createContentHash('rss', recordId, cleanContent),
            access_method: 'public_rss',
            collection_status: 'SUCCESS',
            metadata: {
              feedSource,
              feedUrl,
            },
          });
        }
      });
      return records;
    }

    // --- Format B: Atom 1.0 (<feed><entry>) ---
    const atomEntries = $('entry');
    if (atomEntries.length > 0) {
      atomEntries.slice(0, limit).each((_, el) => {
        const entry = $(el);
        const title = sanitizeString(entry.find('title').first().text(), 500);
        const id = entry.find('id').first().text().trim();
        
        let link = entry.find('link[rel="alternate"]').attr('href') || entry.find('link').attr('href') || '';
        link = link.trim();

        const content = entry.find('content').first().text() || entry.find('summary').first().text() || '';
        const cleanContent = cheerio.load(content).text().trim() || title;
        const author = entry.find('author > name').first().text().trim() || null;
        const publishedDate = entry.find('published').first().text().trim() || entry.find('updated').first().text().trim();

        if (title || cleanContent) {
          const recordId = sanitizeString(id || link || createContentHash('rss', feedUrl, title));
          const sourceUrl = link || feedUrl;

          records.push({
            source_platform: 'rss',
            source_record_id: recordId,
            source_url: sourceUrl,
            author_handle: author ? sanitizeString(author) : null,
            publication_timestamp: normalizeUtcDate(publishedDate),
            retrieved_at: new Date().toISOString(),
            title: title || 'Untitled Atom Entry',
            content_text: sanitizeString(cleanContent, 5000),
            content_hash: createContentHash('rss', recordId, cleanContent),
            access_method: 'public_rss',
            collection_status: 'SUCCESS',
            metadata: {
              feedSource,
              feedUrl,
            },
          });
        }
      });
      return records;
    }

    return [];
  }

  /**
   * Parse XML content supporting both RSS 2.0 (<item>) and Atom (<entry>) returning SocialSignal[]
   */
  public static parseXml(
    xmlContent: string,
    sourceName: string,
    feedUrl: string,
    limit: number = 10
  ): import('../types').SocialSignal[] {
    const $ = cheerio.load(xmlContent, { xml: true });
    const signals: import('../types').SocialSignal[] = [];

    // 1. Try RSS 2.0 items
    $('item').each((_, el) => {
      if (signals.length >= limit) return false;
      const $el = $(el);
      const title = $el.find('title').first().text().replace(/<[^>]+>/g, '').trim();
      const link = $el.find('link').first().text().trim() || $el.find('guid').first().text().trim();
      const desc = $el.find('content\\:encoded').first().text() || $el.find('description').first().text() || '';
      const cleanDesc = cheerio.load(desc).text().trim() || title;
      const author = $el.find('dc\\:creator').first().text().trim() || $el.find('author').first().text().trim() || sourceName;
      const pubDate = $el.find('pubDate').first().text().trim();

      if (title && link) {
        signals.push({
          id: `rss_${Buffer.from(link).toString('base64url').slice(0, 24)}`,
          platform: 'rss',
          originalId: link,
          url: link,
          author: author || 'feed_author',
          title,
          text: cleanDesc || title,
          publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          collectedAt: new Date().toISOString(),
          language: 'en',
          rawMetadata: { feedUrl, sourceName },
        });
      }
    });

    // 2. Try Atom entries
    if (signals.length === 0) {
      $('entry').each((_, el) => {
        if (signals.length >= limit) return false;
        const $el = $(el);
        const title = $el.find('title').first().text().replace(/<[^>]+>/g, '').trim();
        let link = $el.find('link').attr('href') || $el.find('id').first().text().trim();
        const content = $el.find('content').first().text() || $el.find('summary').first().text() || '';
        const cleanContent = cheerio.load(content).text().trim() || title;
        const author = $el.find('author name').first().text().trim() || sourceName;
        const updated = $el.find('updated').first().text().trim() || $el.find('published').first().text().trim();

        if (title && link) {
          signals.push({
            id: `atom_${Buffer.from(link).toString('base64url').slice(0, 24)}`,
            platform: 'rss',
            originalId: link,
            url: link,
            author: author || 'feed_author',
            title,
            text: cleanContent || title,
            publishedAt: updated ? new Date(updated).toISOString() : new Date().toISOString(),
            collectedAt: new Date().toISOString(),
            language: 'en',
            rawMetadata: { feedUrl, sourceName, format: 'atom' },
          });
        }
      });
    }

    return signals;
  }

  /**
   * Search across default configured feeds and dynamic topic search feed for keyword
   */
  public static async searchFeeds(
    keyword: string,
    limit: number = 10,
    customFeeds?: { name: string; url: string; category?: string }[]
  ): Promise<import('../types').SocialSignal[]> {
    const feedsToQuery = [
      ...(customFeeds && customFeeds.length > 0 ? customFeeds : [
        { name: 'Hacker News Ask HN RSS', url: 'https://news.ycombinator.com/askrss', category: 'tech_discussion' },
        { name: 'Reddit SaaS RSS', url: 'https://www.reddit.com/r/SaaS/new.rss', category: 'saas' },
        { name: 'Reddit SmallBusiness RSS', url: 'https://www.reddit.com/r/smallbusiness/new.rss', category: 'small_business' },
      ]),
      {
        name: 'Google News B2B Topic RSS',
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=en-US&gl=US&ceid=US:en`,
        category: 'topic_search',
      },
    ];

    const lowerKeyword = keyword.toLowerCase();
    const results = await Promise.allSettled(
      feedsToQuery.map(async (feed) => {
        try {
          const res = await fetch(feed.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; LeadPilot/1.0; +https://leadpilot.app)',
              Accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml, */*',
            },
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) return [];
          const xml = await res.text();
          const $ = cheerio.load(xml, { xml: true });
          const items: import('../types').SocialSignal[] = [];

          $('item').slice(0, 15).each((_, el) => {
            const item = $(el);
            const title = item.find('title').first().text().replace(/<[^>]+>/g, '').trim();
            const link = item.find('link').first().text().trim() || item.find('guid').first().text().trim();
            const desc = item.find('content\\:encoded').first().text() || item.find('description').first().text() || '';
            const cleanDesc = cheerio.load(desc).text().trim() || title;
            const author = item.find('dc\\:creator').first().text().trim() || item.find('author').first().text().trim() || feed.name;
            const pubDate = item.find('pubDate').first().text().trim();

            if (title && link) {
              items.push({
                id: `rss_${Buffer.from(link).toString('base64url').slice(0, 24)}`,
                platform: 'rss',
                originalId: link,
                url: link,
                author: author || 'feed_author',
                title,
                text: cleanDesc || title,
                publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
                collectedAt: new Date().toISOString(),
                language: 'en',
                rawMetadata: { feedUrl: feed.url, sourceName: feed.name },
              });
            }
          });

          return items;
        } catch {
          return [];
        }
      })
    );

    const allSignals: import('../types').SocialSignal[] = [];
    const seenUrls = new Set<string>();

    for (const res of results) {
      if (res.status === 'fulfilled') {
        for (const sig of res.value) {
          if (!seenUrls.has(sig.url)) {
            seenUrls.add(sig.url);
            allSignals.push(sig);
          }
        }
      }
    }

    const queryTokens = lowerKeyword.split(/\s+/).filter((t) => t.length > 2);
    const matched = allSignals.filter((signal) => {
      if (signal.rawMetadata?.sourceName?.includes('Topic RSS')) {
        return true;
      }
      const combined = `${signal.title} ${signal.text}`.toLowerCase();
      if (combined.includes(lowerKeyword)) return true;
      if (queryTokens.length > 0 && queryTokens.some((t) => combined.includes(t))) return true;
      return false;
    });

    return matched.slice(0, limit);
  }

  /**
   * Standardized search interface matching other social connectors
   */
  public static async search(
    query: string,
    options: { limit?: number; customFeeds?: { name: string; url: string; category?: string }[] } = {}
  ): Promise<{ signals: import('../types').SocialSignal[]; status: import('../types').ConnectorStatus; error?: string }> {
    try {
      const signals = await PublicRssConnector.searchFeeds(query, options.limit || 10, options.customFeeds);
      return {
        signals,
        status: 'READY',
      };
    } catch (err: any) {
      return {
        signals: [],
        status: 'ERROR',
        error: `RSS search failed: ${err.message}`,
      };
    }
  }
}

export const publicRssConnector = new PublicRssConnector();
export { PublicRssConnector as RssFeedConnector };

