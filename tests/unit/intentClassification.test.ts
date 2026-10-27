import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DeterministicIntentClassifier, CLASSIFIER_VERSION } from '@/lib/social/deterministicClassifier';
import { IntentClassificationService } from '@/lib/social/intentClassificationService';
import { validateVerbatimSnippets, extractVerbatimContext } from '@/lib/social/evidenceValidator';
import {
  validateIdentityResolutionSafety,
  IdentityResolutionRecordContract,
} from '@/lib/social/identityResolutionContract';
import { POST } from '@/app/api/social-signals/classify/route';
import { prisma } from '@/lib/prisma';

describe('Phase 2 & 2.1: Buying-Intent Classification & Remediation Suite', () => {
  let classifier: DeterministicIntentClassifier;
  let service: IntentClassificationService;

  beforeEach(() => {
    vi.restoreAllMocks();
    classifier = new DeterministicIntentClassifier();
    service = new IntentClassificationService();
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  // ---------------------------------------------------------------------------
  // 1. All Eight Categories & Category-Specific Verbatim Evidence
  // ---------------------------------------------------------------------------
  describe('1. Intent Taxonomy — All 8 Categories & Verbatim Evidence', () => {
    it('classifies EXPLICIT_PURCHASE_INTENT when explicit hiring and budget are provided [SYNTHETIC FIXTURE]', () => {
      const fixture = {
        title: '[Hiring] Web Design Agency needed for SaaS rebrand',
        contentText: 'Looking to hire an established agency. Our fixed price budget is $8,000 for full redesign.',
      };

      const result = classifier.classify(fixture);
      expect(result.primaryCategory).toBe('EXPLICIT_PURCHASE_INTENT');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.90);
      expect(result.scoreType).toBe('heuristic');
      expect(result.reviewStatus).toBe('CONFIRMED');
      expect(result.reasonCodes).toContain('EXPLICIT_BUYING_SIGNAL');
      expect(result.reasonCodes).toContain('EXPLICIT_BUDGET_DISCLOSED');
      expect(result.evidenceSnippets.length).toBeGreaterThan(0);
    });

    it('classifies ACTIVE_VENDOR_SEARCH when seeking agency recommendations or proposals [SYNTHETIC FIXTURE]', () => {
      const fixture = {
        title: 'Can anyone recommend an agency for Shopify store redesign?',
        contentText: 'We are seeking vendor proposals to rebuild our e-commerce platform this quarter.',
      };

      const result = classifier.classify(fixture);
      expect(result.primaryCategory).toBe('ACTIVE_VENDOR_SEARCH');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.75);
      expect(result.reviewStatus).toBe('CONFIRMED');
      expect(result.evidenceSnippets).toContain('recommend an agency');
    });

    it('classifies WEBSITE_REDESIGN_NEED for genuine buyer web overhaul requests [SYNTHETIC FIXTURE]', () => {
      const fixture = {
        title: 'Need our website redesigned for dental clinic',
        contentText: 'Need a website built with mobile responsiveness and booking integration.',
      };

      const result = classifier.classify(fixture);
      expect(result.primaryCategory).toBe('WEBSITE_REDESIGN_NEED');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.75);
      expect(result.reviewStatus).toBe('CONFIRMED');
      expect(result.evidenceSnippets).toContain('website redesign');
    });

    it('classifies MARKETING_SERVICE_NEED for digital marketing and SEO requirements [SYNTHETIC FIXTURE]', () => {
      const fixture = {
        title: 'Looking for a B2B SEO agency',
        contentText: 'We need digital marketing and ongoing lead generation agency support.',
      };

      const result = classifier.classify(fixture);
      expect(result.primaryCategory).toBe('MARKETING_SERVICE_NEED');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.75);
      expect(result.reviewStatus).toBe('CONFIRMED');
      expect(result.evidenceSnippets).toContain('SEO agency');
    });

    it('classifies TECHNICAL_PROBLEM for DIY troubleshooting without commercial intent [SYNTHETIC FIXTURE]', () => {
      const fixture = {
        title: 'How do I fix Next.js hydration error in React 19?',
        contentText: 'Getting cannot read properties of undefined in my navbar component layout.',
      };

      const result = classifier.classify(fixture);
      expect(result.primaryCategory).toBe('TECHNICAL_PROBLEM');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.80);
      expect(result.reviewStatus).toBe('CONFIRMED');
      expect(result.reasonCodes).toContain('DIY_TECHNICAL_PROBLEM');
      expect(result.evidenceSnippets).toContain('How do I fix');
    });

    it('classifies GENERAL_DISCUSSION for community tech questions and debates [SYNTHETIC FIXTURE]', () => {
      const fixture = {
        title: 'Ask HN: What is your favorite tech stack for MVPs in 2026?',
        contentText: 'Curious what database and backend frameworks developers are choosing today.',
      };

      const result = classifier.classify(fixture);
      expect(result.primaryCategory).toBe('GENERAL_DISCUSSION');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.70);
      expect(result.reviewStatus).toBe('CONFIRMED');
      expect(result.evidenceSnippets).toContain('Ask HN:');
    });

    it('classifies SELF_PROMOTION when author is advertising their own services [SYNTHETIC FIXTURE]', () => {
      const fixture = {
        title: '[For Hire] Senior Web Designer available for projects',
        contentText: 'I am a freelance UI/UX designer. Check out my portfolio and DM me for rates.',
      };

      const result = classifier.classify(fixture);
      expect(result.primaryCategory).toBe('SELF_PROMOTION');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.90);
      expect(result.reviewStatus).toBe('CONFIRMED');
      expect(result.reasonCodes).toContain('SKEPTIC_FLAG_SELF_PROMOTION');
    });

    it('classifies IRRELEVANT for off-topic non-tech/non-business posts (distinct from GENERAL_DISCUSSION) [SYNTHETIC FIXTURE]', () => {
      const fixture = {
        title: 'Best hiking trails near Denver',
        contentText: 'Planning a weekend camping trip, any trail suggestions with water sources?',
      };

      const result = classifier.classify(fixture);
      expect(result.primaryCategory).toBe('IRRELEVANT');
      expect(result.reasonCodes).toContain('OFF_TOPIC_OR_IRRELEVANT');
      expect(result.evidenceSnippets).toContain('hiking trails');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Dead, Deleted, Moderation Meta, and Stale Records (Defect 2.A)
  // ---------------------------------------------------------------------------
  describe('2. Dead, Deleted, Moderation Meta & Stale Signal Safeguards', () => {
    it('rejects HN [dead] posts even when body contains website/freelance keywords [KNOWN FALSE POSITIVE REGRESSION]', () => {
      const hnDeadFixture = {
        title: '[dead]',
        contentText:
          'With 6 years of professional experience, I offer highly skilled web development. Whether you need a website built from scratch or an existing site overhauled, check my portfolio.',
        sourcePlatform: 'hackernews',
        publicationTimestamp: '2024-05-27T14:59:13.000Z',
      };

      const result = classifier.classify(hnDeadFixture, {
        referenceDate: new Date('2026-10-27T00:00:00.000Z'),
      });
      expect(result.primaryCategory).toBe('IRRELEVANT');
      expect(result.reviewStatus).toBe('REJECTED');
      expect(result.confidenceScore).toBe(0.0);
      expect(result.reasonCodes).toContain('DEAD_OR_DELETED_POST');
      expect(result.reasonCodes).toContain('STALE_SIGNAL');
    });

    it('rejects records marked dead or deleted in metadata or tags [SYNTHETIC FIXTURE]', () => {
      const metaDeadFixture = {
        title: 'Looking to hire a web agency for $5,000',
        contentText: 'We need a website built urgently.',
        metadata: JSON.stringify({ _tags: ['story', 'dead'] }),
      };

      const result = classifier.classify(metaDeadFixture);
      expect(result.primaryCategory).toBe('IRRELEVANT');
      expect(result.reviewStatus).toBe('REJECTED');
      expect(result.confidenceScore).toBe(0.0);
      expect(result.reasonCodes).toContain('DEAD_OR_DELETED_POST');
    });

    it('suppresses stale commercial posts (>30 days old) from becoming CONFIRMED buying opportunities [SYNTHETIC FIXTURE]', () => {
      const staleCommercialFixture = {
        title: '[Hiring] Need web design agency for $10,000 project',
        contentText: 'Looking to hire an agency to redesign our website.',
        publicationTimestamp: '2023-01-15T10:00:00.000Z',
      };

      const result = classifier.classify(staleCommercialFixture, {
        maxAgeDays: 30,
        referenceDate: new Date('2026-10-27T00:00:00.000Z'),
      });

      expect(result.reviewStatus).toBe('STALE');
      expect(result.confidenceScore).toBeLessThanOrEqual(0.40);
      expect(result.reasonCodes).toContain('STALE_SIGNAL');
      expect(result.reasonCodes).toContain('HISTORICAL_COMMERCIAL_SIGNAL_SUPPRESSED');
      expect(result.skepticEvaluation?.isStale).toBe(true);
    });

    it('classifies subreddit moderation / rules announcements as IRRELEVANT without false budget extraction [KNOWN FALSE POSITIVE REGRESSION]', () => {
      const modRuleFixture = {
        title: 'Rules Reminder + Updates: Low Quality, Commission & Other Things',
        contentText:
          'From this point on, any of these job postings will result in an immediate permaban. Commission-Based Only Jobs: they are earning more than $20/hr, give us a break! Vague posts like DM me for a quick $30 job are banned.',
        publicationTimestamp: '2025-08-04T20:49:49.000Z',
      };

      const result = classifier.classify(modRuleFixture, {
        referenceDate: new Date('2026-10-27T00:00:00.000Z'),
      });

      expect(result.primaryCategory).toBe('IRRELEVANT');
      expect(result.reasonCodes).toContain('MODERATION_OR_RULES_META_POST');
      expect(result.analystEvaluation?.hasBudget).toBe(false);
      expect(result.evidenceSnippets).not.toContain('$20');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Hiring, Job Seeker, Freelancer & Sales-Partner Disambiguation (Defect 2.B)
  // ---------------------------------------------------------------------------
  describe('3. Hiring, Job Seeker, Freelancer & Sales-Partner Disambiguation', () => {
    it('classifies freelancer recruiting a cold caller / sales partner as SELF_PROMOTION, never WEBSITE_REDESIGN_NEED [KNOWN FALSE POSITIVE REGRESSION]', () => {
      const salesPartnerFixture = {
        title: '[Hiring], Looking for a Cold Caller / Sales Partner for Freelance Web Design Projects',
        contentText:
          "I'm a freelance UX/UI Designer & Web Developer with 1+ years of experience. I'm looking for someone who can help me find clients through cold calling and outreach. What I offer: Website Design & Development, Landing Pages & Website Redesigns. What I need: Someone who can contact small businesses, pitch our services, and help convert leads into paying clients. Commission-based partnership.",
      };

      const result = classifier.classify(salesPartnerFixture);
      expect(result.primaryCategory).toBe('SELF_PROMOTION');
      expect(result.primaryCategory).not.toBe('WEBSITE_REDESIGN_NEED');
      expect(result.reasonCodes).toContain('SALES_PARTNER_RECRUITMENT');
      expect(result.reasonCodes).toContain('SKEPTIC_FLAG_SELF_PROMOTION');
    });

    it('classifies 2011 job seeker post ("Ask HN: Anyone hiring in/around Denver?") as SELF_PROMOTION + STALE, never TECHNICAL_PROBLEM [KNOWN FALSE POSITIVE REGRESSION]', () => {
      const hnJobSeekerFixture = {
        title: 'Ask HN: Anyone hiring in/around Denver?',
        contentText:
          "I'm looking for a software engineering job in/around Denver because my current job situation is rapidly deteriorating... I don't have enough pull to fix the things that are broken. Is there anyone out there looking for a software engineer? I'll be happy to submit a resume.",
        publicationTimestamp: '2011-11-17T19:02:07.000Z',
      };

      const result = classifier.classify(hnJobSeekerFixture, {
        referenceDate: new Date('2026-10-27T00:00:00.000Z'),
      });

      expect(result.primaryCategory).toBe('SELF_PROMOTION');
      expect(result.primaryCategory).not.toBe('TECHNICAL_PROBLEM');
      expect(result.reviewStatus).toBe('STALE');
      expect(result.reasonCodes).toContain('JOB_SEEKER_NOT_BUYER');
      expect(result.reasonCodes).toContain('STALE_SIGNAL');
    });

    it('classifies Show HN agency launch and beta-tester recruitment as SELF_PROMOTION [KNOWN FALSE POSITIVE REGRESSION]', () => {
      const showHnFixture = {
        title: 'Show HN: I Made a Website Hiring Platform: Find Talent, or Get Hired',
        contentText:
          'I’m Eric, founder of WebBuilders, we offer solutions across four tiers to meet your specific needs and budget.',
        publicationTimestamp: '2024-05-10T23:22:19.000Z',
      };

      const result = classifier.classify(showHnFixture, {
        referenceDate: new Date('2026-10-27T00:00:00.000Z'),
      });
      expect(result.primaryCategory).toBe('SELF_PROMOTION');
      expect(result.reviewStatus).toBe('STALE');
      expect(result.reasonCodes).toContain('SKEPTIC_FLAG_SELF_PROMOTION');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Confidence, Review Semantics & Malformed Content (Defect 2.C & Section 3)
  // ---------------------------------------------------------------------------
  describe('4. Confidence Calibration, Contradictions & Malformed Inputs', () => {
    it('does NOT assign high confidence when no category keywords match (default fallback)', () => {
      const vagueFixture = {
        title: 'Random thought',
        contentText: 'Just checking if this message goes through on the board today.',
      };

      const result = classifier.classify(vagueFixture);
      expect(result.primaryCategory).toBe('IRRELEVANT');
      expect(result.confidenceScore).toBeLessThanOrEqual(0.40);
      expect(result.reviewStatus).toBe('NEEDS_REVIEW');
      expect(result.reasonCodes).toContain('NO_CATEGORY_EVIDENCE');
      expect(result.reasonCodes).toContain('DEFAULT_FALLBACK_LOW_CONFIDENCE');
    });

    it('rejects empty or whitespace-only source content with 0.0 confidence and REJECTED status', () => {
      const emptyResult = classifier.classify({ title: '   ', contentText: '' });
      expect(emptyResult.primaryCategory).toBe('IRRELEVANT');
      expect(emptyResult.confidenceScore).toBe(0.0);
      expect(emptyResult.reviewStatus).toBe('REJECTED');
      expect(emptyResult.reasonCodes).toContain('EMPTY_OR_MALFORMED_CONTENT');
    });

    it('triggers NEEDS_REVIEW and lowers confidence on contradictory buyer + job-seeker signals', () => {
      const fixture = {
        title: '[Hiring] Or looking for work as a junior frontend developer',
        contentText: 'I want to build apps but also looking for a job as an intern.',
      };

      const result = classifier.classify(fixture);
      expect(result.reviewStatus).toBe('NEEDS_REVIEW');
      expect(result.confidenceScore).toBeLessThanOrEqual(0.45);
      expect(result.reasonCodes).toContain('JUDGE_DISAGREEMENT');
      expect(result.reasonCodes).toContain('CONTRADICTORY_EVIDENCE');
    });

    it('marks commercial pain without explicit budget as TENTATIVE rather than CONFIRMED', () => {
      const fixture = {
        title: 'Our company website is not converting visitors',
        contentText: 'We get traffic from ads but almost no form submissions. Site feels slow and outdated.',
      };

      const result = classifier.classify(fixture);
      expect(result.reviewStatus).toBe('TENTATIVE');
      expect(result.confidenceScore).toBeLessThanOrEqual(0.65);
      expect(result.reasonCodes).toContain('INFERRED_COMMERCIAL_PAIN');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Verbatim Evidence & Zero-Fabrication Guarantees
  // ---------------------------------------------------------------------------
  describe('5. Verbatim Evidence & Zero-Fabrication Guarantees', () => {
    it('validates candidate evidence snippets against source text verbatim', () => {
      const source = 'We are looking to hire an agency with a budget of $5,000 for landing page redesign.';
      const candidates = [
        'budget of $5,000',
        'looking to hire an agency',
        'FABRICATED QUOTE NOT IN TEXT',
      ];

      const verified = validateVerbatimSnippets(source, candidates);
      expect(verified).toHaveLength(2);
      expect(verified).toContain('budget of $5,000');
      expect(verified).toContain('looking to hire an agency');
      expect(verified).not.toContain('FABRICATED QUOTE NOT IN TEXT');
    });

    it('guarantees that all evidence snippets returned by classifier exist verbatim in source text', () => {
      const fixture = {
        title: '[Hiring] React Engineer for marketing portal',
        contentText: 'We have a budget is $4,000 to complete this website redesign urgently.',
      };

      const result = classifier.classify(fixture);
      const fullSource = `${fixture.title}\n${fixture.contentText}`.toLowerCase();

      expect(result.evidenceSnippets.length).toBeGreaterThan(0);
      for (const snippet of result.evidenceSnippets) {
        expect(fullSource).toContain(snippet.toLowerCase());
      }
    });

    it('handles extractVerbatimContext safely', () => {
      const text = 'Quick test for budget $500 in body';
      const snippet = extractVerbatimContext(text, /budget\s*\$500/i, 10);
      expect(snippet).toBeDefined();
      expect(text).toContain(snippet!);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Conservative Fallback, AI Provider & Idempotent Persistence
  // ---------------------------------------------------------------------------
  describe('6. Conservative Fallback, AI Provider & Idempotent Persistence', () => {
    it('falls back seamlessly to deterministic classifier when AI keys are missing', async () => {
      const fixture = {
        title: '[Hiring] Web Design Agency for medical practice',
        contentText: 'Looking to hire an agency. Budget is $10,000.',
      };

      const result = await service.classifySignal(fixture);
      expect(result.evaluationStrategy).toBe('deterministic_fallback');
      expect(result.reasonCodes).toContain('CONSERVATIVE_DETERMINISTIC_FALLBACK');
      expect(result.primaryCategory).toBe('EXPLICIT_PURCHASE_INTENT');
    });

    it('handles malformed AI JSON output safely and falls back cleanly', async () => {
      process.env.GEMINI_API_KEY = 'mock_gemini_test_key_abc123';

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'NOT VALID JSON {{{' }] } }],
        }),
      } as any);

      const fixture = {
        title: 'Need help fixing CSS bug',
        contentText: 'My flexbox layout is broken on mobile Safari.',
      };

      const result = await service.classifySignal(fixture);
      expect(result.evaluationStrategy).toBe('deterministic_fallback');
      expect(result.primaryCategory).toBe('TECHNICAL_PROBLEM');
    });

    it('persists classifications idempotently and preserves raw SocialSignal timestamps', async () => {
      const rawPubDate = new Date('2026-10-25T12:00:00.000Z');
      const mockSignal = {
        id: 'test_signal_xyz_1',
        title: '[Hiring] Agency to build Next.js site',
        contentText: 'Looking to hire an agency with budget is $6,000.',
        sourcePlatform: 'reddit',
        publicationTimestamp: rawPubDate,
        metadata: null,
      };

      vi.spyOn((prisma as any).socialSignal, 'findUnique').mockResolvedValue(mockSignal as any);
      const upsertSpy = vi
        .spyOn((prisma as any).socialSignalClassification, 'upsert')
        .mockResolvedValue({} as any);

      const res1 = await service.classifyAndStoreSignal('test_signal_xyz_1', {
        forceDeterministic: true,
      });

      expect(res1.success).toBe(true);
      expect(upsertSpy).toHaveBeenCalledTimes(1);

      const callArgs = upsertSpy.mock.calls[0][0] as any;
      expect(callArgs.where).toEqual({
        signalId_classifierVersion: {
          signalId: 'test_signal_xyz_1',
          classifierVersion: CLASSIFIER_VERSION,
        },
      });
      // Raw signal object was never mutated
      expect(mockSignal.publicationTimestamp).toBe(rawPubDate);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Phase 3 Identity-Resolution Safety Contract Invariants (Section 4)
  // ---------------------------------------------------------------------------
  describe('7. Phase 3 Identity-Resolution Safety Contract', () => {
    const basePost = {
      entityType: 'SOCIAL_POST' as const,
      signalId: 'sig_1',
      sourcePlatform: 'reddit',
      sourceRecordId: '1x4abc',
      sourceUrl: 'https://reddit.com/r/smallbusiness/comments/1x4abc',
    };

    const baseAuthor = {
      entityType: 'SOCIAL_AUTHOR' as const,
      platform: 'reddit',
      authorHandle: 'u/anonymous_founder_99',
    };

    it('rejects business identity link based solely on subreddit name or keyword match', () => {
      const candidate: IdentityResolutionRecordContract = {
        post: basePost,
        author: baseAuthor,
        intentClassificationConfidence: 0.90,
        businessMatchConfidence: 0.85,
        matchMethod: 'SUBREDDIT_OR_KEYWORD_ONLY',
        verificationStatus: 'VERIFIED',
        resolvedBusiness: {
          entityType: 'VERIFIED_BUSINESS',
          businessId: 'biz_1',
          canonicalName: 'Small Business Inc',
          verifiedDomain: 'smallbusiness.com',
          registryOrDirectorySource: 'keyword_guess',
        },
        corroboratingEvidence: [],
        isAmbiguous: false,
        disqualificationReasons: [],
      };

      const check = validateIdentityResolutionSafety(
        candidate,
        'Looking to hire a web designer for our shop.'
      );
      expect(check.valid).toBe(false);
      expect(check.enforcedStatus).toBe('UNRESOLVED');
      expect(check.enforcedMatchConfidence).toBe(0.0);
      expect(check.enforcedResolvedBusiness).toBeNull();
      expect(check.violations).toContain('SUBREDDIT_OR_KEYWORD_INSUFFICIENT_FOR_IDENTITY');
    });

    it('rejects linking a post to a third-party company merely mentioned in the text (e.g. Shopify/HubSpot)', () => {
      const sourceText = 'We are migrating our store from Shopify to a custom Next.js build.';
      const candidate: IdentityResolutionRecordContract = {
        post: basePost,
        author: baseAuthor,
        intentClassificationConfidence: 0.88,
        businessMatchConfidence: 0.80,
        matchMethod: 'THIRD_PARTY_TEXT_MENTION_ONLY',
        verificationStatus: 'VERIFIED',
        candidateMention: {
          entityType: 'CANDIDATE_MENTION',
          mentionedCompanyName: 'Shopify',
          verbatimContextSnippet: 'migrating our store from Shopify',
          isFirstPartyOwnershipClaim: false,
        },
        resolvedBusiness: {
          entityType: 'VERIFIED_BUSINESS',
          businessId: 'biz_shopify',
          canonicalName: 'Shopify',
          verifiedDomain: 'shopify.com',
          registryOrDirectorySource: 'domain_lookup',
        },
        corroboratingEvidence: [],
        isAmbiguous: false,
        disqualificationReasons: [],
      };

      const check = validateIdentityResolutionSafety(candidate, sourceText);
      expect(check.valid).toBe(false);
      expect(check.enforcedStatus).toBe('UNRESOLVED');
      expect(check.enforcedResolvedBusiness).toBeNull();
      expect(check.violations).toContain('THIRD_PARTY_COMPANY_MENTION_NOT_BUYER_IDENTITY');
    });

    it('prevents conflating intentClassificationConfidence with businessMatchConfidence', () => {
      const candidate: IdentityResolutionRecordContract = {
        post: basePost,
        author: baseAuthor,
        intentClassificationConfidence: 0.92,
        businessMatchConfidence: 0.92, // Conflated with intent confidence without evidence
        matchMethod: 'FIRST_PARTY_CLAIM_UNCORROBORATED',
        verificationStatus: 'CANDIDATE_PENDING_REVIEW',
        corroboratingEvidence: [],
        isAmbiguous: false,
        disqualificationReasons: [],
      };

      const check = validateIdentityResolutionSafety(
        candidate,
        'Need a website redesign for our dental clinic.'
      );
      expect(check.valid).toBe(false);
      expect(check.enforcedStatus).toBe('UNRESOLVED');
      expect(check.violations).toContain('CLASSIFICATION_CONFIDENCE_CONFLATED_WITH_MATCH_CONFIDENCE');
    });

    it('preserves ambiguous identity candidates as UNRESOLVED with null business', () => {
      const candidate: IdentityResolutionRecordContract = {
        post: basePost,
        author: baseAuthor,
        intentClassificationConfidence: 0.85,
        businessMatchConfidence: 0.50,
        matchMethod: 'FIRST_PARTY_CLAIM_UNCORROBORATED',
        verificationStatus: 'CANDIDATE_PENDING_REVIEW',
        isAmbiguous: true,
        corroboratingEvidence: [],
        disqualificationReasons: ['MULTIPLE_CITIES_MATCH_NAME'],
      };

      const check = validateIdentityResolutionSafety(
        candidate,
        'We run Apex Dental and need a new website.'
      );
      expect(check.enforcedStatus).toBe('UNRESOLVED');
      expect(check.enforcedMatchConfidence).toBe(0.0);
      expect(check.enforcedResolvedBusiness).toBeNull();
    });

    it('allows VERIFIED status only when first-party verbatim claim and external corroboration both exist', () => {
      const sourceText = 'I am the founder of Acme Clinic (acmeclinic.in) and we need a website redesign.';
      const candidate: IdentityResolutionRecordContract = {
        post: basePost,
        author: baseAuthor,
        intentClassificationConfidence: 0.90,
        businessMatchConfidence: 0.88,
        matchMethod: 'CORROBORATED_DOMAIN_AND_AUTHOR_PROOF',
        verificationStatus: 'VERIFIED',
        candidateMention: {
          entityType: 'CANDIDATE_MENTION',
          mentionedCompanyName: 'Acme Clinic',
          mentionedDomain: 'acmeclinic.in',
          verbatimContextSnippet: 'founder of Acme Clinic (acmeclinic.in)',
          isFirstPartyOwnershipClaim: true,
        },
        resolvedBusiness: {
          entityType: 'VERIFIED_BUSINESS',
          businessId: 'biz_acme_1',
          canonicalName: 'Acme Clinic Pvt Ltd',
          verifiedDomain: 'acmeclinic.in',
          registryOrDirectorySource: 'verified_website_audit',
        },
        corroboratingEvidence: [
          {
            evidenceType: 'VERBATIM_FIRST_PARTY_CLAIM',
            verbatimPostSnippet: 'founder of Acme Clinic (acmeclinic.in)',
            description: 'Explicit first-party ownership and domain stated in post.',
          },
          {
            evidenceType: 'AUTHOR_PROFILE_DOMAIN_LINK',
            externalVerificationUrl: 'https://acmeclinic.in/about',
            description: 'Author handle corroborated on official domain.',
          },
        ],
        isAmbiguous: false,
        disqualificationReasons: [],
      };

      const check = validateIdentityResolutionSafety(candidate, sourceText);
      expect(check.valid).toBe(true);
      expect(check.enforcedStatus).toBe('VERIFIED');
      expect(check.enforcedResolvedBusiness?.verifiedDomain).toBe('acmeclinic.in');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Classification API Route & Authentication Regression
  // ---------------------------------------------------------------------------
  describe('8. Classification API Route & Authentication Guard', () => {
    const TEST_SECRET = 'leadpilot_test_classification_secret_123456';

    beforeEach(() => {
      process.env.INTERNAL_API_SECRET = TEST_SECRET;
    });

    it('rejects unauthenticated classification requests with 401 Unauthorized', async () => {
      const req = new NextRequest('http://localhost:3000/api/social-signals/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewText: 'Sample post text' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unauthorized');
    });

    it('processes preview classification and returns exact category and heuristic scoreType', async () => {
      const req = new NextRequest('http://localhost:3000/api/social-signals/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_SECRET}`,
        },
        body: JSON.stringify({
          previewTitle: '[Hiring] Urgent landing page redesign',
          previewText: 'Looking to hire an agency. Budget is $5,000.',
          forceDeterministic: true,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.preview).toBe(true);
      expect(body.result.primaryCategory).toBe('EXPLICIT_PURCHASE_INTENT');
      expect(body.result.scoreType).toBe('heuristic');
      expect(body.result.evidenceSnippets.length).toBeGreaterThan(0);
    });

    it('validates invalid empty requests with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/social-signals/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_SECRET}`,
        },
        body: JSON.stringify({}),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid request');
    });
  });
});
