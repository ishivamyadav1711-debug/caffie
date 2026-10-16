/**
 * Concurrency & Timeout Configuration
 * Environment-configurable provider limits and timeouts.
 */

export interface ConcurrencyLimits {
  rapidapi: number;
  googlePlaces: number;
  osm: number;
  websiteFetch: number;
  crawler: number;
  pagespeed: number;
  webSearch: number;
}

export interface TimeoutConfig {
  rapidapiFastMs: number;
  googlePlacesFastMs: number;
  osmFastMs: number;
  websiteLightweightMs: number;
  crawlerMs: number;
  backgroundAuditMs: number;
}

export function getConcurrencyLimits(): ConcurrencyLimits {
  return {
    rapidapi: parseInt(process.env.RAPIDAPI_CONCURRENCY || '2', 10),
    googlePlaces: parseInt(process.env.GOOGLE_PLACES_CONCURRENCY || '3', 10),
    osm: parseInt(process.env.OSM_CONCURRENCY || '2', 10),
    websiteFetch: parseInt(process.env.WEBSITE_FETCH_CONCURRENCY || '5', 10),
    crawler: parseInt(process.env.CRAWLER_CONCURRENCY || '2', 10),
    pagespeed: parseInt(process.env.PAGESPEED_CONCURRENCY || '2', 10),
    webSearch: parseInt(process.env.WEB_SEARCH_CONCURRENCY || '2', 10),
  };
}

export function getTimeoutConfig(): TimeoutConfig {
  return {
    rapidapiFastMs: parseInt(process.env.RAPIDAPI_TIMEOUT_MS || '15000', 10),
    // Google Places needs 8s minimum from Vercel — individual page fetches average 500-1500ms
    // with retries. 2000ms caused SEARCH_DEADLINE_REACHED with 0 results.
    googlePlacesFastMs: parseInt(process.env.GOOGLE_PLACES_TIMEOUT_MS || '8000', 10),
    osmFastMs: parseInt(process.env.OSM_TIMEOUT_MS || '6000', 10),
    websiteLightweightMs: parseInt(process.env.WEBSITE_FETCH_TIMEOUT_MS || '3000', 10),
    crawlerMs: parseInt(process.env.CRAWLER_TIMEOUT_MS || '8000', 10),
    backgroundAuditMs: parseInt(process.env.AUDIT_TIMEOUT_MS || '30000', 10),
  };
}

/**
 * Lightweight in-memory Semaphore for rate limiting concurrent async operations.
 */
export class AsyncSemaphore {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(public readonly maxConcurrency: number) {}

  public async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    }
  }

  public getStats() {
    return {
      active: this.active,
      queued: this.queue.length,
      max: this.maxConcurrency,
    };
  }
}

// Global provider semaphores — initialized once with env-var limits.
// getConcurrencyLimits() reads process.env at call time, so the values
// are correct as long as this module loads after the runtime env is available.
export const semaphores = {
  rapidapi: new AsyncSemaphore(parseInt(process.env.RAPIDAPI_CONCURRENCY || '2', 10)),
  googlePlaces: new AsyncSemaphore(parseInt(process.env.GOOGLE_PLACES_CONCURRENCY || '3', 10)),
  osm: new AsyncSemaphore(parseInt(process.env.OSM_CONCURRENCY || '2', 10)),
  websiteFetch: new AsyncSemaphore(parseInt(process.env.WEBSITE_FETCH_CONCURRENCY || '5', 10)),
  crawler: new AsyncSemaphore(parseInt(process.env.CRAWLER_CONCURRENCY || '2', 10)),
  pagespeed: new AsyncSemaphore(parseInt(process.env.PAGESPEED_CONCURRENCY || '2', 10)),
  webSearch: new AsyncSemaphore(parseInt(process.env.WEB_SEARCH_CONCURRENCY || '2', 10)),
};

