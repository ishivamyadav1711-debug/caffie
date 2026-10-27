import {
  IntentCategory,
  IntentClassificationResult,
  SkepticEvaluation,
  AnalystEvaluation,
  OptimistEvaluation,
  INTENT_CATEGORIES,
  ClassifiableSignalInput,
} from './intentTypes';
import { validateVerbatimSnippets } from './evidenceValidator';
import { CLASSIFIER_VERSION } from './deterministicClassifier';

export interface AiClassificationResponse {
  success: boolean;
  result?: IntentClassificationResult;
  error?: string;
  providerModel?: string;
}

/**
 * AI Intent Evaluation Provider
 * Uses direct standard REST APIs (Gemini or OpenAI) with single-call 3-judge evaluation.
 * Performs post-generation verbatim evidence validation to prevent AI hallucinations.
 */
export class AiIntentProvider {
  /**
   * Evaluates a social signal using configured AI provider (Gemini or OpenAI).
   * Returns success: false if no provider is configured, or on network/parsing failure.
   */
  async evaluateWithAi(signal: ClassifiableSignalInput): Promise<AiClassificationResponse> {
    const startTime = Date.now();
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!geminiKey && !openaiKey) {
      return {
        success: false,
        error: 'No AI provider API key configured (GEMINI_API_KEY or OPENAI_API_KEY missing).',
      };
    }

    const fullText = `${signal.title || ''}\n${signal.contentText || ''}`.trim();

    try {
      if (geminiKey) {
        return await this.callGemini(signal, fullText, geminiKey, startTime);
      } else {
        return await this.callOpenAi(signal, fullText, openaiKey!, startTime);
      }
    } catch (err: any) {
      return {
        success: false,
        error: `AI provider execution failed: ${err.message || 'Unknown error'}`,
      };
    }
  }

  private async callGemini(
    signal: ClassifiableSignalInput,
    fullText: string,
    apiKey: string,
    startTime: number
  ): Promise<AiClassificationResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const prompt = this.buildThreeJudgePrompt(signal.title, signal.contentText, signal.sourcePlatform);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return {
        success: false,
        error: `Gemini API returned HTTP ${res.status}: ${res.statusText}`,
        providerModel: 'gemini-1.5-flash',
      };
    }

    const data = await res.json();
    const rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawContent) {
      return {
        success: false,
        error: 'Gemini returned empty candidate content.',
        providerModel: 'gemini-1.5-flash',
      };
    }

    return this.parseAndValidateAiOutput(
      rawContent,
      fullText,
      signal.id,
      'gemini-1.5-flash',
      startTime
    );
  }

  private async callOpenAi(
    signal: ClassifiableSignalInput,
    fullText: string,
    apiKey: string,
    startTime: number
  ): Promise<AiClassificationResponse> {
    const url = 'https://api.openai.com/v1/chat/completions';
    const prompt = this.buildThreeJudgePrompt(signal.title, signal.contentText, signal.sourcePlatform);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return {
        success: false,
        error: `OpenAI API returned HTTP ${res.status}: ${res.statusText}`,
        providerModel: 'gpt-4o-mini',
      };
    }

    const data = await res.json();
    const rawContent = data?.choices?.[0]?.message?.content;

    if (!rawContent) {
      return {
        success: false,
        error: 'OpenAI returned empty message content.',
        providerModel: 'gpt-4o-mini',
      };
    }

    return this.parseAndValidateAiOutput(
      rawContent,
      fullText,
      signal.id,
      'gpt-4o-mini',
      startTime
    );
  }

  private parseAndValidateAiOutput(
    rawJson: string,
    fullText: string,
    signalId: string | undefined,
    modelName: string,
    startTime: number
  ): AiClassificationResponse {
    try {
      const parsed = JSON.parse(rawJson);

      let primaryCategory: IntentCategory = 'IRRELEVANT';
      if (INTENT_CATEGORIES.includes(parsed.primaryCategory)) {
        primaryCategory = parsed.primaryCategory;
      }

      // Validate verbatim evidence snippets (Zero-fabrication guarantee)
      const rawSnippets = Array.isArray(parsed.evidenceSnippets) ? parsed.evidenceSnippets : [];
      const verifiedSnippets = validateVerbatimSnippets(fullText, rawSnippets);

      // Calibrate confidence score (heuristic, never presented as calibrated probability)
      let confidence = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.4;
      confidence = Math.max(0.0, Math.min(1.0, confidence));

      let reviewStatus = ['CONFIRMED', 'TENTATIVE', 'NEEDS_REVIEW', 'REJECTED', 'STALE'].includes(
        parsed.reviewStatus
      )
        ? parsed.reviewStatus
        : 'NEEDS_REVIEW';

      const reasonCodes: string[] = Array.isArray(parsed.reasonCodes)
        ? [...parsed.reasonCodes]
        : ['AI_CLASSIFIED'];

      // Commercial categories must have verbatim evidence
      const isCommercial = [
        'EXPLICIT_PURCHASE_INTENT',
        'ACTIVE_VENDOR_SEARCH',
        'WEBSITE_REDESIGN_NEED',
        'MARKETING_SERVICE_NEED',
      ].includes(primaryCategory);

      if (isCommercial && verifiedSnippets.length === 0) {
        confidence = Math.min(confidence, 0.40);
        if (reviewStatus === 'CONFIRMED') {
          reviewStatus = 'NEEDS_REVIEW';
        }
        if (!reasonCodes.includes('MISSING_CATEGORY_EVIDENCE')) {
          reasonCodes.push('MISSING_CATEGORY_EVIDENCE');
        }
      }

      const skeptic: SkepticEvaluation = {
        isSelfPromo: Boolean(parsed.skepticEvaluation?.isSelfPromo),
        isJobSeeker: Boolean(parsed.skepticEvaluation?.isJobSeeker),
        isSpamOrIrrelevant: Boolean(parsed.skepticEvaluation?.isSpamOrIrrelevant),
        riskLevel: ['LOW', 'MEDIUM', 'HIGH'].includes(parsed.skepticEvaluation?.riskLevel)
          ? parsed.skepticEvaluation.riskLevel
          : 'LOW',
        flags: Array.isArray(parsed.skepticEvaluation?.flags) ? parsed.skepticEvaluation.flags : [],
        challengeReason: String(parsed.skepticEvaluation?.challengeReason || 'Skeptic review complete'),
      };

      const analyst: AnalystEvaluation = {
        candidateCategory: primaryCategory,
        explicitBuyingSignal: Boolean(parsed.analystEvaluation?.explicitBuyingSignal),
        hasBudget: Boolean(parsed.analystEvaluation?.hasBudget),
        urgency: ['NONE', 'LOW', 'MEDIUM', 'HIGH'].includes(parsed.analystEvaluation?.urgency)
          ? parsed.analystEvaluation.urgency
          : 'NONE',
        evidenceSnippets: verifiedSnippets,
        analysisReason: String(parsed.analystEvaluation?.analysisReason || 'Analyst review complete'),
      };

      const optimist: OptimistEvaluation = {
        plausibleOpportunity: Boolean(parsed.optimistEvaluation?.plausibleOpportunity),
        opportunityScore: typeof parsed.optimistEvaluation?.opportunityScore === 'number'
          ? Math.max(0, Math.min(1, parsed.optimistEvaluation.opportunityScore))
          : 0.3,
        potentialServices: Array.isArray(parsed.optimistEvaluation?.potentialServices)
          ? parsed.optimistEvaluation.potentialServices
          : [],
        upsideRationale: String(parsed.optimistEvaluation?.upsideRationale || ''),
      };

      const result: IntentClassificationResult = {
        signalId,
        classifierVersion: CLASSIFIER_VERSION,
        primaryCategory,
        confidenceScore: Number(confidence.toFixed(2)),
        scoreType: 'heuristic',
        reviewStatus,
        evidenceSnippets: verifiedSnippets,
        explanation: String(parsed.explanation || 'AI 3-judge intent classification.'),
        reasonCodes,
        skepticEvaluation: skeptic,
        analystEvaluation: analyst,
        optimistEvaluation: optimist,
        evaluationStrategy: 'three_judge_llm',
        providerModel: modelName,
        processingDurationMs: Date.now() - startTime,
        classifiedAt: new Date().toISOString(),
      };

      return {
        success: true,
        result,
        providerModel: modelName,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to parse AI output JSON: ${err.message}`,
        providerModel: modelName,
      };
    }
  }

  private buildThreeJudgePrompt(
    title: string,
    content: string,
    platform = 'unknown'
  ): string {
    return `
You are the LeadPilot Three-Judge Social Intent Evaluation Engine.
Your task is to classify social posts strictly based on evidence of commercial buying intent for web design, development, marketing, or agency services.

Taxonomy (Choose exactly ONE for primaryCategory):
- EXPLICIT_PURCHASE_INTENT: Prospect explicitly wants to hire/pay/buy a service or software.
- ACTIVE_VENDOR_SEARCH: Prospect is actively seeking agency/vendor recommendations or proposals.
- WEBSITE_REDESIGN_NEED: Prospect needs their website redesigned, rebuilt, or newly created.
- MARKETING_SERVICE_NEED: Prospect needs SEO, digital marketing, or lead generation agency.
- TECHNICAL_PROBLEM: Free troubleshooting or coding bug question without commercial intent to hire.
- GENERAL_DISCUSSION: General industry discussion, tech comparison, or opinion query.
- SELF_PROMOTION: Author is advertising their OWN services, portfolio, agency, recruiting a commission sales partner, or looking for a job.
- IRRELEVANT: Unrelated to web agencies, marketing, software, forum moderation rules, or dead/deleted posts.

RULES:
1. SKEPTIC: Challenge assumptions. If author offers services ("I can build", "for hire", portfolio link, recruiting cold callers/sales partners), mark as SELF_PROMOTION. If asking free DIY code help, mark as TECHNICAL_PROBLEM.
2. ANALYST: Look for explicit hiring verbs, budget numbers, and verbatim quotes.
3. OPTIMIST: Identify commercial pain (e.g. low conversions), but keep inferred opportunities TENTATIVE (confidence <= 0.65).
4. EVIDENCE: Every evidence snippet MUST be an EXACT, literal substring from the source post text. NEVER invent quotes.
5. If judges disagree, set reviewStatus to "NEEDS_REVIEW" and reduce confidenceScore.

SOURCE POST (${platform}):
Title: ${title}
Content: ${content}

Respond ONLY with a valid JSON object matching this schema:
{
  "primaryCategory": "EXPLICIT_PURCHASE_INTENT" | "ACTIVE_VENDOR_SEARCH" | "WEBSITE_REDESIGN_NEED" | "MARKETING_SERVICE_NEED" | "TECHNICAL_PROBLEM" | "GENERAL_DISCUSSION" | "SELF_PROMOTION" | "IRRELEVANT",
  "confidenceScore": number (0.0 to 1.0),
  "reviewStatus": "CONFIRMED" | "TENTATIVE" | "NEEDS_REVIEW" | "REJECTED" | "STALE",
  "evidenceSnippets": string[] (exact verbatim substrings from the post text),
  "explanation": string,
  "reasonCodes": string[],
  "skepticEvaluation": {
    "isSelfPromo": boolean,
    "isJobSeeker": boolean,
    "isSpamOrIrrelevant": boolean,
    "riskLevel": "LOW" | "MEDIUM" | "HIGH",
    "flags": string[],
    "challengeReason": string
  },
  "analystEvaluation": {
    "explicitBuyingSignal": boolean,
    "hasBudget": boolean,
    "urgency": "NONE" | "LOW" | "MEDIUM" | "HIGH",
    "analysisReason": string
  },
  "optimistEvaluation": {
    "plausibleOpportunity": boolean,
    "opportunityScore": number,
    "potentialServices": string[],
    "upsideRationale": string
  }
}
`.trim();
  }
}

export const aiIntentProvider = new AiIntentProvider();
