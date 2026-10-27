/**
 * Phase 1: Normalized Social Signal Data Contract
 * Strict schema definitions for genuine social media & discussion signals.
 * Zero-fabrication: records are only created from verified upstream payloads.
 */

export type SocialPlatform = 'reddit' | 'hackernews' | 'rss' | 'twitter' | 'linkedin' | 'unknown';

export type AccessMethod = 'public_api' | 'public_archive' | 'public_rss' | 'browser_automation';

export type CollectionStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'EMPTY' | 'RATE_LIMITED' | 'BLOCKED';

/**
 * Normalized record contract required by Phase 1 specification
 */
export interface SocialSignalRecord {
  source_platform: SocialPlatform;
  source_record_id: string;
  source_url: string;
  author_handle: string | null;
  publication_timestamp: string | null; // ISO 8601 UTC
  retrieved_at: string;                 // ISO 8601 UTC
  title: string;
  content_text: string;
  content_hash: string;                // Deterministic SHA-256
  access_method: AccessMethod;
  collection_status: CollectionStatus;
  metadata?: Record<string, any>;
}

export interface ConnectorFetchOptions {
  query?: string;
  limit?: number;
  offset?: number;
  sinceTimestamp?: number; // Unix timestamp in seconds (explicit cutoff filter)
  allowHistorical?: boolean; // If true, omits the default 30-day freshness cutoff
  timeoutMs?: number;
  feedUrl?: string;
}

export interface ConnectorDiagnostic {
  platform: SocialPlatform;
  accessMethod: AccessMethod;
  status: CollectionStatus;
  recordsFound: number;
  durationMs: number;
  error?: string;
  rateLimitReset?: number;
}

export interface SocialConnectorResult {
  records: SocialSignalRecord[];
  diagnostic: ConnectorDiagnostic;
}

export interface SocialConnector {
  readonly platform: SocialPlatform;
  readonly name: string;
  isAvailable(): boolean;
  collect(options: ConnectorFetchOptions): Promise<SocialConnectorResult>;
}

export interface FeedRegistryEntry {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  pollingIntervalMinutes: number;
  scope: string; // e.g. "business", "startups", "freelance"
}

