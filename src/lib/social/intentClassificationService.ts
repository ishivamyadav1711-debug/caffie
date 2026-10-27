import { prisma } from '@/lib/prisma';
import {
  IntentCategory,
  IntentClassificationResult,
  BatchClassificationReport,
  ReviewStatus,
  ClassifiableSignalInput,
  ClassificationPolicyOptions,
} from './intentTypes';
import { deterministicClassifier, CLASSIFIER_VERSION } from './deterministicClassifier';
import { aiIntentProvider } from './aiIntentProvider';

export interface ClassificationServiceOptions extends ClassificationPolicyOptions {
  forceDeterministic?: boolean;
  classifierVersion?: string;
}

/**
 * LeadPilot Intent Classification Service (Phase 2.1 Hardened)
 * Manages 3-judge intent evaluation, AI orchestration, conservative deterministic fallback,
 * freshness/staleness enforcement, and idempotent PostgreSQL persistence.
 */
export class IntentClassificationService {
  private static instance: IntentClassificationService;

  static getInstance(): IntentClassificationService {
    if (!IntentClassificationService.instance) {
      IntentClassificationService.instance = new IntentClassificationService();
    }
    return IntentClassificationService.instance;
  }

  /**
   * Evaluates a signal using AI (if configured) with immediate deterministic fallback
   * and mandatory classification-layer safeguards (dead/deleted, empty, staleness, evidence).
   * Pure evaluation — does not modify database state.
   */
  async classifySignal(
    signal: ClassifiableSignalInput,
    options: ClassificationServiceOptions = {}
  ): Promise<IntentClassificationResult> {
    const version = options.classifierVersion || CLASSIFIER_VERSION;

    // 1. Run deterministic pre-check for hard disqualifiers (empty, dead/deleted, moderation rules)
    const detResult = deterministicClassifier.classify(signal, options);
    detResult.classifierVersion = version;

    if (
      options.forceDeterministic ||
      detResult.reasonCodes.includes('EMPTY_OR_MALFORMED_CONTENT') ||
      detResult.reasonCodes.includes('DEAD_OR_DELETED_POST') ||
      detResult.reasonCodes.includes('MODERATION_OR_RULES_META_POST')
    ) {
      return detResult;
    }

    // 2. Attempt AI Evaluation (Gemini or OpenAI)
    try {
      const aiResponse = await aiIntentProvider.evaluateWithAi(signal);

      if (aiResponse.success && aiResponse.result) {
        const aiRes = aiResponse.result;
        aiRes.classifierVersion = version;

        // Enforce freshness safeguard on AI output
        if (detResult.skepticEvaluation?.isStale) {
          aiRes.reviewStatus = 'STALE';
          if (!aiRes.reasonCodes.includes('STALE_SIGNAL')) {
            aiRes.reasonCodes.push('STALE_SIGNAL');
          }
          const isCommercial = [
            'EXPLICIT_PURCHASE_INTENT',
            'ACTIVE_VENDOR_SEARCH',
            'WEBSITE_REDESIGN_NEED',
            'MARKETING_SERVICE_NEED',
          ].includes(aiRes.primaryCategory);
          if (isCommercial) {
            aiRes.confidenceScore = Math.min(aiRes.confidenceScore, 0.38);
            if (!aiRes.reasonCodes.includes('HISTORICAL_COMMERCIAL_SIGNAL_SUPPRESSED')) {
              aiRes.reasonCodes.push('HISTORICAL_COMMERCIAL_SIGNAL_SUPPRESSED');
            }
          }
        }

        return aiRes;
      }
    } catch {
      // Ignore AI exception and fall back seamlessly to deterministic result
    }

    // 3. Conservative Deterministic Fallback
    detResult.evaluationStrategy = 'deterministic_fallback';
    if (!detResult.reasonCodes.includes('CONSERVATIVE_DETERMINISTIC_FALLBACK')) {
      detResult.reasonCodes.push('CONSERVATIVE_DETERMINISTIC_FALLBACK');
    }

    return detResult;
  }

  /**
   * Evaluates and stores the classification for an existing SocialSignal record in DB.
   * Idempotent: upserts on unique compound key (signalId, classifierVersion).
   * Does NOT modify or overwrite raw source content or original timestamps.
   */
  async classifyAndStoreSignal(
    signalId: string,
    options: ClassificationServiceOptions = {}
  ): Promise<{ success: boolean; classification?: IntentClassificationResult; error?: string }> {
    try {
      const signalRecord = await (prisma as any).socialSignal.findUnique({
        where: { id: signalId },
      });

      if (!signalRecord) {
        return { success: false, error: `SocialSignal with id ${signalId} not found.` };
      }

      const classification = await this.classifySignal(
        {
          id: signalRecord.id,
          title: signalRecord.title,
          contentText: signalRecord.contentText,
          sourcePlatform: signalRecord.sourcePlatform,
          publicationTimestamp: signalRecord.publicationTimestamp,
          metadata: signalRecord.metadata,
        },
        options
      );

      const version = options.classifierVersion || CLASSIFIER_VERSION;

      // Idempotent upsert by composite key
      await (prisma as any).socialSignalClassification.upsert({
        where: {
          signalId_classifierVersion: {
            signalId,
            classifierVersion: version,
          },
        },
        update: {
          primaryCategory: classification.primaryCategory,
          confidenceScore: classification.confidenceScore,
          reviewStatus: classification.reviewStatus,
          evidenceSnippets: classification.evidenceSnippets,
          explanation: classification.explanation,
          reasonCodes: classification.reasonCodes,
          skepticEvaluation: classification.skepticEvaluation || undefined,
          analystEvaluation: classification.analystEvaluation || undefined,
          optimistEvaluation: classification.optimistEvaluation || undefined,
          evaluationStrategy: classification.evaluationStrategy,
          providerModel: classification.providerModel,
          processingDurationMs: classification.processingDurationMs,
          classifiedAt: new Date(classification.classifiedAt),
        },
        create: {
          signalId,
          classifierVersion: version,
          primaryCategory: classification.primaryCategory,
          confidenceScore: classification.confidenceScore,
          reviewStatus: classification.reviewStatus,
          evidenceSnippets: classification.evidenceSnippets,
          explanation: classification.explanation,
          reasonCodes: classification.reasonCodes,
          skepticEvaluation: classification.skepticEvaluation || undefined,
          analystEvaluation: classification.analystEvaluation || undefined,
          optimistEvaluation: classification.optimistEvaluation || undefined,
          evaluationStrategy: classification.evaluationStrategy,
          providerModel: classification.providerModel,
          processingDurationMs: classification.processingDurationMs,
          classifiedAt: new Date(classification.classifiedAt),
        },
      });

      return { success: true, classification };
    } catch (err: any) {
      return {
        success: false,
        error: `Database persistence error during classification: ${err.message}`,
      };
    }
  }

  /**
   * Batch classifies signals in the database.
   * Safe execution with bounded limits and full observability of errors.
   */
  async batchClassifySignals(
    options: {
      limit?: number;
      reclassifyAll?: boolean;
      forceDeterministic?: boolean;
      maxAgeDays?: number;
      classifierVersion?: string;
    } = {}
  ): Promise<BatchClassificationReport> {
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const version = options.classifierVersion || CLASSIFIER_VERSION;

    const categoryBreakdown: Record<IntentCategory, number> = {
      EXPLICIT_PURCHASE_INTENT: 0,
      ACTIVE_VENDOR_SEARCH: 0,
      WEBSITE_REDESIGN_NEED: 0,
      MARKETING_SERVICE_NEED: 0,
      TECHNICAL_PROBLEM: 0,
      GENERAL_DISCUSSION: 0,
      SELF_PROMOTION: 0,
      IRRELEVANT: 0,
    };

    const reviewStatusBreakdown: Record<ReviewStatus, number> = {
      CONFIRMED: 0,
      TENTATIVE: 0,
      NEEDS_REVIEW: 0,
      REJECTED: 0,
      STALE: 0,
    };

    // Query unclassified records unless reclassifyAll is requested
    const whereClause = options.reclassifyAll
      ? {}
      : {
          classifications: {
            none: {
              classifierVersion: version,
            },
          },
        };

    const targetSignals = await (prisma as any).socialSignal.findMany({
      where: whereClause,
      take: limit,
      orderBy: { publicationTimestamp: 'desc' },
      include: {
        classifications: {
          where: { classifierVersion: version },
        },
      },
    });

    const diagnostics: BatchClassificationReport['diagnostics'] = [];
    let classifiedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const signal of targetSignals) {
      if (!options.reclassifyAll && signal.classifications?.length > 0) {
        skippedCount++;
        diagnostics.push({ signalId: signal.id, status: 'SKIPPED' });
        continue;
      }

      const res = await this.classifyAndStoreSignal(signal.id, {
        forceDeterministic: options.forceDeterministic,
        maxAgeDays: options.maxAgeDays,
        classifierVersion: version,
      });

      if (res.success && res.classification) {
        classifiedCount++;
        categoryBreakdown[res.classification.primaryCategory]++;
        reviewStatusBreakdown[res.classification.reviewStatus]++;
        diagnostics.push({
          signalId: signal.id,
          status: 'SUCCESS',
          category: res.classification.primaryCategory,
          reviewStatus: res.classification.reviewStatus,
        });
      } else {
        errorCount++;
        diagnostics.push({
          signalId: signal.id,
          status: 'ERROR',
          error: res.error,
        });
      }
    }

    return {
      timestamp: new Date().toISOString(),
      totalEvaluated: targetSignals.length,
      classified: classifiedCount,
      skippedAlreadyClassified: skippedCount,
      errors: errorCount,
      categoryBreakdown,
      reviewStatusBreakdown,
      diagnostics,
    };
  }

  /**
   * Retrieves stored classifications for a given signal.
   */
  async getStoredClassifications(signalId: string) {
    return (prisma as any).socialSignalClassification.findMany({
      where: { signalId },
      orderBy: { classifiedAt: 'desc' },
    });
  }
}

export const intentClassificationService = IntentClassificationService.getInstance();
