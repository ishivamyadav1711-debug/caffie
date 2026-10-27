/**
 * RSS / Atom Feed Connector
 * Ingests buying intent and software signals from public RSS/Atom feeds,
 * Google Alerts, Substack, Reddit RSS, and B2B forum feeds.
 */

import * as cheerio from 'cheerio';
import { SocialSignal } from '../types';

export interface RssFeedSource {
  name: string;
  url: string;
  category?: string;
}

export class RssFeedConnector {
  /**
   * Default public B2B feeds for software discussions & intent monitoring
   */
  private static defaultFeeds: RssFeedSource[] = [
    {
      name: 'Hacker News Ask HN RSS',
      url: 'https://news.ycombinator.com/askrss',
      category: 'tech_discussion',
    },
    {
      name: 'Reddit SaaS RSS',
      url: 'https://www.reddit.com/r/SaaS/new.rss',
      category: 'saas',
    },
    {
      name: 'Reddit SmallBusiness RSS',
      url: 'https://www.reddit.com/r/smallbusiness/new.rss',
      category: 'small_business',
    },
  ];

  /**
   * Strip HTML tags and clean up text whitespace
   */
  private static cleanText(rawHtml: string): string {
    if (!rawHtml) return '';
    return rawHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Fetch and parse an individual RSS or Atom feed
   */
  public static async fetchFeed(
    feedUrl: string,
    sourceName: string = 'RSS Feed',
    limit: number = 10
  ): Promise<SocialSignal[]> {
    try {
      const response = await fetch(feedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LeadPilot/1.0; +https://leadpilot.app)',
          Accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml, */*',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        console.warn(`[RSS Connector] HTTP ${response.status} fetching feed: ${feedUrl}`);
        return [];
      }

      const xmlText = await response.text();
      return this.parseXml(xmlText, sourceName, feedUrl, limit);
    } catch (err: any) {
      console.warn(`[RSS Connector] Error fetching feed ${feedUrl}:`, err.message);
      return [];
    }
  }

  /**
   * Parse XML content supporting both RSS 2.0 (<item>) and Atom (<entry>)
   */
  public static parseXml(
    xmlContent: string,
    sourceName: string,
    feedUrl: string,
    limit: number = 10
  ): SocialSignal[] {
    const $ = cheerio.load(xmlContent, { xmlMode: true });
    const signals: SocialSignal[] = [];

    // 1. Try RSS 2.0 items
    $('item').each((_, el) => {
      if (signals.length >= limit) return false;
      const $el = $(el);

      const title = this.cleanText($el.find('title').first().text());
      const link = $el.find('link').first().text().trim() || $el.find('guid').first().text().trim();
      const description = this.cleanText(
        $el.find('content\\:encoded').first().text() ||
        $el.find('description').first().text()
      );
      const author = this.cleanText(
        $el.find('dc\\:creator').first().text() ||
        $el.find('author').first().text() ||
        sourceName
      );
      const pubDate = $el.find('pubDate').first().text().trim();

      if (title && link) {
        const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
        signals.push({
          id: `rss_${Buffer.from(link).toString('base64url').slice(0, 24)}`,
          platform: 'rss',
          originalId: link,
          url: link,
          author: author || 'feed_author',
          title,
          text: description || title,
          publishedAt,
          collectedAt: new Date().toISOString(),
          language: 'en',
          rawMetadata: { feedUrl, sourceName },
        });
      }
    });

    // 2. If no RSS items found, try Atom entries (<entry>)
    if (signals.length === 0) {
      $('entry').each((_, el) => {
        if (signals.length >= limit) return false;
        const $el = $(el);

        const title = this.cleanText($el.find('title').first().text());
        let link = $el.find('link').attr('href') || $el.find('id').first().text().trim();
        const content = this.cleanText(
          $el.find('content').first().text() ||
          $el.find('summary').first().text()
        );
        const author = this.cleanText(
          $el.find('author name').first().text() || sourceName
        );
        const updated = $el.find('updated').first().text().trim() || $el.find('published').first().text().trim();

        if (title && link) {
          signals.push({
            id: `atom_${Buffer.from(link).toString('base64url').slice(0, 24)}`,
            platform: 'rss',
            originalId: link,
            url: link,
            author: author || 'feed_author',
            title,
            text: content || title,
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
    customFeeds?: RssFeedSource[]
  ): Promise<SocialSignal[]> {
    const feedsToQuery: RssFeedSource[] = [
      ...(customFeeds && customFeeds.length > 0 ? customFeeds : this.defaultFeeds),
      {
        name: 'Google News B2B Topic RSS',
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=en-US&gl=US&ceid=US:en`,
        category: 'topic_search',
      },
    ];

    const lowerKeyword = keyword.toLowerCase();
    const results = await Promise.allSettled(
      feedsToQuery.map((feed) => this.fetchFeed(feed.url, feed.name, 15))
    );

    const allSignals: SocialSignal[] = [];
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

    // Keep all topic search feed items and filter general feeds by keyword tokens
    const queryTokens = lowerKeyword.split(/\s+/).filter((t) => t.length > 2);
    const matched = allSignals.filter((signal) => {
      // If it originated from the targeted topic search feed, it already matches the query
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
    options: { limit?: number; customFeeds?: RssFeedSource[] } = {}
  ): Promise<{ signals: SocialSignal[]; status: import('../types').ConnectorStatus; error?: string }> {
    try {
      const signals = await this.searchFeeds(query, options.limit || 10, options.customFeeds);
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
