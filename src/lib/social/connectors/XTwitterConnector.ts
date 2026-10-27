/**
 * X / Twitter Official API v2 Connector & Diagnostics
 * Implements compliant search, rate limit tracking, and strict read/write separation
 * adhering to the safety policy.
 */

import { ConnectorHealth, SocialSignal } from '../types';

export interface XTweetPublicMetrics {
  retweet_count: number;
  reply_count: number;
  like_count: number;
  quote_count: number;
  impression_count?: number;
}

export interface XSearchResponse {
  data?: Array<{
    id: string;
    text: string;
    created_at?: string;
    author_id?: string;
    public_metrics?: XTweetPublicMetrics;
    lang?: string;
  }>;
  includes?: {
    users?: Array<{
      id: string;
      name: string;
      username: string;
      description?: string;
      verified?: boolean;
    }>;
  };
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    result_count: number;
    next_token?: string;
  };
  errors?: Array<{
    message: string;
    title: string;
    detail?: string;
    type?: string;
  }>;
}

export class XTwitterConnector {
  private static readonly API_BASE = 'https://api.twitter.com/2';

  /**
   * Retrieves configured Bearer token or returns null
   */
  public static getBearerToken(): string | null {
    const token =
      process.env.TWITTER_BEARER_TOKEN ||
      process.env.X_BEARER_TOKEN ||
      process.env.TWITTER_API_KEY ||
      process.env.X_API_KEY;

    if (!token || token.trim().length === 0 || token.includes('your_')) {
      return null;
    }
    return token.trim();
  }

  /**
   * Diagnoses X API connection, credentials, and endpoint tier status
   */
  public static async checkHealth(): Promise<ConnectorHealth> {
    const token = this.getBearerToken();
    const now = new Date().toISOString();

    if (!token) {
      return {
        platform: 'twitter',
        displayName: 'X / Twitter (Official API v2)',
        status: 'NOT_CONFIGURED',
        requiresAuth: true,
        isConfigured: false,
        message: 'X API credentials not configured. Set TWITTER_BEARER_TOKEN in .env.local to enable live X search.',
        capabilities: {
          canSearch: false,
          canStream: false,
          canReadPost: false,
          canDraftReply: true,
          canSendLive: false,
        },
        documentationUrl: 'https://developer.x.com/en/docs/twitter-api/tweets/search/introduction',
        lastCheckedAt: now,
      };
    }

    try {
      // Diagnostic call: user me or search ping with max_results=10
      const testUrl = `${this.API_BASE}/tweets/search/recent?query=test&max_results=10`;
      const res = await fetch(testUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'LeadPilot-B2B/1.0',
        },
        signal: AbortSignal.timeout(5000),
      });

      const limit = Number(res.headers.get('x-rate-limit-limit') || 450);
      const remaining = Number(res.headers.get('x-rate-limit-remaining') || 0);
      const resetEpoch = Number(res.headers.get('x-rate-limit-reset') || 0);
      const resetsAt = resetEpoch ? new Date(resetEpoch * 1000).toISOString() : undefined;

      if (res.status === 401) {
        return {
          platform: 'twitter',
          displayName: 'X / Twitter (Official API v2)',
          status: 'AUTH_FAILED',
          requiresAuth: true,
          isConfigured: true,
          message: 'Invalid X API Bearer token. Check credentials in developer portal.',
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

      if (res.status === 429) {
        return {
          platform: 'twitter',
          displayName: 'X / Twitter (Official API v2)',
          status: 'RATE_LIMITED',
          requiresAuth: true,
          isConfigured: true,
          message: 'X API search rate limit reached for current 15-minute window.',
          capabilities: {
            canSearch: false,
            canStream: false,
            canReadPost: true,
            canDraftReply: true,
            canSendLive: false,
          },
          rateLimit: { limit, remaining: 0, resetsAt },
          lastCheckedAt: now,
        };
      }

      if (res.status === 403) {
        return {
          platform: 'twitter',
          displayName: 'X / Twitter (Official API v2)',
          status: 'DEGRADED',
          requiresAuth: true,
          isConfigured: true,
          message: 'X API endpoint access restricted by current plan tier (Free vs Basic/Pro).',
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

      return {
        platform: 'twitter',
        displayName: 'X / Twitter (Official API v2)',
        status: 'READY',
        requiresAuth: true,
        isConfigured: true,
        message: 'X API v2 search endpoint connected and ready.',
        capabilities: {
          canSearch: true,
          canStream: false,
          canReadPost: true,
          canDraftReply: true,
          canSendLive: false, // Strict safety policy: live automated posting disabled
        },
        rateLimit: { limit, remaining, resetsAt },
        lastCheckedAt: now,
      };
    } catch (err: any) {
      return {
        platform: 'twitter',
        displayName: 'X / Twitter (Official API v2)',
        status: 'ERROR',
        requiresAuth: true,
        isConfigured: true,
        message: `X API connection failed: ${err.message}`,
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

  /**
   * Search recent tweets matching commercial intent queries
   */
  public static async searchTweets(
    keyword: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<{
    signals: SocialSignal[];
    nextToken?: string;
    rateLimitRemaining?: number;
    error?: string;
  }> {
    const token = this.getBearerToken();
    if (!token) {
      return {
        signals: [],
        error: 'X API not configured. Set TWITTER_BEARER_TOKEN in .env.local.',
      };
    }

    const limit = Math.min(100, Math.max(10, options?.limit || 10));
    // Query builder: filter out retweets, english preferred
    const formattedQuery = `${keyword} -is:retweet lang:en`;
    const searchUrl = new URL(`${this.API_BASE}/tweets/search/recent`);
    searchUrl.searchParams.set('query', formattedQuery);
    searchUrl.searchParams.set('max_results', String(limit));
    searchUrl.searchParams.set('tweet.fields', 'created_at,author_id,public_metrics,lang');
    searchUrl.searchParams.set('expansions', 'author_id');
    searchUrl.searchParams.set('user.fields', 'username,name,description,verified');

    if (options?.nextToken) {
      searchUrl.searchParams.set('next_token', options.nextToken);
    }

    try {
      const res = await fetch(searchUrl.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'LeadPilot-B2B/1.0',
        },
        signal: AbortSignal.timeout(8000),
      });

      const remaining = Number(res.headers.get('x-rate-limit-remaining') || 0);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg =
          errorData.detail || errorData.title || `HTTP ${res.status} from X API`;
        console.warn(`[X Connector] Search error: ${errorMsg}`);
        return { signals: [], rateLimitRemaining: remaining, error: errorMsg };
      }

      const body: XSearchResponse = await res.json();
      const usersMap = new Map<string, { username: string; name: string }>();
      for (const u of body.includes?.users || []) {
        usersMap.set(u.id, { username: u.username, name: u.name });
      }

      const signals: SocialSignal[] = (body.data || []).map((t) => {
        const user = t.author_id ? usersMap.get(t.author_id) : undefined;
        const authorHandle = user?.username ? `@${user.username}` : (t.author_id || 'x_user');
        const url = user?.username
          ? `https://x.com/${user.username}/status/${t.id}`
          : `https://x.com/i/web/status/${t.id}`;

        return {
          id: `x_${t.id}`,
          platform: 'twitter',
          originalId: t.id,
          url,
          author: authorHandle,
          authorProfileUrl: user?.username ? `https://x.com/${user.username}` : undefined,
          title: t.text.slice(0, 100),
          text: t.text,
          publishedAt: t.created_at || new Date().toISOString(),
          collectedAt: new Date().toISOString(),
          language: t.lang || 'en',
          metrics: {
            upvotes: t.public_metrics?.like_count || 0,
            comments: t.public_metrics?.reply_count || 0,
            shares: t.public_metrics?.retweet_count || 0,
          },
          rawMetadata: {
            metrics: t.public_metrics,
            verified: (user as any)?.verified,
          },
        };
      });

      return {
        signals,
        nextToken: body.meta?.next_token,
        rateLimitRemaining: remaining,
      };
    } catch (err: any) {
      console.warn(`[X Connector] Search request failed: ${err.message}`);
      return { signals: [], error: err.message };
    }
  }

  /**
   * Safety Guard: Block automated live posting without human review
   */
  public static async publishReply(
    _tweetId: string,
    _replyText: string
  ): Promise<{ success: boolean; error: string }> {
    return {
      success: false,
      error: 'Direct X publishing is blocked by system safety policy. Use the human review and approval queue.',
    };
  }
}
