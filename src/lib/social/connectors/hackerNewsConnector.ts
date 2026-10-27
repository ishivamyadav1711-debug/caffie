import {
  SocialConnector,
  SocialConnectorResult,
  ConnectorFetchOptions,
  SocialSignalRecord,
  CollectionStatus,
} from '../types';
import { createContentHash, normalizeUtcDate, sanitizeString } from '../hashUtils';

export class HackerNewsConnector implements SocialConnector {
  readonly platform = 'hackernews' as const;
  readonly name = 'Hacker News Algolia Search API Connector';

  private userAgent = 'LeadPilot-Social/1.0';

  isAvailable(): boolean {
    return true;
  }

  async collect(options: ConnectorFetchOptions = {}): Promise<SocialConnectorResult> {
    const startTime = Date.now();
    const query = (options.query || 'seeking freelancer OR need website').trim();
    const limit = Math.min(Math.max(options.limit || 10, 1), 50);
    const page = Math.max(Math.floor((options.offset || 0) / limit), 0);
    const timeoutMs = options.timeoutMs || 8000;

    let url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${limit}&page=${page}`;

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
    let errorMessage: string | undefined;

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

