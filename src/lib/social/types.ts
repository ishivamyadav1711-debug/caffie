/**
 * Unified Social Signal & Connector Types
 * Combines Phase 1 Normalized Social Signal Data Contracts and HeyPastel/Agent Reach Connector Contracts.
 * Zero-fabrication: records are only created from verified upstream payloads.
 */

export type SocialPlatform = 'reddit' | 'hackernews' | 'rss' | 'twitter' | 'linkedin' | 'web' | 'unknown';

export type AccessMethod = 'public_api' | 'public_archive' | 'public_rss' | 'browser_automation';

export type CollectionStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'EMPTY' | 'RATE_LIMITED' | 'BLOCKED';

export type ConnectorStatus = 'READY' | 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'AUTH_FAILED' | 'ERROR' | 'DEGRADED';

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

export interface SocialSignal {
  id: string;
  platform: SocialPlatform;
  originalId: string;
  url: string;
  author: string;
  authorProfileUrl?: string;
  title: string;
  text: string;
  publishedAt: string;
  collectedAt: string;
  language?: string;
  metrics?: {
    upvotes?: number;
    comments?: number;
    shares?: number;
  };
  rawMetadata?: Record<string, any>;
}

export interface ConnectorHealth {
  platform: SocialPlatform;
  displayName: string;
  status: ConnectorStatus;
  requiresAuth: boolean;
  isConfigured: boolean;
  message: string;
  capabilities: {
    canSearch: boolean;
    canStream: boolean;
    canReadPost: boolean;
    canDraftReply: boolean;
    canSendLive: boolean;
  };
  rateLimit?: {
    limit: number;
    remaining: number;
    resetsAt?: string;
  };
  lastCheckedAt: string;
  documentationUrl?: string;
}

export interface SocialIngestionQuery {
  keyword: string;
  platforms?: SocialPlatform[];
  limit?: number;
  minScore?: number;
  icpDomain?: string;
  competitors?: string[];
}

