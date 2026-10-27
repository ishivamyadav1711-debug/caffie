/**
 * Reddit Public Search Connector & Diagnostics
 * Accesses public B2B and SaaS Reddit signals with rate-limit and auth degradation handling.
 */

import { SocialSignal, ConnectorHealth, ConnectorStatus } from '../types';

export interface RedditSearchOptions {
  limit?: number;
  subreddit?: string;
  sortBy?: 'new' | 'relevance';
}

export class RedditConnector {
  /**
   * Search Reddit using public search endpoints with graceful rate-limit handling
   */
  public static async search(
    query: string,
    options: RedditSearchOptions = {}
  ): Promise<{ signals: SocialSignal[]; status: ConnectorStatus; error?: string }> {
    const limit = Math.min(Math.max(options.limit || 8, 1), 25);
    const pullpushUrl = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(query)}&size=${limit}`;

    try {
      const response = await fetch(pullpushUrl, {
        headers: {
          'User-Agent': 'LeadPilot-B2B/1.0 (Mozilla/5.0)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return {
            signals: [],
            status: 'RATE_LIMITED',
            error: 'Reddit PullPush API returned HTTP 429 (Rate Limited).',
          };
        }
        if (response.status === 403 || response.status === 401) {
          return {
            signals: [],
            status: 'AUTH_FAILED',
            error: `Reddit API access requires authentication (HTTP ${response.status}). Set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET to enable authenticated queries.`,
          };
        }
        return {
          signals: [],
          status: 'DEGRADED',
          error: `Reddit search endpoint returned HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const items = Array.isArray(data.data) ? data.data : [];
      const signals: SocialSignal[] = [];

      for (const item of items) {
        const title = item.title || 'Reddit Discussion';
        const text = item.selftext || title;
        const author = item.author || 'reddit_user';
        const url = item.permalink
          ? `https://www.reddit.com${item.permalink}`
          : item.url || `https://reddit.com/r/${item.subreddit || 'all'}`;
        const publishedAt = item.created_utc
          ? new Date(item.created_utc * 1000).toISOString()
          : new Date().toISOString();

        signals.push({
          id: `reddit_${item.id || Buffer.from(url).toString('base64url').slice(0, 20)}`,
          platform: 'reddit',
          originalId: item.id || '',
          url,
          author,
          authorProfileUrl: `https://www.reddit.com/user/${encodeURIComponent(author)}`,
          title: title.slice(0, 200),
          text,
          publishedAt,
          collectedAt: new Date().toISOString(),
          metrics: {
            upvotes: item.score || 0,
            comments: item.num_comments || 0,
          },
          rawMetadata: {
            subreddit: item.subreddit,
            id: item.id,
          },
        });
      }

      return {
        signals,
        status: signals.length > 0 ? 'READY' : 'READY',
      };
    } catch (err: any) {
      const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout');
      return {
        signals: [],
        status: isTimeout ? 'DEGRADED' : 'ERROR',
        error: isTimeout ? 'Reddit search request timed out' : `Reddit search error: ${err.message}`,
      };
    }
  }

  /**
   * Health check for Reddit connector
   */
  public static async checkHealth(): Promise<ConnectorHealth> {
    const now = new Date().toISOString();
    try {
      const res = await fetch('https://api.pullpush.io/reddit/search/submission/?q=test&size=1', {
        headers: { 'User-Agent': 'LeadPilot-B2B/1.0' },
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        return {
          platform: 'reddit',
          displayName: 'Reddit (PullPush Public API)',
          status: 'READY',
          requiresAuth: false,
          isConfigured: true,
          message: 'Reddit search API is active and responsive.',
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

      const isRateLimited = res.status === 429;
      return {
        platform: 'reddit',
        displayName: 'Reddit (PullPush Public API)',
        status: isRateLimited ? 'RATE_LIMITED' : 'DEGRADED',
        requiresAuth: false,
        isConfigured: true,
        message: isRateLimited ? 'Reddit API rate-limited (HTTP 429).' : `Reddit API returned HTTP ${res.status}.`,
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
        platform: 'reddit',
        displayName: 'Reddit (PullPush Public API)',
        status: 'DEGRADED',
        requiresAuth: false,
        isConfigured: true,
        message: `Reddit endpoint notice: ${err.message}.`,
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
