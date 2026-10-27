/**
 * Phase 3 Identity-Resolution Safety Contract (Defined & Tested in Phase 2.1)
 *
 * NOTE: Phase 3 business identity resolution is NOT implemented in this phase.
 * This module defines the strict entity boundaries, provenance invariants, and
 * validation guards that Phase 3 must satisfy before linking any social signal
 * to a real-world business record.
 */

import { validateVerbatimSnippets } from './evidenceValidator';

// ---------------------------------------------------------------------------
// 1. Separate Entity Definitions (Never conflate author, post, mention, or business)
// ---------------------------------------------------------------------------

/** Social platform user/author handle — never treated as a verified company identity */
export interface SocialAuthorEntity {
  readonly entityType: 'SOCIAL_AUTHOR';
  platform: string;
  authorHandle: string;
  profileUrl?: string | null;
}

/** Raw social signal post — immutable provenance anchor */
export interface SocialPostEntity {
  readonly entityType: 'SOCIAL_POST';
  signalId: string;
  sourcePlatform: string;
  sourceRecordId: string;
  sourceUrl: string;
  publicationTimestamp?: string | null;
}

/** Unverified text mention extracted from post content (company name or domain) */
export interface CandidateMentionEntity {
  readonly entityType: 'CANDIDATE_MENTION';
  mentionedCompanyName?: string | null;
  mentionedDomain?: string | null;
  verbatimContextSnippet: string;
  isFirstPartyOwnershipClaim: boolean; // True only if author explicitly claims "my company X" / "our site Y.com"
}

/** Independently verified real-world business entity */
export interface VerifiedBusinessEntity {
  readonly entityType: 'VERIFIED_BUSINESS';
  businessId: string;
  canonicalName: string;
  verifiedDomain: string;
  registryOrDirectorySource: string; // e.g., "osm_overpass", "verified_website_audit"
}

// ---------------------------------------------------------------------------
// 2. Match Methods, Evidence, and Verification States
// ---------------------------------------------------------------------------

export type IdentityMatchMethod =
  | 'UNRESOLVED_NONE'
  | 'SUBREDDIT_OR_KEYWORD_ONLY'
  | 'THIRD_PARTY_TEXT_MENTION_ONLY'
  | 'FIRST_PARTY_CLAIM_UNCORROBORATED'
  | 'CORROBORATED_DOMAIN_AND_AUTHOR_PROOF';

export type IdentityVerificationStatus =
  | 'UNRESOLVED'
  | 'CANDIDATE_PENDING_REVIEW'
  | 'VERIFIED'
  | 'REJECTED';

export interface CorroboratingEvidenceItem {
  evidenceType:
    | 'VERBATIM_FIRST_PARTY_CLAIM'
    | 'AUTHOR_PROFILE_DOMAIN_LINK'
    | 'WEBSITE_BACKLINK_TO_SOCIAL'
    | 'OFFICIAL_DIRECTORY_MATCH';
  verbatimPostSnippet?: string;
  externalVerificationUrl?: string;
  description: string;
}

/**
 * Complete Identity Resolution Record Contract
 * Stores source evidence, candidate match, match method, match confidence,
 * and verification status separately from intent classification confidence.
 */
export interface IdentityResolutionRecordContract {
  post: SocialPostEntity;
  author: SocialAuthorEntity;
  intentClassificationConfidence: number; // Strictly separate from businessMatchConfidence
  businessMatchConfidence: number; // 0.0 to 1.0 (must be 0.0 when UNRESOLVED)
  matchMethod: IdentityMatchMethod;
  verificationStatus: IdentityVerificationStatus;
  candidateMention?: CandidateMentionEntity | null;
  resolvedBusiness?: VerifiedBusinessEntity | null;
  corroboratingEvidence: CorroboratingEvidenceItem[];
  isAmbiguous: boolean;
  disqualificationReasons: string[];
}

// ---------------------------------------------------------------------------
// 3. Deterministic Safety Contract Validator
// ---------------------------------------------------------------------------

export interface IdentitySafetyValidationResult {
  valid: boolean;
  enforcedStatus: IdentityVerificationStatus;
  enforcedMatchConfidence: number;
  enforcedResolvedBusiness: VerifiedBusinessEntity | null;
  violations: string[];
}

/**
 * Validates and enforces the Phase 3 Identity-Resolution Safety Contract.
 * Guarantees that:
 * - Anonymous handles, subreddit names, or keyword matches never produce a VERIFIED business.
 * - Third-party company/tool mentions (e.g. "We use Shopify/HubSpot") never link as the buyer's identity.
 * - Classification confidence is never copied or conflated with business match confidence.
 * - Ambiguous or uncorroborated candidates remain UNRESOLVED.
 * - Claimed verbatim quotes must exist in the original source text (Zero-Fabrication).
 */
export function validateIdentityResolutionSafety(
  candidate: IdentityResolutionRecordContract,
  rawSourcePostText: string
): IdentitySafetyValidationResult {
  const violations: string[] = [];

  // Rule 1: Distinct entity separation check
  if (
    candidate.post?.entityType !== 'SOCIAL_POST' ||
    candidate.author?.entityType !== 'SOCIAL_AUTHOR'
  ) {
    violations.push('ENTITY_SEPARATION_VIOLATION');
  }

  // Rule 2: Zero-fabrication check on any claimed verbatim snippets in candidateMention or corroboratingEvidence
  if (candidate.candidateMention?.verbatimContextSnippet) {
    const validMention = validateVerbatimSnippets(rawSourcePostText, [
      candidate.candidateMention.verbatimContextSnippet,
    ]);
    if (validMention.length === 0) {
      violations.push('FABRICATED_MENTION_SNIPPET_REJECTED');
    }
  }

  for (const item of candidate.corroboratingEvidence || []) {
    if (item.verbatimPostSnippet) {
      const validEv = validateVerbatimSnippets(rawSourcePostText, [item.verbatimPostSnippet]);
      if (validEv.length === 0) {
        violations.push('FABRICATED_CORROBORATING_SNIPPET_REJECTED');
      }
    }
  }

  // Rule 3: Keyword or Subreddit match is never sufficient proof of business identity
  if (candidate.matchMethod === 'SUBREDDIT_OR_KEYWORD_ONLY') {
    violations.push('SUBREDDIT_OR_KEYWORD_INSUFFICIENT_FOR_IDENTITY');
    return {
      valid: false,
      enforcedStatus: 'UNRESOLVED',
      enforcedMatchConfidence: 0.0,
      enforcedResolvedBusiness: null,
      violations,
    };
  }

  // Rule 4: Mentioning a company or industry in text without first-party ownership claim is not buyer identity
  if (
    candidate.matchMethod === 'THIRD_PARTY_TEXT_MENTION_ONLY' ||
    (candidate.candidateMention && !candidate.candidateMention.isFirstPartyOwnershipClaim)
  ) {
    violations.push('THIRD_PARTY_COMPANY_MENTION_NOT_BUYER_IDENTITY');
    return {
      valid: false,
      enforcedStatus: 'UNRESOLVED',
      enforcedMatchConfidence: 0.0,
      enforcedResolvedBusiness: null,
      violations,
    };
  }

  // Rule 5: Ambiguous identity must remain UNRESOLVED rather than guessing
  if (candidate.isAmbiguous) {
    violations.push('AMBIGUOUS_IDENTITY_MUST_REMAIN_UNRESOLVED');
    return {
      valid: candidate.verificationStatus === 'UNRESOLVED' && !candidate.resolvedBusiness,
      enforcedStatus: 'UNRESOLVED',
      enforcedMatchConfidence: 0.0,
      enforcedResolvedBusiness: null,
      violations,
    };
  }

  // Rule 6: Classification confidence is NOT business-match confidence
  if (
    candidate.businessMatchConfidence > 0 &&
    candidate.corroboratingEvidence.length === 0 &&
    candidate.businessMatchConfidence === candidate.intentClassificationConfidence
  ) {
    violations.push('CLASSIFICATION_CONFIDENCE_CONFLATED_WITH_MATCH_CONFIDENCE');
    return {
      valid: false,
      enforcedStatus: 'UNRESOLVED',
      enforcedMatchConfidence: 0.0,
      enforcedResolvedBusiness: null,
      violations,
    };
  }

  // Rule 7: Marking a match VERIFIED requires corroborating evidence and a valid VerifiedBusinessEntity
  if (candidate.verificationStatus === 'VERIFIED') {
    const hasFirstPartyClaim = candidate.corroboratingEvidence.some(
      (e) => e.evidenceType === 'VERBATIM_FIRST_PARTY_CLAIM' && Boolean(e.verbatimPostSnippet)
    );
    const hasExternalCorroboration = candidate.corroboratingEvidence.some(
      (e) =>
        (e.evidenceType === 'AUTHOR_PROFILE_DOMAIN_LINK' ||
          e.evidenceType === 'WEBSITE_BACKLINK_TO_SOCIAL' ||
          e.evidenceType === 'OFFICIAL_DIRECTORY_MATCH') &&
        Boolean(e.externalVerificationUrl)
    );
    const hasValidBusiness =
      candidate.resolvedBusiness?.entityType === 'VERIFIED_BUSINESS' &&
      Boolean(candidate.resolvedBusiness.canonicalName?.trim()) &&
      Boolean(candidate.resolvedBusiness.verifiedDomain?.trim());

    if (!hasFirstPartyClaim || !hasExternalCorroboration || !hasValidBusiness) {
      violations.push('VERIFIED_STATUS_REQUIRES_CORROBORATING_EVIDENCE');
      return {
        valid: false,
        enforcedStatus: hasFirstPartyClaim ? 'CANDIDATE_PENDING_REVIEW' : 'UNRESOLVED',
        enforcedMatchConfidence: hasFirstPartyClaim
          ? Math.min(candidate.businessMatchConfidence, 0.45)
          : 0.0,
        enforcedResolvedBusiness: null,
        violations,
      };
    }
  }

  // If violations occurred (e.g. fabricated snippet), force UNRESOLVED
  if (violations.length > 0) {
    return {
      valid: false,
      enforcedStatus: 'UNRESOLVED',
      enforcedMatchConfidence: 0.0,
      enforcedResolvedBusiness: null,
      violations,
    };
  }

  // Default safe pass for valid UNRESOLVED, CANDIDATE_PENDING_REVIEW, or corroborated VERIFIED
  return {
    valid: true,
    enforcedStatus: candidate.verificationStatus,
    enforcedMatchConfidence:
      candidate.verificationStatus === 'UNRESOLVED' ? 0.0 : candidate.businessMatchConfidence,
    enforcedResolvedBusiness:
      candidate.verificationStatus === 'VERIFIED' ? candidate.resolvedBusiness || null : null,
    violations: [],
  };
}

