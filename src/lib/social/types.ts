/**
 * Social Signal & Connector Types
 * Inspired by Agent Reach & SignalPipe architectures
 */

export type SocialPlatform = 'twitter' | 'reddit' | 'hackernews' | 'rss' | 'web';

export type ConnectorStatus = 'READY' | 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'AUTH_FAILED' | 'ERROR' | 'DEGRADED';

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
