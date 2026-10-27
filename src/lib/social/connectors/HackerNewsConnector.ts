/**
 * Hacker News Algolia Search Connector
 * Ingests tech discussions, Ask HN questions, and vendor recommendation requests.
 */

import { SocialSignal, ConnectorHealth, ConnectorStatus } from '../types';

export interface HackerNewsSearchOptions {
  limit?: number;
  tags?: string;
  sortByDate?: boolean;
}

export class HackerNewsConnector {
  private static readonly API_BASE = 'https://hn.algolia.com/api/v1';

  /**
   * Search Hacker News via Algolia public search API
   */
  public static async search(
    query: string,
    options: HackerNewsSearchOptions = {}
  ): Promise<{ signals: SocialSignal[]; status: ConnectorStatus; error?: string }> {
    const limit = Math.min(Math.max(options.limit || 10, 1), 30);
    const tags = options.tags || '(story,comment)';
    const endpoint = options.sortByDate ? 'search_by_date' : 'search';
    const url = `${this.API_BASE}/${endpoint}?query=${encodeURIComponent(query)}&tags=${encodeURIComponent(tags)}&hitsPerPage=${limit}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'LeadPilot-B2B-Intelligence/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        return {
          signals: [],
          status: response.status === 429 ? 'RATE_LIMITED' : 'DEGRADED',
          error: `Hacker News Algolia returned HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const hits = Array.isArray(data.hits) ? data.hits : [];
      const signals: SocialSignal[] = [];

      for (const hit of hits) {
        const title = hit.title || hit.story_title || (hit.comment_text ? 'HN Comment Discussion' : 'Hacker News Item');
        const rawContent = hit.story_text || hit.comment_text || hit.title || '';
        
        // Strip basic HTML tags from Algolia comment text
        const cleanContent = rawContent
          .replace(/<[^>]+>/g, ' ')
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/\s+/g, ' ')
          .trim();

        const postUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
        const author = hit.author || 'hn_user';
        const publishedAt = hit.created_at || new Date().toISOString();

        signals.push({
          id: `hn_${hit.objectID}`,
          platform: 'hackernews',
          originalId: String(hit.objectID),
          url: postUrl,
          author,
          authorProfileUrl: `https://news.ycombinator.com/user?id=${encodeURIComponent(author)}`,
          title: title.slice(0, 200),
          text: cleanContent || title,
          publishedAt,
          collectedAt: new Date().toISOString(),
          metrics: {
            upvotes: hit.points || 0,
            comments: hit.num_comments || 0,
          },
          rawMetadata: {
            objectID: hit.objectID,
            storyId: hit.story_id,
            tags: hit._tags,
          },
        });
      }

      return {
        signals,
        status: 'READY',
      };
    } catch (err: any) {
      const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout');
      return {
        signals: [],
        status: isTimeout ? 'DEGRADED' : 'ERROR',
        error: isTimeout ? 'Hacker News search request timed out' : `Hacker News search failed: ${err.message}`,
      };
    }
  }

  /**
   * Health check for Hacker News connector
   */
  public static async checkHealth(): Promise<ConnectorHealth> {
    const now = new Date().toISOString();
    try {
      const res = await fetch(`${this.API_BASE}/search?query=test&hitsPerPage=1`, {
        headers: { 'User-Agent': 'LeadPilot-B2B/1.0' },
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        return {
          platform: 'hackernews',
          displayName: 'Hacker News (Algolia API)',
          status: 'READY',
          requiresAuth: false,
          isConfigured: true,
          message: 'Hacker News search API is active and responsive.',
          capabilities: {
            canSearch: true,
            canStream: false,
            canReadPost: true,
            canDraftReply: true,
            canSendLive: false,
          },
          lastCheckedAt: now,
        };
      }

      return {
        platform: 'hackernews',
        displayName: 'Hacker News (Algolia API)',
        status: res.status === 429 ? 'RATE_LIMITED' : 'DEGRADED',
        requiresAuth: false,
        isConfigured: true,
        message: `Hacker News API returned status ${res.status}.`,
        capabilities: {
          canSearch: false,
          canStream: false,
          canReadPost: false,
          canDraftReply: true,
          canSendLive: false,
        },
        lastCheckedAt: now,
      };
    } catch (err: any) {
      return {
        platform: 'hackernews',
        displayName: 'Hacker News (Algolia API)',
        status: 'ERROR',
        requiresAuth: false,
        isConfigured: true,
        message: `Hacker News API unreachable: ${err.message}`,
        capabilities: {
          canSearch: false,
          canStream: false,
          canReadPost: false,
          canDraftReply: true,
          canSendLive: false,
        },
        lastCheckedAt: now,
      };
    }
  }
}
