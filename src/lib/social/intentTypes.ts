/**
 * Phase 2 & 2.1: Intent Classification Taxonomy & Three-Judge Evaluation Types
 * Evidence-based classification of commercial buying intent from social signals.
 */

export const INTENT_CATEGORIES = [
  'EXPLICIT_PURCHASE_INTENT',
  'ACTIVE_VENDOR_SEARCH',
  'WEBSITE_REDESIGN_NEED',
  'MARKETING_SERVICE_NEED',
  'TECHNICAL_PROBLEM',
  'GENERAL_DISCUSSION',
  'SELF_PROMOTION',
  'IRRELEVANT',
] as const;

export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

export type ReviewStatus =
  | 'CONFIRMED'
  | 'TENTATIVE'
  | 'NEEDS_REVIEW'
  | 'REJECTED'
  | 'STALE';

export type EvaluationStrategy =
  | 'three_judge_llm'
  | 'three_judge_deterministic'
  | 'deterministic_fallback';

export type ConfidenceScoreType = 'heuristic';

export interface ClassifiableSignalInput {
  id?: string;
  title: string;
  contentText: string;
  sourcePlatform?: string;
  publicationTimestamp?: string | Date | null;
  metadata?: Record<string, any> | string | null;
  tags?: string[];
}

export interface ClassificationPolicyOptions {
  maxAgeDays?: number; // Default: 30 days
  referenceDate?: Date; // Optional reference clock for deterministic testing
}

export interface SkepticEvaluation {
  isSelfPromo: boolean;
  isJobSeeker: boolean;
  isSalesPartnerRecruitment?: boolean;
  isDeadOrDeleted?: boolean;
  isModerationMeta?: boolean;
  isStale?: boolean;
  ageDays?: number | null;
  isSpamOrIrrelevant: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  flags: string[];
  challengeReason: string;
}

export interface AnalystEvaluation {
  candidateCategory: IntentCategory;
  explicitBuyingSignal: boolean;
  hasBudget: boolean;
  urgency: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  evidenceSnippets: string[];
  analysisReason: string;
}

export interface OptimistEvaluation {
  plausibleOpportunity: boolean;
  opportunityScore: number; // 0.0 to 1.0 (heuristic)
  potentialServices: string[];
  upsideRationale: string;
}

export interface IntentClassificationResult {
  signalId?: string;
  classifierVersion: string;
  primaryCategory: IntentCategory;
  confidenceScore: number; // 0.00 to 1.00 (heuristic score, not calibrated probability)
  scoreType: ConfidenceScoreType;
  reviewStatus: ReviewStatus;
  evidenceSnippets: string[]; // Verbatim exact substrings of source content
  explanation: string;
  reasonCodes: string[];

  skepticEvaluation?: SkepticEvaluation;
  analystEvaluation?: AnalystEvaluation;
  optimistEvaluation?: OptimistEvaluation;

  evaluationStrategy: EvaluationStrategy;
  providerModel?: string;
  processingDurationMs?: number;
  classifiedAt: string; // ISO 8601 UTC
}

export interface BatchClassificationReport {
  timestamp: string;
  totalEvaluated: number;
  classified: number;
  skippedAlreadyClassified: number;
  errors: number;
  categoryBreakdown: Record<IntentCategory, number>;
  reviewStatusBreakdown: Record<ReviewStatus, number>;
  diagnostics: Array<{
    signalId: string;
    status: 'SUCCESS' | 'ERROR' | 'SKIPPED';
    category?: IntentCategory;
    reviewStatus?: ReviewStatus;
    error?: string;
  }>;
}
