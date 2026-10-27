import {
  IntentCategory,
  IntentClassificationResult,
  SkepticEvaluation,
  AnalystEvaluation,
  OptimistEvaluation,
  ReviewStatus,
  ClassifiableSignalInput,
  ClassificationPolicyOptions,
} from './intentTypes';
import { validateVerbatimSnippets, extractVerbatimContext } from './evidenceValidator';

export const CLASSIFIER_VERSION = '2.1.0';
export const DEFAULT_MAX_AGE_DAYS = 30;

/**
 * Deterministic Three-Judge Intent Classifier (Phase 2.1 Hardened)
 * Evaluates social signals across Skeptic, Analyst, and Optimist roles using
 * strict, evidence-backed rules. Enforces dead/deleted rejection, freshness policies,
 * hiring/self-promo/sales-partner disambiguation, and heuristic confidence bounds.
 */
export class DeterministicIntentClassifier {
  /**
   * Classifies a social post using deterministic 3-judge evaluation
   */
  classify(
    signal: ClassifiableSignalInput,
    options: ClassificationPolicyOptions = {}
  ): IntentClassificationResult {
    const startTime = Date.now();
    const title = typeof signal?.title === 'string' ? signal.title.trim() : '';
    const content = typeof signal?.contentText === 'string' ? signal.contentText.trim() : '';
    const fullText = `${title}\n${content}`.trim();
    const lowerFullText = fullText.toLowerCase();

    // 0. Check for empty or malformed source content immediately
    const alphaNumericCount = fullText.replace(/[^a-z0-9]/gi, '').length;
    if (!fullText || alphaNumericCount < 3) {
      return {
        signalId: signal?.id,
        classifierVersion: CLASSIFIER_VERSION,
        primaryCategory: 'IRRELEVANT',
        confidenceScore: 0.0,
        scoreType: 'heuristic',
        reviewStatus: 'REJECTED',
        evidenceSnippets: [],
        explanation: 'Rejected: Source signal is empty or contains malformed/insufficient text.',
        reasonCodes: ['EMPTY_OR_MALFORMED_CONTENT'],
        skepticEvaluation: {
          isSelfPromo: false,
          isJobSeeker: false,
          isDeadOrDeleted: false,
          isStale: false,
          isSpamOrIrrelevant: true,
          riskLevel: 'HIGH',
          flags: ['EMPTY_OR_MALFORMED_CONTENT'],
          challengeReason: 'Source content is empty or malformed.',
        },
        evaluationStrategy: 'three_judge_deterministic',
        providerModel: 'rule_engine_v2.1',
        processingDurationMs: Date.now() - startTime,
        classifiedAt: new Date().toISOString(),
      };
    }

    // 1. Freshness & Staleness Evaluation
    const freshness = this.evaluateFreshness(signal?.publicationTimestamp, options);

    // 2. Skeptic Judge Evaluation (includes dead/deleted, moderation meta, self-promo, job-seeker, sales-partner)
    const skeptic = this.evaluateSkeptic(title, content, lowerFullText, signal, freshness);

    // 3. Analyst Judge Evaluation (requires category-specific evidence and excludes seller pitch conditionals)
    const analyst = this.evaluateAnalyst(title, content, lowerFullText, fullText, skeptic);

    // 4. Optimist Judge Evaluation
    const optimist = this.evaluateOptimist(title, content, lowerFullText, skeptic);

    // 5. Arbitration & Decision Engine
    const decision = this.arbitrate(skeptic, analyst, optimist, fullText, freshness);

    // 6. Verbatim Evidence Verification (Guarantees zero-fabrication)
    const verifiedSnippets = validateVerbatimSnippets(
      fullText,
      decision.candidateSnippets
    );

    // 7. Category-specific evidence gate for commercial classifications
    const isCommercialCategory = [
      'EXPLICIT_PURCHASE_INTENT',
      'ACTIVE_VENDOR_SEARCH',
      'WEBSITE_REDESIGN_NEED',
      'MARKETING_SERVICE_NEED',
    ].includes(decision.category);

    let finalConfidence = decision.confidence;
    let finalReviewStatus = decision.reviewStatus;
    const finalReasonCodes = [...decision.reasonCodes];

    if (isCommercialCategory && verifiedSnippets.length === 0) {
      finalConfidence = Math.min(finalConfidence, 0.40);
      if (finalReviewStatus === 'CONFIRMED') {
        finalReviewStatus = 'NEEDS_REVIEW';
      }
      if (!finalReasonCodes.includes('MISSING_CATEGORY_EVIDENCE')) {
        finalReasonCodes.push('MISSING_CATEGORY_EVIDENCE');
      }
    }

    return {
      signalId: signal.id,
      classifierVersion: CLASSIFIER_VERSION,
      primaryCategory: decision.category,
      confidenceScore: Number(finalConfidence.toFixed(2)),
      scoreType: 'heuristic',
      reviewStatus: finalReviewStatus,
      evidenceSnippets: verifiedSnippets,
      explanation: decision.explanation,
      reasonCodes: finalReasonCodes,
      skepticEvaluation: skeptic,
      analystEvaluation: analyst,
      optimistEvaluation: optimist,
      evaluationStrategy: 'three_judge_deterministic',
      providerModel: 'rule_engine_v2.1',
      processingDurationMs: Date.now() - startTime,
      classifiedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Freshness Policy Check
  // ---------------------------------------------------------------------------
  private evaluateFreshness(
    publicationTimestamp?: string | Date | null,
    options: ClassificationPolicyOptions = {}
  ): { isStale: boolean; ageDays: number | null; maxAgeDays: number } {
    const envMaxAge = process.env.SOCIAL_SIGNAL_MAX_AGE_DAYS
      ? parseInt(process.env.SOCIAL_SIGNAL_MAX_AGE_DAYS, 10)
      : NaN;
    const maxAgeDays =
      typeof options.maxAgeDays === 'number' && options.maxAgeDays > 0
        ? options.maxAgeDays
        : !isNaN(envMaxAge) && envMaxAge > 0
          ? envMaxAge
          : DEFAULT_MAX_AGE_DAYS;

    if (!publicationTimestamp) {
      return { isStale: false, ageDays: null, maxAgeDays };
    }

    const pubDate =
      publicationTimestamp instanceof Date
        ? publicationTimestamp
        : new Date(publicationTimestamp);

    if (isNaN(pubDate.getTime())) {
      return { isStale: false, ageDays: null, maxAgeDays };
    }

    const refTime = options.referenceDate ? options.referenceDate.getTime() : Date.now();
    const ageDays = (refTime - pubDate.getTime()) / (1000 * 60 * 60 * 24);

    return {
      isStale: ageDays > maxAgeDays,
      ageDays: Number(ageDays.toFixed(1)),
      maxAgeDays,
    };
  }

  // ---------------------------------------------------------------------------
  // Judge 1: Skeptic Evaluation
  // ---------------------------------------------------------------------------
  private evaluateSkeptic(
    title: string,
    content: string,
    lower: string,
    signal: ClassifiableSignalInput,
    freshness: { isStale: boolean; ageDays: number | null; maxAgeDays: number }
  ): SkepticEvaluation {
    const flags: string[] = [];
    const lowerTitle = title.toLowerCase().trim();
    const lowerContent = content.toLowerCase().trim();

    // 1. Dead or deleted detection across title, content, tags, and metadata
    let parsedMeta: Record<string, any> = {};
    if (signal?.metadata) {
      if (typeof signal.metadata === 'string') {
        try {
          parsedMeta = JSON.parse(signal.metadata);
        } catch {
          parsedMeta = {};
        }
      } else if (typeof signal.metadata === 'object') {
        parsedMeta = signal.metadata;
      }
    }

    const metaTags: string[] = [
      ...(Array.isArray(signal?.tags) ? signal.tags : []),
      ...(Array.isArray(parsedMeta?._tags) ? parsedMeta._tags : []),
      ...(Array.isArray(parsedMeta?.tags) ? parsedMeta.tags : []),
    ].map((t) => String(t).toLowerCase());

    const hasDeadOrDeletedTitle =
      lowerTitle === '[dead]' ||
      lowerTitle === '[deleted]' ||
      lowerTitle === '[removed]' ||
      lowerTitle.startsWith('[dead]') ||
      lowerTitle.startsWith('[deleted]') ||
      lowerTitle.startsWith('[removed]');

    const hasDeadOrDeletedContent =
      lowerContent === '[dead]' ||
      lowerContent === '[deleted]' ||
      lowerContent === '[removed]';

    const hasDeadOrDeletedMeta =
      metaTags.includes('dead') ||
      metaTags.includes('deleted') ||
      parsedMeta?.dead === true ||
      parsedMeta?.deleted === true;

    const isDeadOrDeleted =
      hasDeadOrDeletedTitle || hasDeadOrDeletedContent || hasDeadOrDeletedMeta;

    if (isDeadOrDeleted) {
      flags.push('DEAD_OR_DELETED_POST');
    }

    // 2. Stale signal detection
    if (freshness.isStale) {
      flags.push('STALE_PUBLICATION_TIMESTAMP');
    }

    // 3. Forum / Subreddit Moderation & Rules Announcement detection
    const moderationMetaPhrases = [
      'minimum karma requirements',
      'rules reminder',
      'immediate permaban',
      'bannable on-sight offense',
      'you will be muted and subsequently banned',
      'obligatory announcement over',
      'subreddit rules',
      'moderator announcement',
    ];
    const isModerationMeta = moderationMetaPhrases.some((p) => lower.includes(p));
    if (isModerationMeta) {
      flags.push('MODERATION_OR_RULES_META_POST');
    }

    // 4. Sales-Partner / Cold-Caller / Commission Recruitment detection
    const salesPartnerPhrases = [
      'cold caller',
      'sales partner',
      'appointment setter',
      'commission-based partnership',
      'help me find clients through cold calling',
      'pitch our services',
      'convert leads into paying clients',
    ];
    const isSalesPartnerRecruitment = salesPartnerPhrases.some((p) => lower.includes(p));
    if (isSalesPartnerRecruitment) {
      flags.push('SALES_PARTNER_RECRUITMENT');
    }

    // 5. Self-promotion & Service-Offering detection
    const isSelfPromoTitle =
      lowerTitle.startsWith('[for hire]') ||
      lowerTitle.startsWith('[forhire]') ||
      lowerTitle.startsWith('[offering]') ||
      lowerTitle.startsWith('[freelance]') ||
      lowerTitle.startsWith('show hn:') ||
      lowerTitle.includes('available for hire') ||
      lowerTitle.includes('hire me');

    const selfPromoContentPhrases = [
      'i am a freelance',
      "i'm a freelance",
      'i’m a freelance',
      'i am a web developer',
      "i'm a web developer",
      'i’m a web developer',
      "i'm a solo web developer",
      'i’m a solo web developer',
      'a full-stack dev with',
      'i can build your website',
      'offering web development',
      'offering web design',
      'i offer highly skilled',
      'what i offer:',
      'what we do:',
      'we offer solutions across',
      'my portfolio is',
      'my portfolio at',
      'check out my portfolio',
      'hire me for',
      'dm me for rates',
      'dm me to discuss your project',
      'our agency offers',
      'i built a tool for',
      'i created an app',
      'looking for beta testers',
      'opening the beta of',
      'fixed prices from $',
      "whether you need a website built from scratch",
      "if you're looking for a reliable freelance",
      "if you&#x27;re looking for a reliable freelance",
    ];

    const hasSelfPromoContent =
      !isModerationMeta &&
      selfPromoContentPhrases.some((phrase) => lower.includes(phrase));

    if (isSelfPromoTitle) flags.push('SELF_PROMO_TITLE_TAG');
    if (hasSelfPromoContent) flags.push('SELF_PROMO_OFFERING_LANGUAGE');

    const isSelfPromo = isSelfPromoTitle || hasSelfPromoContent;

    // 6. Job seeker / employment applicant detection
    const jobSeekerRegexes = [
      /\banyone hiring\b/i,
      /\bwho(?:'s| is) hiring\b/i,
      /\blooking for a (?:[a-z\s\-]+ )?job\b/i,
      /\blooking for (?:full-time|part-time|contract|remote) work\b/i,
      /\blooking for work as a\b/i,
      /\bseeking full-time\b/i,
      /\bseeking internship\b/i,
      /\bseeking employment\b/i,
      /\bhire me as\b/i,
      /\bsubmit a resume\b/i,
      /\bis there anyone out there looking for a (?:software engineer|developer|designer)\b/i,
    ];
    const isJobSeeker =
      !isModerationMeta && jobSeekerRegexes.some((rx) => rx.test(lower));
    if (isJobSeeker) flags.push('JOB_SEEKER_NOT_BUYER');

    // 7. DIY technical question detection (troubleshooting, debugging)
    const diyTechnicalPhrases = [
      'how do i fix',
      'syntax error',
      'hydration error',
      'cannot read properties of undefined',
      'why is my css',
      'how to configure',
      'tutorial on',
      'error code',
      'issue with next.js',
      'problem with tailwind',
      'fixing css bug',
      'flexbox layout is broken',
    ];
    const isDiyTechnical = diyTechnicalPhrases.some((phrase) => lower.includes(phrase));
    if (isDiyTechnical) flags.push('DIY_TROUBLESHOOTING_NO_BUDGET');

    // Risk Level Assignment
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    let challengeReason = 'No obvious self-promotion or conflicting markers detected.';

    if (isDeadOrDeleted) {
      riskLevel = 'HIGH';
      challengeReason = 'Post is marked dead, deleted, or removed by the source platform.';
    } else if (isModerationMeta) {
      riskLevel = 'HIGH';
      challengeReason = 'Post is a forum moderation or rules announcement, not a commercial signal.';
    } else if (isSalesPartnerRecruitment) {
      riskLevel = 'HIGH';
      challengeReason = 'Author is recruiting a commission sales partner or cold caller to pitch their own services, not buying services.';
    } else if (isSelfPromo || isJobSeeker) {
      riskLevel = 'HIGH';
      challengeReason = 'Author is advertising their own services or seeking employment rather than hiring a vendor.';
    } else if (isDiyTechnical) {
      riskLevel = 'HIGH';
      challengeReason = 'Post is a technical troubleshooting request without commercial intent to hire an external service provider.';
    } else if (freshness.isStale) {
      riskLevel = 'MEDIUM';
      challengeReason = `Signal publication timestamp is stale (${freshness.ageDays} days old > ${freshness.maxAgeDays}d policy).`;
    } else if (lower.includes('student') || lower.includes('college club') || lower.includes('homework')) {
      riskLevel = 'MEDIUM';
      challengeReason = 'Academic or non-commercial entity with questionable commercial budget.';
    }

    return {
      isSelfPromo,
      isJobSeeker,
      isSalesPartnerRecruitment,
      isDeadOrDeleted,
      isModerationMeta,
      isStale: freshness.isStale,
      ageDays: freshness.ageDays,
      isSpamOrIrrelevant: isDeadOrDeleted || isModerationMeta,
      riskLevel,
      flags,
      challengeReason,
    };
  }

  // ---------------------------------------------------------------------------
  // Judge 2: Analyst Evaluation
  // ---------------------------------------------------------------------------
  private evaluateAnalyst(
    title: string,
    content: string,
    lower: string,
    rawText: string,
    skeptic: SkepticEvaluation
  ): AnalystEvaluation {
    const evidenceSnippets: string[] = [];
    const lowerTitle = title.toLowerCase();

    // Do not extract false buyer signals from moderation rules or dead posts
    if (skeptic.isDeadOrDeleted || skeptic.isModerationMeta) {
      return {
        candidateCategory: 'IRRELEVANT',
        explicitBuyingSignal: false,
        hasBudget: false,
        urgency: 'NONE',
        evidenceSnippets: [],
        analysisReason: skeptic.isDeadOrDeleted
          ? 'Post is dead or deleted.'
          : 'Post is a forum moderation/rules announcement.',
      };
    }

    // Explicit purchase intent markers (excluding sales partner recruitment)
    const hasHiringTag =
      (lowerTitle.startsWith('[hiring]') ||
        lowerTitle.includes('[hiring]') ||
        lowerTitle.startsWith('[paid]')) &&
      !skeptic.isSalesPartnerRecruitment;

    const explicitPurchasePhrases = [
      'looking to hire',
      'need to hire',
      'want to hire',
      'budget is',
      'budget of',
      'paying $',
      'paid project',
      'will pay',
      'hourly rate $',
      'fixed price budget',
      'fixed price $',
    ];

    let hasExplicitPurchasePhrase = false;
    if (!skeptic.isSalesPartnerRecruitment && !skeptic.isSelfPromo) {
      for (const phrase of explicitPurchasePhrases) {
        const idx = lower.indexOf(phrase);
        if (idx !== -1) {
          evidenceSnippets.push(rawText.substring(idx, Math.min(rawText.length, idx + 40)).trim());
          hasExplicitPurchasePhrase = true;
        }
      }
    }

    if (hasHiringTag) {
      evidenceSnippets.push(title.substring(0, Math.min(title.length, 50)).trim());
    }

    const explicitBuyingSignal = hasHiringTag || hasExplicitPurchasePhrase;

    // Budget detection (only if not self-promo rate card or moderation post)
    let hasBudget = false;
    if (!skeptic.isSelfPromo && !skeptic.isJobSeeker && !skeptic.isSalesPartnerRecruitment) {
      const budgetRegex = /(\$\d{1,3}(?:,\d{3})+|\b(?:budget\s*(?:is|of|:)?\s*[\$]?\d[\d,]*)\b)/i;
      const budgetMatch = budgetRegex.exec(rawText);
      if (budgetMatch) {
        hasBudget = true;
        evidenceSnippets.push(budgetMatch[0].trim());
      }
    }

    // Urgency detection
    let urgency: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' = 'NONE';
    if (
      lower.includes('urgently') ||
      lower.includes('asap') ||
      lower.includes('immediate start') ||
      lower.includes('this week')
    ) {
      urgency = 'HIGH';
    } else if (
      lower.includes('soon') ||
      lower.includes('this month') ||
      lower.includes('next quarter')
    ) {
      urgency = 'MEDIUM';
    }

    // Helper to find and record verbatim phrase match
    const matchAndExtract = (phrases: string[]): string | null => {
      for (const p of phrases) {
        const idx = lower.indexOf(p);
        if (idx !== -1) {
          const snippet = rawText.substring(idx, idx + p.length);
          if (!evidenceSnippets.includes(snippet)) {
            evidenceSnippets.push(snippet);
          }
          return snippet;
        }
      }
      return null;
    };

    // Determine candidate category
    let candidateCategory: IntentCategory = 'IRRELEVANT';
    let analysisReason = 'No commercial or industry-specific signal matched.';

    // 1. Vendor Search
    const vendorSearchPhrases = [
      'recommend an agency',
      'recommend a web agency',
      'looking for an agency',
      'looking for a web design firm',
      'seeking vendor proposals',
      'vendor recommendations',
      'rfp for website',
    ];

    // 2. Website Redesign (guarded against seller conditional pitches like "Whether you need a website built")
    const websiteRedesignPhrases = [
      'website redesign',
      'redesign our website',
      'need our website redesigned',
      'need a website built',
      'rebuild our site',
      'rebuild our website',
      'build a landing page',
    ];
    const hasConditionalSellerPitch =
      lower.includes('whether you need a website') ||
      lower.includes('if you need a website') ||
      lower.includes('what i offer:');

    // 3. Marketing Service Need
    const marketingServicePhrases = [
      'seo agency',
      'marketing firm',
      'ppc agency',
      'need digital marketing',
      'lead generation agency',
    ];

    // 4. Technical Problem (specific coding/debugging issues, no generic isolated "broken")
    const technicalProblemPhrases = [
      'how do i fix',
      'hydration error',
      'syntax error',
      'cannot read properties of undefined',
      'troubleshooting',
      'fixing css bug',
      'css bug',
      'flexbox layout is broken',
      'why is my css',
      'how to configure',
      'help with code',
      'issue with next.js',
      'problem with tailwind',
    ];

    // 5. General Tech / Business Discussion
    const generalDiscussionPhrases = [
      'ask hn:',
      'favorite tech stack',
      'tech stack',
      'backend frameworks',
      'frontend framework',
      'web development',
      'software engineering',
      'wordpress',
      'pagespeed',
      'cloudflare',
      'saas',
      'startup',
    ];

    // 6. Explicit Off-Topic / Irrelevant
    const offTopicPhrases = [
      'hiking trails',
      'camping trip',
      'trail suggestions',
      'cooking recipe',
      'sports scores',
    ];

    if (!skeptic.isSelfPromo && !skeptic.isSalesPartnerRecruitment && matchAndExtract(vendorSearchPhrases)) {
      candidateCategory = 'ACTIVE_VENDOR_SEARCH';
      analysisReason = 'Prospect actively requesting agency/vendor recommendations.';
    } else if (
      !skeptic.isSelfPromo &&
      !skeptic.isSalesPartnerRecruitment &&
      !hasConditionalSellerPitch &&
      matchAndExtract(websiteRedesignPhrases)
    ) {
      // If explicit hiring + explicit budget is present for an agency rebrand, EXPLICIT_PURCHASE_INTENT takes priority when title explicitly requests hiring an agency with budget
      if (hasHiringTag && hasBudget && lower.includes('looking to hire')) {
        candidateCategory = 'EXPLICIT_PURCHASE_INTENT';
        analysisReason = 'Explicit commercial intent to hire an agency with disclosed budget.';
      } else {
        candidateCategory = 'WEBSITE_REDESIGN_NEED';
        analysisReason = 'Prospect seeking web design or website development rebuild.';
      }
    } else if (
      !skeptic.isSelfPromo &&
      !skeptic.isSalesPartnerRecruitment &&
      matchAndExtract(marketingServicePhrases)
    ) {
      candidateCategory = 'MARKETING_SERVICE_NEED';
      analysisReason = 'Prospect requesting digital marketing or SEO agency services.';
    } else if (!skeptic.isSelfPromo && !skeptic.isSalesPartnerRecruitment && explicitBuyingSignal) {
      candidateCategory = 'EXPLICIT_PURCHASE_INTENT';
      analysisReason = 'Explicit commercial intent to buy or hire a provider.';
    } else if (matchAndExtract(technicalProblemPhrases)) {
      candidateCategory = 'TECHNICAL_PROBLEM';
      analysisReason = 'Technical debugging question without commercial purchase indicators.';
    } else if (matchAndExtract(offTopicPhrases)) {
      candidateCategory = 'IRRELEVANT';
      analysisReason = 'Off-topic content unrelated to web design, software, or marketing services.';
    } else if (matchAndExtract(generalDiscussionPhrases)) {
      candidateCategory = 'GENERAL_DISCUSSION';
      analysisReason = 'General tech or business discussion without commercial purchase intent.';
    }

    return {
      candidateCategory,
      explicitBuyingSignal,
      hasBudget,
      urgency,
      evidenceSnippets,
      analysisReason,
    };
  }

  // ---------------------------------------------------------------------------
  // Judge 3: Optimist Evaluation
  // ---------------------------------------------------------------------------
  private evaluateOptimist(
    title: string,
    content: string,
    lower: string,
    skeptic: SkepticEvaluation
  ): OptimistEvaluation {
    if (skeptic.isDeadOrDeleted || skeptic.isModerationMeta || skeptic.isSelfPromo || skeptic.isJobSeeker) {
      return {
        plausibleOpportunity: false,
        opportunityScore: 0.0,
        potentialServices: [],
        upsideRationale: 'No buyer opportunity due to skeptic disqualification.',
      };
    }

    const commercialPainPhrases = [
      'website is not converting',
      'not converting visitors',
      'low conversions',
      'outdated site',
      'slow and outdated',
      'slow website losing customers',
      'struggling to get leads',
      'need more clients for our business',
    ];

    const hasPain = commercialPainPhrases.some((phrase) => lower.includes(phrase));

    if (hasPain) {
      return {
        plausibleOpportunity: true,
        opportunityScore: 0.58,
        potentialServices: ['Website Redesign', 'Conversion Rate Optimization', 'SEO Audit'],
        upsideRationale:
          'Prospect states commercial pain regarding site conversion or lead acquisition that an agency could solve.',
      };
    }

    return {
      plausibleOpportunity: false,
      opportunityScore: 0.10,
      potentialServices: [],
      upsideRationale: 'No clear commercial pain or service opportunity identified.',
    };
  }

  // ---------------------------------------------------------------------------
  // Decision Arbitration Engine
  // ---------------------------------------------------------------------------
  private arbitrate(
    skeptic: SkepticEvaluation,
    analyst: AnalystEvaluation,
    optimist: OptimistEvaluation,
    rawText: string,
    freshness: { isStale: boolean; ageDays: number | null; maxAgeDays: number }
  ): {
    category: IntentCategory;
    confidence: number;
    reviewStatus: ReviewStatus;
    explanation: string;
    reasonCodes: string[];
    candidateSnippets: string[];
  } {
    const reasonCodes: string[] = [];
    const candidateSnippets = [...analyst.evidenceSnippets];

    // Priority 0: Dead or Deleted Post -> Immediate REJECTED
    if (skeptic.isDeadOrDeleted) {
      reasonCodes.push('DEAD_OR_DELETED_POST');
      if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');
      const deadMatch = extractVerbatimContext(rawText, /\[(?:dead|deleted|removed)\]/i, 0);
      if (deadMatch) candidateSnippets.push(deadMatch);

      return {
        category: 'IRRELEVANT',
        confidence: 0.0,
        reviewStatus: 'REJECTED',
        explanation: 'Rejected: Post is flagged as [dead], [deleted], or removed by the source platform.',
        reasonCodes,
        candidateSnippets,
      };
    }

    // Priority 0.5: Forum Moderation / Rules Meta-Post -> IRRELEVANT
    if (skeptic.isModerationMeta) {
      reasonCodes.push('MODERATION_OR_RULES_META_POST');
      if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');
      const modMatch = extractVerbatimContext(
        rawText,
        /(?:minimum karma requirements|rules reminder|immediate permaban|bannable)/i,
        15
      );
      if (modMatch) candidateSnippets.push(modMatch);

      return {
        category: 'IRRELEVANT',
        confidence: 0.85,
        reviewStatus: freshness.isStale ? 'STALE' : 'REJECTED',
        explanation: 'Post is a community moderation or rules announcement, not a commercial lead.',
        reasonCodes,
        candidateSnippets,
      };
    }

    // Priority 1: Contradictory Buyer + Job-Seeker signals -> NEEDS_REVIEW
    if (
      analyst.explicitBuyingSignal &&
      skeptic.isJobSeeker &&
      !skeptic.isSalesPartnerRecruitment
    ) {
      reasonCodes.push('JUDGE_DISAGREEMENT', 'CONTRADICTORY_EVIDENCE', 'AMBIGUOUS_INTENT');
      if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');
      const seekerMatch = extractVerbatimContext(
        rawText,
        /(?:looking for work|looking for a job|seeking internship)/i,
        15
      );
      if (seekerMatch) candidateSnippets.push(seekerMatch);

      return {
        category: 'SELF_PROMOTION',
        confidence: 0.38,
        reviewStatus: 'NEEDS_REVIEW',
        explanation:
          'Contradictory signals: Post contains both hiring tags and job-seeker employment phrases; routed for human review.',
        reasonCodes,
        candidateSnippets,
      };
    }

    // Priority 1.5: Sales-Partner / Cold-Caller Recruitment
    if (skeptic.isSalesPartnerRecruitment) {
      reasonCodes.push('SALES_PARTNER_RECRUITMENT');
      const salesSnippet = extractVerbatimContext(
        rawText,
        /(?:cold caller|sales partner|commission-based partnership|pitch our services)/i,
        15
      );
      if (salesSnippet) candidateSnippets.push(salesSnippet);

      if (skeptic.isSelfPromo) {
        reasonCodes.push('SKEPTIC_FLAG_SELF_PROMOTION', 'FREELANCER_RECRUITING_SALES_REP');
        if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');
        return {
          category: 'SELF_PROMOTION',
          confidence: freshness.isStale ? 0.60 : 0.90,
          reviewStatus: freshness.isStale ? 'STALE' : 'CONFIRMED',
          explanation:
            'Freelancer or service provider recruiting a commission sales partner/cold caller to sell their own services, not a buyer.',
          reasonCodes,
          candidateSnippets,
        };
      }

      reasonCodes.push('AMBIGUOUS_INTENT');
      if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');
      return {
        category: 'GENERAL_DISCUSSION',
        confidence: 0.42,
        reviewStatus: freshness.isStale ? 'STALE' : 'NEEDS_REVIEW',
        explanation:
          'Post seeks a sales partner or cold caller without clear buyer service requirements; routed for review.',
        reasonCodes,
        candidateSnippets,
      };
    }

    // Priority 2: Self-promotion or Job seeker takes precedence over commercial categories
    if (skeptic.isSelfPromo || skeptic.isJobSeeker) {
      reasonCodes.push('SKEPTIC_FLAG_SELF_PROMOTION');
      if (skeptic.isJobSeeker) reasonCodes.push('JOB_SEEKER_NOT_BUYER');
      if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');

      const promoContext = extractVerbatimContext(
        rawText,
        /(?:for hire|offering|hire me|my portfolio|i am a freelance|i'm a freelance|i’m a freelance|i’m a web developer|i'm a solo web developer|show hn:|anyone hiring|looking for a software engineering job)/i,
        15
      );
      if (promoContext) candidateSnippets.push(promoContext);

      return {
        category: 'SELF_PROMOTION',
        confidence: freshness.isStale ? 0.65 : 0.92,
        reviewStatus: freshness.isStale ? 'STALE' : 'CONFIRMED',
        explanation:
          'Post is an advertisement of author services, product launch, or job seeking rather than prospective client demand.',
        reasonCodes,
        candidateSnippets,
      };
    }

    // Priority 3: DIY Technical Troubleshooting
    if (analyst.candidateCategory === 'TECHNICAL_PROBLEM') {
      reasonCodes.push('DIY_TECHNICAL_PROBLEM', 'NO_COMMERCIAL_INTENT');
      if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');
      return {
        category: 'TECHNICAL_PROBLEM',
        confidence: freshness.isStale ? 0.55 : 0.88,
        reviewStatus: freshness.isStale ? 'STALE' : 'CONFIRMED',
        explanation:
          'Post is seeking free technical troubleshooting assistance rather than commercial agency engagement.',
        reasonCodes,
        candidateSnippets,
      };
    }

    // Priority 4: Commercial Candidates
    const isCommercialCandidate = [
      'EXPLICIT_PURCHASE_INTENT',
      'ACTIVE_VENDOR_SEARCH',
      'WEBSITE_REDESIGN_NEED',
      'MARKETING_SERVICE_NEED',
    ].includes(analyst.candidateCategory);

    if (isCommercialCandidate) {
      // Freshness policy guard: Stale signals cannot become confirmed buying opportunities
      if (freshness.isStale) {
        reasonCodes.push('STALE_SIGNAL', 'HISTORICAL_COMMERCIAL_SIGNAL_SUPPRESSED');
        return {
          category: analyst.candidateCategory,
          confidence: 0.38,
          reviewStatus: 'STALE',
          explanation: `Stale commercial signal (${freshness.ageDays} days old > ${freshness.maxAgeDays}d limit): suppressed from active buying opportunities.`,
          reasonCodes,
          candidateSnippets,
        };
      }

      if (skeptic.riskLevel === 'LOW') {
        if (analyst.explicitBuyingSignal) {
          reasonCodes.push('EXPLICIT_BUYING_SIGNAL');
          if (analyst.hasBudget) reasonCodes.push('EXPLICIT_BUDGET_DISCLOSED');
          if (analyst.urgency === 'HIGH') reasonCodes.push('HIGH_URGENCY');

          const confidence = analyst.hasBudget ? 0.94 : 0.86;

          return {
            category: analyst.candidateCategory,
            confidence,
            reviewStatus: 'CONFIRMED',
            explanation: `Verified commercial intent: ${analyst.analysisReason}`,
            reasonCodes,
            candidateSnippets,
          };
        }

        // Low skeptic risk with identified category-specific commercial need
        reasonCodes.push('VERIFIED_COMMERCIAL_NEED');
        return {
          category: analyst.candidateCategory,
          confidence: 0.80,
          reviewStatus: 'CONFIRMED',
          explanation: `Identified commercial need: ${analyst.analysisReason}`,
          reasonCodes,
          candidateSnippets,
        };
      }

      // Medium skeptic risk (e.g., student/college club or low budget)
      if (skeptic.riskLevel === 'MEDIUM') {
        reasonCodes.push('POTENTIAL_COMMERCIAL_INTENT', 'MEDIUM_SKEPTIC_RISK');
        return {
          category: analyst.candidateCategory,
          confidence: 0.64,
          reviewStatus: 'TENTATIVE',
          explanation: `Tentative commercial intent with caveats: ${skeptic.challengeReason}`,
          reasonCodes,
          candidateSnippets,
        };
      }

      // High skeptic risk but commercial candidate: Contradiction!
      if (skeptic.riskLevel === 'HIGH') {
        reasonCodes.push('JUDGE_DISAGREEMENT', 'CONTRADICTORY_EVIDENCE');
        return {
          category: analyst.candidateCategory,
          confidence: 0.42,
          reviewStatus: 'NEEDS_REVIEW',
          explanation: `Contradictory signals: Analyst flagged ${analyst.candidateCategory} but Skeptic challenged: ${skeptic.challengeReason}`,
          reasonCodes,
          candidateSnippets,
        };
      }
    }

    // Priority 5: Inferred commercial opportunity from commercial pain
    if (optimist.plausibleOpportunity) {
      reasonCodes.push('INFERRED_COMMERCIAL_PAIN', 'TENTATIVE_OPPORTUNITY');
      const painSnippet = extractVerbatimContext(
        rawText,
        /(?:website is not converting|not converting visitors|low conversions|outdated site|slow and outdated|struggling to get leads)/i,
        15
      );
      if (painSnippet) candidateSnippets.push(painSnippet);

      if (freshness.isStale) {
        reasonCodes.push('STALE_SIGNAL');
        return {
          category: 'WEBSITE_REDESIGN_NEED',
          confidence: 0.35,
          reviewStatus: 'STALE',
          explanation: `Stale inferred opportunity (${freshness.ageDays}d old): ${optimist.upsideRationale}`,
          reasonCodes,
          candidateSnippets,
        };
      }

      return {
        category: 'WEBSITE_REDESIGN_NEED',
        confidence: 0.55,
        reviewStatus: 'TENTATIVE',
        explanation: `Inferred opportunity: ${optimist.upsideRationale}`,
        reasonCodes,
        candidateSnippets,
      };
    }

    // Priority 6: General Discussion (when positive industry/tech discussion markers exist)
    if (analyst.candidateCategory === 'GENERAL_DISCUSSION') {
      reasonCodes.push('GENERAL_DISCUSSION_NO_PURCHASE_INTENT');
      if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');
      return {
        category: 'GENERAL_DISCUSSION',
        confidence: freshness.isStale ? 0.55 : 0.76,
        reviewStatus: freshness.isStale ? 'STALE' : 'CONFIRMED',
        explanation: 'General tech or business discussion without commercial purchase intent.',
        reasonCodes,
        candidateSnippets,
      };
    }

    // Priority 7: Irrelevant (explicit off-topic or default fallback with low confidence)
    if (candidateSnippets.length > 0) {
      reasonCodes.push('OFF_TOPIC_OR_IRRELEVANT');
      if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');
      return {
        category: 'IRRELEVANT',
        confidence: 0.78,
        reviewStatus: freshness.isStale ? 'STALE' : 'CONFIRMED',
        explanation: 'Off-topic content unrelated to software, web design, or marketing services.',
        reasonCodes,
        candidateSnippets,
      };
    }

    // Default fallback when no category-specific evidence matched at all:
    // Never assign high confidence merely because no keyword matched!
    reasonCodes.push('NO_CATEGORY_EVIDENCE', 'DEFAULT_FALLBACK_LOW_CONFIDENCE');
    if (freshness.isStale) reasonCodes.push('STALE_SIGNAL');
    return {
      category: 'IRRELEVANT',
      confidence: 0.35,
      reviewStatus: freshness.isStale ? 'STALE' : 'NEEDS_REVIEW',
      explanation:
        'Unclassified/irrelevant: No commercial, technical, or industry discussion keywords matched.',
      reasonCodes,
      candidateSnippets: [],
    };
  }
}

export const deterministicClassifier = new DeterministicIntentClassifier();
