import {
  SocialConnector,
  SocialConnectorResult,
  ConnectorFetchOptions,
  SocialSignalRecord,
  CollectionStatus,
  SocialSignal,
  ConnectorHealth,
  ConnectorStatus,
} from '../types';
import { createContentHash, normalizeUtcDate, sanitizeString } from '../hashUtils';

export interface RedditSearchOptions {
  limit?: number;
  subreddit?: string;
  sortBy?: 'new' | 'relevance';
}

export class RedditConnector implements SocialConnector {
  readonly platform = 'reddit' as const;
  readonly name = 'Reddit Public JSON & PullPush Connector';

  private userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 LeadPilot-Social/1.0';

  isAvailable(): boolean {
    return true;
  }

  /**
   * Phase 1: High-volume ingestion contract returning SocialSignalRecord[]
   */
  async collect(options: ConnectorFetchOptions = {}): Promise<SocialConnectorResult> {
    const startTime = Date.now();
    const query = (options.query || 'looking for web development OR need CRM').trim();
    const limit = Math.min(Math.max(options.limit || 10, 1), 50);
    const timeoutMs = options.timeoutMs || 8000;

    let records: SocialSignalRecord[] = [];
    let status: CollectionStatus = 'SUCCESS';
    let errorMessage: string | undefined;
    let accessMethod: 'public_api' | 'public_archive' = 'public_api';

    // 1. Attempt Primary: Reddit Public Search JSON
    try {
      const primaryResult = await this.fetchWithRetry(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${limit}`,
        timeoutMs,
        2
      );

      if (primaryResult.status === 200) {
        const json = await primaryResult.json();
        const children = json?.data?.children;

        if (Array.isArray(children)) {
          for (const item of children) {
            const data = item?.data;
            if (!data || !data.id || !data.title) continue;

            const recordId = sanitizeString(data.id);
            const title = sanitizeString(data.title, 500);
            const contentText = sanitizeString(data.selftext || title, 5000);
            const permalink = data.permalink
              ? `https://www.reddit.com${data.permalink}`
              : (data.url || `https://reddit.com/comments/${recordId}`);

            records.push({
              source_platform: 'reddit',
              source_record_id: recordId,
              source_url: permalink,
              author_handle: data.author ? `u/${data.author}` : null,
              publication_timestamp: normalizeUtcDate(data.created_utc),
              retrieved_at: new Date().toISOString(),
              title,
              content_text: contentText,
              content_hash: createContentHash('reddit', recordId, contentText),
              access_method: 'public_api',
              collection_status: 'SUCCESS',
              metadata: {
                subreddit: data.subreddit_name_prefixed || (data.subreddit ? `r/${data.subreddit}` : null),
                score: typeof data.score === 'number' ? data.score : 0,
                num_comments: typeof data.num_comments === 'number' ? data.num_comments : 0,
              },
            });
          }

          if (records.length === 0) {
            status = 'EMPTY';
          }
          return {
            records,
            diagnostic: {
              platform: this.platform,
              accessMethod: 'public_api',
              status,
              recordsFound: records.length,
              durationMs: Date.now() - startTime,
            },
          };
        } else {
          errorMessage = 'Malformed Reddit JSON: missing data.children array';
        }
      } else if (primaryResult.status === 429) {
        status = 'RATE_LIMITED';
        errorMessage = 'Reddit 429 Too Many Requests (Rate limit hit)';
      } else if (primaryResult.status === 403) {
        status = 'BLOCKED';
        errorMessage = 'Reddit 403 Forbidden (Cloudflare block)';
      } else {
        status = 'FAILED';
        errorMessage = `Reddit returned HTTP ${primaryResult.status}`;
      }
    } catch (err: any) {
      status = 'FAILED';
      errorMessage = `Primary Reddit fetch failed: ${err.message}`;
    }

    // 2. Secondary Fallback: PullPush Reddit Public Archive API
    accessMethod = 'public_archive';
    try {
      const fallbackUrl = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(query)}&size=${limit}`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (fallbackRes.ok) {
        const fallbackJson = await fallbackRes.json();
        const items = fallbackJson?.data;

        if (Array.isArray(items)) {
          for (const d of items) {
            if (!d || !d.id || !d.title) continue;

            const recordId = sanitizeString(d.id);
            const title = sanitizeString(d.title, 500);
            const contentText = sanitizeString(d.selftext || title, 5000);
            const permalink = d.permalink
              ? (d.permalink.startsWith('http') ? d.permalink : `https://www.reddit.com${d.permalink}`)
              : (d.url || `https://reddit.com/comments/${recordId}`);

            records.push({
              source_platform: 'reddit',
              source_record_id: recordId,
              source_url: permalink,
              author_handle: d.author ? `u/${d.author}` : null,
              publication_timestamp: normalizeUtcDate(d.created_utc),
              retrieved_at: new Date().toISOString(),
              title,
              content_text: contentText,
              content_hash: createContentHash('reddit', recordId, contentText),
              access_method: 'public_archive',
              collection_status: 'SUCCESS',
              metadata: {
                subreddit: d.subreddit ? `r/${d.subreddit}` : null,
                score: typeof d.score === 'number' ? d.score : 0,
                num_comments: typeof d.num_comments === 'number' ? d.num_comments : 0,
              },
            });
          }

          status = records.length > 0 ? 'SUCCESS' : 'EMPTY';
          return {
            records,
            diagnostic: {
              platform: this.platform,
              accessMethod: 'public_archive',
              status,
              recordsFound: records.length,
              durationMs: Date.now() - startTime,
            },
          };
        }
      } else {
        errorMessage = `PullPush archive returned HTTP ${fallbackRes.status}. (Original error: ${errorMessage})`;
      }
    } catch (fbErr: any) {
      errorMessage = `Both Reddit primary and PullPush archive failed. PullPush error: ${fbErr.message}. Original error: ${errorMessage}`;
    }

    // Both failed: Return explicit failure without any synthetic records
    return {
      records: [],
      diagnostic: {
        platform: this.platform,
        accessMethod,
        status: 'FAILED',
        recordsFound: 0,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      },
    };
  }

  /**
   * HeyPastel Multi-Source Intent Search Engine Contract
   * Searches Reddit using public search endpoints with graceful rate-limit handling.
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
        status: 'READY',
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

  private async fetchWithRetry(url: string, timeoutMs: number, maxRetries = 2): Promise<Response> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });

        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const backoffMs = (attempt + 1) * 400;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        return res;
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 300));
        }
      }
    }

    throw lastError || new Error(`Fetch failed after ${maxRetries} retries`);
  }
}

export const redditConnector = new RedditConnector();
