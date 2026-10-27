/**
 * SignalPipe-Adapted Buying-Intent Intelligence Engine
 * 
 * Implements evidence-grounded intent scoring, anchor classification,
 * hard-floor competitor switch detection, negative signal filtering
 * (distinguishing buyers from sellers, self-promo, job seekers, and spam),
 * and a Three-Judge Panel (Skeptic, Analyst, Optimist) for borderline signals.
 * 
 * Based on SignalPipe (MIT License) architecture adapted for Caffie / LeadPilot.
 */

import { LLMProviderFactory, LLMProvider } from './llmProvider';

export type IntentCategory =
  | 'EXPLICIT_BUY_SIGNAL'
  | 'RECOMMENDATION_REQUEST'
  | 'VENDOR_DISSATISFACTION'
  | 'COMPETITOR_SWITCH'
  | 'URGENT_PROBLEM'
  | 'PROJECT_REQUIREMENT'
  | 'SELLER_PROMOTION'
  | 'JOB_SEEKER'
  | 'SPAM_NOISE'
  | 'GENERAL_DISCUSSION'
  | 'AMBIGUOUS_BORDERLINE';

export type RecommendedAction =
  | 'OUTREACH'
  | 'NURTURE'
  | 'DISMISS'
  | 'HUMAN_REVIEW';

export interface JudgeVote {
  judge: 'Skeptic' | 'Analyst' | 'Optimist';
  score: number;
  verdict: 'QUALIFIED' | 'DISQUALIFIED' | 'BORDERLINE';
  reason: string;
  flaggedSignals: string[];
}

export interface IntentClassificationResult {
  score: number;                     // 0 - 100
  intentCategory: IntentCategory;
  isBuyer: boolean;
  confidence: number;                // 0.0 - 1.0
  reason: string;
  evidenceSnippet?: string;
  competitorMentioned?: string | null;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedAction: RecommendedAction;
  scoringMethod: 'DETERMINISTIC_RULES' | 'SINGLE_JUDGE_AI' | 'THREE_JUDGE_PANEL';
  judgesBreakdown?: {
    skeptic?: JudgeVote;
    analyst?: JudgeVote;
    optimist?: JudgeVote;
  };
}

export interface IntentEvaluationInput {
  title: string;
  content: string;
  author?: string | null;
  platform?: string;
  icpDescription?: string;           // Optional ICP context (e.g. "B2B SaaS, CRM, marketing")
  competitorNames?: string[];        // e.g. ["Salesforce", "HubSpot", "Pipedrive"]
}

// Common anchor lists for deterministic pre-filtering
const SELLER_PROMO_PATTERNS = [
  /\b(?:i(?:'ve|\s+have)?\s+built|we(?:'ve|\s+have)?\s+launched|check\s+out\s+my|introducing\s+my|my\s+side\s+project|our\s+new\s+tool|we\s+are\s+offering|free\s+trial\s+at\s+https?:\/\/)\b/i,
  /\b(?:use\s+code\s+[A-Z0-9]+|affiliate\s+link|discount\s+code|promo\s+code)\b/i,
  /\b(?:show\s+hn:\s+|\[show\s+reddit\]|launching\s+today\s+on\s+product\s+hunt)\b/i,
];

const JOB_SEEKER_PATTERNS = [
  /\b(?:hire\s+me|looking\s+for\s+(?:a\s+)?job|seeking\s+employment|open\s+to\s+work|my\s+resume|portfolio\s+review|internship\s+opportunity)\b/i,
  /\b(?:junior\s+dev\s+seeking|graduating\s+soon\s+and\s+looking)\b/i,
];

const COMPETITOR_SWITCH_PATTERNS = [
  /\b(?:switch(?:ing)?\s+from|replac(?:e|ing)|ditch(?:ing)?|leaving|migrat(?:e|ing)\s+from|alternative\s+to|fed\s+up\s+with|tired\s+of|cancelling|too\s+expensive\s+so\s+moving\s+away)\b/i,
];

const BUY_INTENT_PATTERNS = [
  /\b(?:looking\s+for|recommend(?:ations?)?|need\s+a(?:n)?|what\s+(?:software|tool|crm|platform|service)\s+do\s+you|anyone\s+know\s+a\s+good|where\s+to\s+buy|willing\s+to\s+pay|our\s+budget\s+is|hiring\s+an\s+agency\s+for)\b/i,
  /\b(?:rfp|request\s+for\s+proposal|looking\s+to\s+procure|seeking\s+vendor|enterprise\s+quote)\b/i,
];

/**
 * Fast deterministic pre-filter for obvious non-buyers and obvious spam.
 */
function fastDeterministicCheck(title: string, text: string): IntentClassificationResult | null {
  const combined = `${title} \n ${text}`;

  // 1. Detect clear-cut Seller Promotion
  for (const pattern of SELLER_PROMO_PATTERNS) {
    const match = combined.match(pattern);
    if (match) {
      return {
        score: 12,
        intentCategory: 'SELLER_PROMOTION',
        isBuyer: false,
        confidence: 0.95,
        reason: `Disqualified as vendor self-promotion or project showcase (matched phrase: "${match[0]}").`,
        evidenceSnippet: match[0],
        competitorMentioned: null,
        urgency: 'LOW',
        recommendedAction: 'DISMISS',
        scoringMethod: 'DETERMINISTIC_RULES',
      };
    }
  }

  // 2. Detect clear-cut Job Seeker
  for (const pattern of JOB_SEEKER_PATTERNS) {
    const match = combined.match(pattern);
    if (match) {
      return {
        score: 10,
        intentCategory: 'JOB_SEEKER',
        isBuyer: false,
        confidence: 0.92,
        reason: `Disqualified as job seeker or employment inquiry (matched phrase: "${match[0]}").`,
        evidenceSnippet: match[0],
        competitorMentioned: null,
        urgency: 'LOW',
        recommendedAction: 'DISMISS',
        scoringMethod: 'DETERMINISTIC_RULES',
      };
    }
  }

  return null;
}

/**
 * Single-Judge AI evaluation (Primary fast pass).
 */
async function runSingleJudgeAI(
  llm: LLMProvider,
  input: IntentEvaluationInput
): Promise<IntentClassificationResult> {
  const systemInstruction = `You are an elite B2B buying-intent analyst for an AI sales agent (SignalPipe architecture).
Your task is to analyze social/web posts and determine with extreme precision whether the author is an ACTIVE BUYER seeking a commercial software/service solution.

CRITICAL RULES:
1. Distinguish real BUYERS from sellers, competitors, affiliate promoters, and job seekers.
2. If the author is showcasing their own tool or asking for feedback on their product, score MUST be < 25 (Category: SELLER_PROMOTION).
3. If the author is seeking employment, score MUST be < 20 (Category: JOB_SEEKER).
4. If the author is actively asking to switch from a competitor, score MUST be >= 80 (Category: COMPETITOR_SWITCH).
5. Output valid JSON adhering strictly to the schema.`;

  const prompt = `Analyze this post for B2B commercial buying intent:
Platform: ${input.platform || 'Public Social Platform'}
Author: ${input.author || 'Anonymous'}
Title: ${input.title}
Post Content:
"""
${input.content.slice(0, 1500)}
"""

Target Product / ICP Context: ${input.icpDescription || 'B2B Software, CRM, Automation, Development, or Digital Services'}
Known Competitors: ${(input.competitorNames || ['Salesforce', 'HubSpot', 'Zoho', 'Pipedrive', 'Notion']).join(', ')}

Return JSON strictly formatted as:
{
  "score": <integer 0-100>,
  "intentCategory": "<EXPLICIT_BUY_SIGNAL | RECOMMENDATION_REQUEST | VENDOR_DISSATISFACTION | COMPETITOR_SWITCH | URGENT_PROBLEM | PROJECT_REQUIREMENT | SELLER_PROMOTION | JOB_SEEKER | SPAM_NOISE | GENERAL_DISCUSSION | AMBIGUOUS_BORDERLINE>",
  "isBuyer": <boolean>,
  "confidence": <float 0.0-1.0>,
  "reason": "<precise 1-line justification of intent>",
  "evidenceSnippet": "<exact excerpt from post demonstrating intent>",
  "competitorMentioned": <string or null>,
  "urgency": "<HIGH | MEDIUM | LOW>",
  "recommendedAction": "<OUTREACH | NURTURE | DISMISS | HUMAN_REVIEW>"
}`;

  const res = await llm.generateText(prompt, systemInstruction, {
    jsonMode: true,
    maxTokens: 500,
    temperature: 0.1,
  });

  let raw = res.text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) raw = jsonMatch[0];

  const parsed = JSON.parse(raw);

  // Apply SignalPipe Hard-Floor Guarantee for Competitor Switch
  let finalScore = Math.min(100, Math.max(0, Number(parsed.score) || 50));
  let intentCategory: IntentCategory = parsed.intentCategory || 'GENERAL_DISCUSSION';

  if (intentCategory === 'COMPETITOR_SWITCH' && finalScore < 80) {
    finalScore = 80;
  }

  return {
    score: finalScore,
    intentCategory,
    isBuyer: Boolean(parsed.isBuyer ?? (finalScore >= 65)),
    confidence: Math.min(1.0, Math.max(0.1, Number(parsed.confidence) || 0.8)),
    reason: String(parsed.reason || 'AI scored intent based on purchase anchors.').trim(),
    evidenceSnippet: parsed.evidenceSnippet ? String(parsed.evidenceSnippet).trim() : undefined,
    competitorMentioned: parsed.competitorMentioned || null,
    urgency: (['HIGH', 'MEDIUM', 'LOW'].includes(parsed.urgency) ? parsed.urgency : 'MEDIUM') as any,
    recommendedAction: (['OUTREACH', 'NURTURE', 'DISMISS', 'HUMAN_REVIEW'].includes(parsed.recommendedAction)
      ? parsed.recommendedAction
      : finalScore >= 75 ? 'OUTREACH' : finalScore >= 50 ? 'HUMAN_REVIEW' : 'DISMISS') as any,
    scoringMethod: 'SINGLE_JUDGE_AI',
  };
}

/**
 * Three-Judge Panel evaluation (SignalPipe pattern) for borderline or ambiguous signals (score 40-75%).
 * Panel composed of:
 * - Skeptic: Looks for deceptive self-promo, budget lack, vendor spam, student questions.
 * - Analyst: Evaluates concrete business problem, ICP fit, technical requirements.
 * - Optimist: Identifies expansion signals, tool replacement opportunities, commercial interest.
 */
async function runThreeJudgePanelAI(
  llm: LLMProvider,
  input: IntentEvaluationInput,
  preliminary: IntentClassificationResult
): Promise<IntentClassificationResult> {
  const panelPrompt = `You are arbitrating a B2B buying-intent signal as a THREE-JUDGE PANEL (SignalPipe architecture):

1. Skeptic: Highly critical, assumes post is vendor self-promo, a casual hobbyist, job seeker, or irrelevant noise unless strict proof of a commercial buyer exists.
2. Analyst: Evaluates concrete technical requirements, stated problem, commercial feasibility, and budget.
3. Optimist: Evaluates long-term commercial upside, competitor dissatisfaction, and tool adoption urgency.

Post Under Review:
Title: "${input.title}"
Content: "${input.content.slice(0, 1000)}"

Return JSON with all three judges' independent verdicts:
{
  "skeptic": {
    "score": <0-100>,
    "verdict": "<QUALIFIED | DISQUALIFIED | BORDERLINE>",
    "reason": "<skeptic critique>",
    "flaggedSignals": ["<reasons for skepticism>"]
  },
  "analyst": {
    "score": <0-100>,
    "verdict": "<QUALIFIED | DISQUALIFIED | BORDERLINE>",
    "reason": "<analyst assessment of requirement>",
    "flaggedSignals": ["<key commercial requirements>"]
  },
  "optimist": {
    "score": <0-100>,
    "verdict": "<QUALIFIED | DISQUALIFIED | BORDERLINE>",
    "reason": "<optimist potential summary>",
    "flaggedSignals": ["<growth/opportunity signals>"]
  },
  "consensusScore": <0-100>,
  "consensusCategory": "<EXPLICIT_BUY_SIGNAL | RECOMMENDATION_REQUEST | VENDOR_DISSATISFACTION | COMPETITOR_SWITCH | URGENT_PROBLEM | SELLER_PROMOTION | JOB_SEEKER | SPAM_NOISE | GENERAL_DISCUSSION>",
  "consensusReason": "<final synthesized verdict>",
  "evidenceSnippet": "<exact excerpt demonstrating intent>"
}`;

  try {
    const res = await llm.generateText(panelPrompt, 'Always output valid JSON strictly adhering to schema.', {
      jsonMode: true,
      maxTokens: 800,
      temperature: 0.2,
    });

    let raw = res.text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) raw = jsonMatch[0];
    const parsed = JSON.parse(raw);

    const skepticVote: JudgeVote = {
      judge: 'Skeptic',
      score: Number(parsed.skeptic?.score) || 30,
      verdict: parsed.skeptic?.verdict || 'BORDERLINE',
      reason: parsed.skeptic?.reason || 'Identified potential risks.',
      flaggedSignals: Array.isArray(parsed.skeptic?.flaggedSignals) ? parsed.skeptic.flaggedSignals : [],
    };

    const analystVote: JudgeVote = {
      judge: 'Analyst',
      score: Number(parsed.analyst?.score) || preliminary.score,
      verdict: parsed.analyst?.verdict || 'BORDERLINE',
      reason: parsed.analyst?.reason || 'Evaluated commercial requirements.',
      flaggedSignals: Array.isArray(parsed.analyst?.flaggedSignals) ? parsed.analyst.flaggedSignals : [],
    };

    const optimistVote: JudgeVote = {
      judge: 'Optimist',
      score: Number(parsed.optimist?.score) || 70,
      verdict: parsed.optimist?.verdict || 'QUALIFIED',
      reason: parsed.optimist?.reason || 'Identified conversion opportunities.',
      flaggedSignals: Array.isArray(parsed.optimist?.flaggedSignals) ? parsed.optimist.flaggedSignals : [],
    };

    // Synthesize weighted consensus
    // If Skeptic flags strong negative signals (e.g. self-promo), apply 40% Skeptic weight
    let weightedScore: number;
    if (skepticVote.verdict === 'DISQUALIFIED') {
      weightedScore = Math.round(skepticVote.score * 0.5 + analystVote.score * 0.3 + optimistVote.score * 0.2);
    } else {
      weightedScore = Math.round(analystVote.score * 0.45 + optimistVote.score * 0.35 + skepticVote.score * 0.2);
    }

    // Hard-floor competitor switch
    const consensusCategory = parsed.consensusCategory || preliminary.intentCategory;
    if (consensusCategory === 'COMPETITOR_SWITCH' && weightedScore < 80) {
      weightedScore = 80;
    }

    const isQualified = weightedScore >= 65;

    return {
      score: weightedScore,
      intentCategory: consensusCategory,
      isBuyer: isQualified,
      confidence: 0.88,
      reason: parsed.consensusReason || `Three-Judge consensus: Analyst (${analystVote.score}), Optimist (${optimistVote.score}), Skeptic (${skepticVote.score}).`,
      evidenceSnippet: parsed.evidenceSnippet || preliminary.evidenceSnippet,
      competitorMentioned: preliminary.competitorMentioned,
      urgency: weightedScore >= 80 ? 'HIGH' : weightedScore >= 60 ? 'MEDIUM' : 'LOW',
      recommendedAction: weightedScore >= 75 ? 'OUTREACH' : weightedScore >= 55 ? 'HUMAN_REVIEW' : 'DISMISS',
      scoringMethod: 'THREE_JUDGE_PANEL',
      judgesBreakdown: {
        skeptic: skepticVote,
        analyst: analystVote,
        optimist: optimistVote,
      },
    };
  } catch (err: any) {
    console.warn(`[Three-Judge Panel Notice]: ${err.message}. Preserving single-judge score.`);
    return preliminary;
  }
}

/**
 * Main Entry Point: Evaluates social signal buying intent with multi-tier intelligence.
 */
export async function classifySignalIntent(
  input: IntentEvaluationInput
): Promise<IntentClassificationResult> {
  const { title, content } = input;

  // 1. Fast Deterministic Pre-Filter (No API cost for obvious promo/spam/job seekers)
  const preFilter = fastDeterministicCheck(title, content);
  if (preFilter) {
    return preFilter;
  }

  // 2. Check LLM Configuration
  const llm = LLMProviderFactory.getProvider();
  if (!llm.isConfigured()) {
    // Graceful rule-based heuristic fallback if all LLM keys are absent
    return executeHeuristicRuleScorer(title, content);
  }

  // 3. Stage 1: Single-Judge AI Evaluation
  let result: IntentClassificationResult;
  try {
    result = await runSingleJudgeAI(llm, input);
  } catch (err: any) {
    console.warn(`[Intent AI Warning]: ${err.message}. Falling back to rule scorer.`);
    return executeHeuristicRuleScorer(title, content);
  }

  // 4. Stage 2: Three-Judge Panel (SignalPipe) for Borderline / Ambiguous signals (40 - 75 score)
  if (result.score >= 40 && result.score <= 75 && result.intentCategory !== 'COMPETITOR_SWITCH') {
    result = await runThreeJudgePanelAI(llm, input, result);
  }

  return result;
}

/**
 * Deterministic Regex Rule Scorer (Emergency fallback when no LLM provider is reachable).
 */
function executeHeuristicRuleScorer(title: string, text: string): IntentClassificationResult {
  const combined = `${title} ${text}`.toLowerCase();

  let switchMatches = 0;
  let matchedSwitchSnippet: string | undefined;
  for (const p of COMPETITOR_SWITCH_PATTERNS) {
    const match = combined.match(p);
    if (match) {
      switchMatches++;
      if (!matchedSwitchSnippet) matchedSwitchSnippet = match[0];
    }
  }

  let buyMatches = 0;
  let matchedBuySnippet: string | undefined;
  for (const p of BUY_INTENT_PATTERNS) {
    const match = combined.match(p);
    if (match) {
      buyMatches++;
      if (!matchedBuySnippet) matchedBuySnippet = match[0];
    }
  }

  if (switchMatches > 0) {
    return {
      score: 85,
      intentCategory: 'COMPETITOR_SWITCH',
      isBuyer: true,
      confidence: 0.82,
      reason: 'Competitor switching or dissatisfaction anchor detected in text.',
      evidenceSnippet: matchedSwitchSnippet || title.slice(0, 100),
      urgency: 'HIGH',
      recommendedAction: 'OUTREACH',
      scoringMethod: 'DETERMINISTIC_RULES',
    };
  }

  if (buyMatches > 0) {
    return {
      score: Math.min(95, 70 + buyMatches * 8),
      intentCategory: 'EXPLICIT_BUY_SIGNAL',
      isBuyer: true,
      confidence: 0.78,
      reason: `Buying recommendation or procurement request detected (${buyMatches} signals).`,
      evidenceSnippet: matchedBuySnippet || title.slice(0, 100),
      urgency: 'MEDIUM',
      recommendedAction: 'OUTREACH',
      scoringMethod: 'DETERMINISTIC_RULES',
    };
  }

  return {
    score: 40,
    intentCategory: 'GENERAL_DISCUSSION',
    isBuyer: false,
    confidence: 0.65,
    reason: 'General inquiry or discussion without urgent commercial purchase anchors.',
    evidenceSnippet: title.slice(0, 100),
    urgency: 'LOW',
    recommendedAction: 'DISMISS',
    scoringMethod: 'DETERMINISTIC_RULES',
  };
}
