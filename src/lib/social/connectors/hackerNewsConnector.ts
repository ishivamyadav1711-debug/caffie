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

export interface HackerNewsSearchOptions {
  limit?: number;
  tags?: string;
  sortByDate?: boolean;
}

export class HackerNewsConnector implements SocialConnector {
  readonly platform = 'hackernews' as const;
  readonly name = 'Hacker News Algolia Search API Connector';

  private static readonly API_BASE = 'https://hn.algolia.com/api/v1';
  private userAgent = 'LeadPilot-Social/1.0';

  isAvailable(): boolean {
    return true;
  }

  /**
   * Phase 1: High-volume ingestion contract returning SocialSignalRecord[]
   */
  async collect(options: ConnectorFetchOptions = {}): Promise<SocialConnectorResult> {
    const startTime = Date.now();
    const query = (options.query || 'seeking freelancer OR need website').trim();
    const limit = Math.min(Math.max(options.limit || 10, 1), 50);
    const page = Math.max(Math.floor((options.offset || 0) / limit), 0);
    const timeoutMs = options.timeoutMs || 8000;

    let url = `${HackerNewsConnector.API_BASE}/search?query=${encodeURIComponent(query)}&hitsPerPage=${limit}&page=${page}`;

    // Configurable default 30-day cutoff for fresh lead discovery; explicit sinceTimestamp or allowHistorical overrides it
    const DEFAULT_LOOKBACK_SECONDS = 30 * 24 * 60 * 60; // 30 days
    let cutoffSeconds: number | null = null;

    if (typeof options.sinceTimestamp === 'number') {
      cutoffSeconds = options.sinceTimestamp;
    } else if (!options.allowHistorical) {
      cutoffSeconds = Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK_SECONDS;
    }

    if (cutoffSeconds !== null && cutoffSeconds > 0) {
      url += `&numericFilters=created_at_i>=${cutoffSeconds}`;
    }

    let records: SocialSignalRecord[] = [];
    let status: CollectionStatus = 'SUCCESS';

    try {
      const res = await this.fetchWithRetry(url, timeoutMs, 2);

      if (!res.ok) {
        return {
          records: [],
          diagnostic: {
            platform: this.platform,
            accessMethod: 'public_api',
            status: 'FAILED',
            recordsFound: 0,
            durationMs: Date.now() - startTime,
            error: `Algolia HN API returned HTTP ${res.status}: ${res.statusText}`,
          },
        };
      }

      const data = await res.json();
      const hits = data?.hits;

      if (!Array.isArray(hits)) {
        return {
          records: [],
          diagnostic: {
            platform: this.platform,
            accessMethod: 'public_api',
            status: 'FAILED',
            recordsFound: 0,
            durationMs: Date.now() - startTime,
            error: 'Malformed Algolia HN JSON: missing hits array',
          },
        };
      }

      for (const hit of hits) {
        if (!hit || !hit.objectID) continue;
        
        // Skip dead or deleted tags from Algolia
        if (hit._tags && (hit._tags.includes('dead') || hit._tags.includes('deleted'))) {
          continue;
        }

        const rawTitle = (hit.title || hit.story_title || '').trim();
        const normalizedTitleLower = rawTitle.toLowerCase();

        // Reject items with dead/deleted moderation markers or empty titles (case-insensitively)
        if (
          !rawTitle ||
          normalizedTitleLower.startsWith('[dead]') ||
          normalizedTitleLower.startsWith('[deleted]')
        ) {
          continue;
        }

        const recordId = sanitizeString(hit.objectID);
        const title = sanitizeString(rawTitle, 500);
        const contentText = sanitizeString(hit.story_text || hit.comment_text || title, 5000);
        
        // Preserve external destination if available, otherwise canonical YCombinator item link
        const sourceUrl = hit.url && hit.url.startsWith('http')
          ? sanitizeString(hit.url)
          : `https://news.ycombinator.com/item?id=${recordId}`;

        records.push({
          source_platform: 'hackernews',
          source_record_id: recordId,
          source_url: sourceUrl,
          author_handle: hit.author ? sanitizeString(hit.author) : null,
          publication_timestamp: normalizeUtcDate(hit.created_at_i || hit.created_at),
          retrieved_at: new Date().toISOString(),
          title,
          content_text: contentText,
          content_hash: createContentHash('hackernews', recordId, contentText),
          access_method: 'public_api',
          collection_status: 'SUCCESS',
          metadata: {
            points: typeof hit.points === 'number' ? hit.points : 0,
            num_comments: typeof hit.num_comments === 'number' ? hit.num_comments : 0,
            hnItemUrl: `https://news.ycombinator.com/item?id=${recordId}`,
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
    } catch (err: any) {
      return {
        records: [],
        diagnostic: {
          platform: this.platform,
          accessMethod: 'public_api',
          status: 'FAILED',
          recordsFound: 0,
          durationMs: Date.now() - startTime,
          error: `Hacker News fetch failed: ${err.message}`,
        },
      };
    }
  }

  /**
   * HeyPastel Multi-Source Intent Search Engine Contract
   * Ingests tech discussions, Ask HN questions, and vendor recommendation requests.
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

        if (res.status >= 500 && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 300));
          continue;
        }

        return res;
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 200));
        }
      }
    }

    throw lastError || new Error(`HN Algolia fetch failed after ${maxRetries} retries`);
  }
}

export const hackerNewsConnector = new HackerNewsConnector();
