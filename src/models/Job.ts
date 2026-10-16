import { JobStatus, ActorStatus, SearchStatusType } from './Enums';
import { SearchRequestPayload } from '@/types';
import { LeadEntity } from './Lead';

export interface RejectionBreakdown {
  OUTSIDE_LOCATION: number;
  UNKNOWN_LOCATION?: number;
  INVALID_CATEGORY: number;
  MISSING_NAME: number;
  DUPLICATE: number;
  NO_CONTACT: number;
  HAS_WEBSITE: number;
  NO_WEBSITE: number;
  WEBSITE_UNREACHABLE: number;
  WEBSITE_NEEDS_IMPROVEMENT?: number;
  AUDIT_FAILED: number;
  NOT_QUALIFIED: number;
  OTHER: number;
  WEBSITE_FILTER_MISMATCH?: number;
  CONTACT_FILTER_MISMATCH?: number;
  NOT_PROCESSED_BEFORE_DEADLINE?: number;
  TRANSIENT_FAILURE?: number;
  FILTER_MISMATCH?: number;
  INSUFFICIENT_FINANCIAL_EVIDENCE?: number;
  BELOW_FINANCIAL_THRESHOLD?: number;
}

export interface PipelineBreakdown {
  rawDiscoveredCount: number;
  normalizedCount: number;
  locationCheckedCount?: number;
  locationVerifiedCount: number;
  inCityBoundsCount: number;
  outsideLocationCount: number;
  unknownLocationCount: number;
  deduplicatedCount: number;
  queuedCount?: number;
  processedCount?: number;
  notProcessedCount?: number;
  notProcessedBeforeDeadlineCount?: number;
  phoneCount: number;
  emailCount: number;
  phoneOrEmailCount: number;
  websiteAvailableCount: number;
  websiteUnavailableCount: number;
  verifiedNoWebsiteCount?: number;
  websiteUnreachableCount: number;
  websiteNeedsImprovementCount?: number;
  finalQualifiedCount: number;
  deliveredCount?: number;
}

export interface RejectedCandidateItem {
  name: string;
  businessName?: string;
  category?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  websiteUrl?: string;
  websiteStatus?: string;
  rejectionReason:
    | 'NO_CONTACT'
    | 'HAS_WEBSITE'
    | 'NO_WEBSITE'
    | 'WEBSITE_UNREACHABLE'
    | 'WEBSITE_NEEDS_IMPROVEMENT'
    | 'OUTSIDE_LOCATION'
    | 'UNKNOWN_LOCATION'
    | 'DUPLICATE'
    | 'MISSING_NAME'
    | 'INVALID_CATEGORY'
    | 'AUDIT_FAILED'
    | 'NOT_QUALIFIED'
    | 'PROVIDER_ERROR'
    | 'INVALID_DATA'
    | 'OTHER'
    | 'WEBSITE_FILTER_MISMATCH'
    | 'CONTACT_FILTER_MISMATCH'
    | 'NOT_PROCESSED_BEFORE_DEADLINE'
    | 'TRANSIENT_FAILURE'
    | 'FILTER_MISMATCH'
    | 'INSUFFICIENT_FINANCIAL_EVIDENCE'
    | 'BELOW_FINANCIAL_THRESHOLD';
  reason?: string;
  rejectionDetails?: string;
}

export interface ProgressStep {
  actorId: string;
  stepName: string;
  message: string;
  count?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: string;
}

export interface Job {
  id: string;
  searchId: string;
  status: JobStatus;
  criteria: SearchRequestPayload;
  requestedLeads: number;
  highNetWorthFilter?: boolean;

  // Pipeline counters
  discovered: number;
  verified: number;
  deduplicated: number;
  enriched: number;
  audited: number;
  qualified: number;
  completed: number;
  failed: number;

  sourceStatus: SearchStatusType;
  sourceComplete: boolean;
  statusReason?: string;

  primaryProvider?: string;
  providerStats?: {
    primaryProvider?: string;
    rapidapi?: { rawCount: number; status: string; durationMs: number; reason?: string; errors?: string[] };
    googlePlaces?: { rawCount: number; status: string; durationMs: number; reason?: string; errors?: string[] };
    osm: { rawCount: number; status: string; durationMs: number; reason?: string; errors?: string[] };
    web?: { rawCount: number; status: string; durationMs: number; reason?: string; errors?: string[] };
    webSearch?: { rawCount: number; status: string; durationMs: number; reason?: string; errors?: string[] };
    businessProvider?: { rawCount: number; status: string; durationMs: number; reason?: string; errors?: string[] };
    directory?: { rawCount: number; status: string; durationMs: number; reason?: string; errors?: string[] };
  };

  providersReport?: {
    rapidapi?: { status: string; discovered: number; errors?: string[] };
    googlePlaces?: { status: string; discovered: number; errors?: string[] };
    osm: { status: string; discovered: number; errors?: string[] };
    webSearch: { status: string; discovered: number; errors?: string[] };
    businessProvider: { status: string; discovered: number; errors?: string[] };
  };

  mergedCount?: number;
  normalizedCount?: number;
  locationVerifiedCount?: number;
  deduplicatedCount?: number;
  phoneCount?: number;
  emailCount?: number;
  phoneOrEmailCount?: number;
  websiteDiscoveredCount?: number;
  websiteVerifiedCount?: number;
  noWebsiteCount?: number;
  enrichedCount?: number;
  finalCount?: number;

  rejectionReasons: RejectionBreakdown;
  pipelineBreakdown?: PipelineBreakdown;
  rejectedCandidates?: RejectedCandidateItem[];
  progressLog: ProgressStep[];

  leads: LeadEntity[];

  fastPathLatencyMs?: number;
  backgroundJobsQueued?: number;
  latencyMs?: number;
  rotationStats?: {
    totalEvaluated: number;
    deliveredCount: number;
    newEligibleCount: number;
    recentlyDeliveredCount: number;
  };

  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface ActorRun {
  id: string;
  jobId: string;
  actorId: string;
  status: ActorStatus;
  startedAt: string;
  completedAt?: string;
  attempts: number;
  inputReference?: string;
  outputReference?: string;
  metrics: Record<string, any>;
  errors: string[];
  warnings: string[];
}
