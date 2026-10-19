import {
  FinancialEligibilityResult,
  FinancialEvidenceRecord,
  FinancialFilterMode,
  FinancialMetricType,
  HIGH_NET_WORTH_THRESHOLD_INR,
} from './types';
import { convertToInr, formatInrCrores } from './currencyConverter';

/**
 * Human-readable metric labels and descriptions to prevent confusing revenue/valuation with net worth.
 */
export const METRIC_DESCRIPTIONS: Record<FinancialMetricType, { label: string; isNetWorth: boolean }> = {
  NET_WORTH: { label: 'Net Worth (Shareholders Equity)', isNetWorth: true },
  REVENUE: { label: 'Annual Revenue / Turnover', isNetWorth: false },
  VALUATION: { label: 'Company Valuation', isNetWorth: false },
  TOTAL_ASSETS: { label: 'Total Balance Sheet Assets', isNetWorth: false },
  ASSETS: { label: 'Total Balance Sheet Assets', isNetWorth: false },
  MARKET_CAP: { label: 'Market Capitalization', isNetWorth: false },
  FUNDING: { label: 'Total Equity Funding Raised', isNetWorth: false },
  UNKNOWN: { label: 'Unclassified Financial Metric', isNetWorth: false },
};

/**
 * Evaluates a business against the ₹70 Crore INR threshold based on public financial evidence.
 * 
 * Rules:
 * 1. If evidence is empty, null, or undefined -> INSUFFICIENT_EVIDENCE.
 * 2. In STRICT_NET_WORTH mode: qualify ONLY if verified Net Worth >= ₹70 Cr INR.
 *    Revenue, valuation, assets, and market cap MUST NEVER be treated as Net Worth.
 * 3. In BROAD_FINANCIAL_SCALE mode: qualify if verified financial scale >= ₹70 Cr INR,
 *    with explicit and truthful labeling of the metric.
 * 4. Entity matching confidence must be >= 0.80 to attribute filings to the specific business.
 * 5. Stale, unverified, or contradictory evidence must not qualify.
 */
export function evaluateFinancialEligibility(
  evidenceList: FinancialEvidenceRecord[] | undefined,
  businessInfo?: { businessName: string; country?: string },
  filterMode: FinancialFilterMode = 'STRICT_NET_WORTH'
): FinancialEligibilityResult {
  const evaluatedAt = new Date().toISOString();

  // Rule 1: No evidence provided -> INSUFFICIENT_EVIDENCE
  if (!evidenceList || !Array.isArray(evidenceList) || evidenceList.length === 0) {
    return {
      eligibilityState: 'INSUFFICIENT_EVIDENCE',
      state: 'INSUFFICIENT_EVIDENCE',
      filterMode,
      isQualified: false,
      isHighNetWorthQualified: false,
      thresholdInr: HIGH_NET_WORTH_THRESHOLD_INR,
      primaryMetricType: 'UNKNOWN',
      matchingConfidence: 0,
      metricLabel: 'Insufficient Evidence',
      qualificationExplanation:
        'No verifiable public financial filings, registry records (MCA/SEC/SEDAR+), or audited disclosures were available for this business.',
      isNetWorth: false,
      evaluatedAt,
    };
  }

  // Find the most appropriate piece of evidence
  const sorted = [...evidenceList].sort((a, b) => {
    // If evaluating strict net worth, prioritize Net Worth records
    if (filterMode === 'STRICT_NET_WORTH') {
      if (a.metricType === 'NET_WORTH' && b.metricType !== 'NET_WORTH') return -1;
      if (b.metricType === 'NET_WORTH' && a.metricType !== 'NET_WORTH') return 1;
    }
    return b.amountInInr - a.amountInInr;
  });

  const bestEvidence = sorted[0];
  const matchingConfidence = typeof bestEvidence.matchingConfidence === 'number' ? bestEvidence.matchingConfidence : 1.0;

  // Rule 4: Matching confidence check
  if (matchingConfidence < 0.80) {
    return {
      eligibilityState: 'INSUFFICIENT_EVIDENCE',
      state: 'INSUFFICIENT_EVIDENCE',
      filterMode,
      isQualified: false,
      isHighNetWorthQualified: false,
      thresholdInr: HIGH_NET_WORTH_THRESHOLD_INR,
      primaryMetricType: bestEvidence.metricType,
      matchingConfidence,
      metricLabel: 'Identity Match Inconclusive',
      qualificationExplanation: `Identity matching confidence (${(matchingConfidence * 100).toFixed(0)}%) is insufficient to attribute regulatory filings of "${bestEvidence.entityName || 'listed entity'}" to "${businessInfo?.businessName || 'this business'}". Entity match confidence must be ≥ 80%.`,
      isNetWorth: bestEvidence.metricType === 'NET_WORTH',
      evidence: bestEvidence,
      evaluatedAt,
    };
  }

  // Rule 5: Verification status check
  if (bestEvidence.verificationStatus === 'STALE' || bestEvidence.verificationStatus === 'CONTRADICTORY') {
    return {
      eligibilityState: 'INSUFFICIENT_EVIDENCE',
      state: 'INSUFFICIENT_EVIDENCE',
      filterMode,
      isQualified: false,
      isHighNetWorthQualified: false,
      thresholdInr: HIGH_NET_WORTH_THRESHOLD_INR,
      primaryMetricType: bestEvidence.metricType,
      matchingConfidence,
      metricLabel: `${bestEvidence.verificationStatus} Evidence`,
      qualificationExplanation: `Public financial filing is marked as ${bestEvidence.verificationStatus} (${bestEvidence.reportingPeriod}) (stale or contradictory evidence) and cannot be used for current threshold qualification.`,
      isNetWorth: bestEvidence.metricType === 'NET_WORTH',
      evidence: bestEvidence,
      evaluatedAt,
    };
  }

  const { amountInInr, thresholdMet } = convertToInr(bestEvidence.rawAmount, bestEvidence.currency);
  const metricInfo = METRIC_DESCRIPTIONS[bestEvidence.metricType] || METRIC_DESCRIPTIONS.UNKNOWN;
  const isNetWorth = metricInfo.isNetWorth;

  // Check strict net worth mode requirement
  if (filterMode === 'STRICT_NET_WORTH' && !isNetWorth) {
    const formattedInr = formatInrCrores(amountInInr);
    return {
      eligibilityState: 'NOT_QUALIFIED',
      state: 'NOT_QUALIFIED',
      filterMode,
      isQualified: false,
      isHighNetWorthQualified: false,
      thresholdInr: HIGH_NET_WORTH_THRESHOLD_INR,
      primaryMetricType: bestEvidence.metricType,
      matchingConfidence,
      amountInInr,
      rawAmount: bestEvidence.rawAmount,
      currency: bestEvidence.currency,
      metricLabel: `${metricInfo.label}: ${formattedInr}`,
      qualificationExplanation: `Credible evidence establishes ${metricInfo.label} of ${formattedInr} (Revenue / Turnover, not Net Worth), but verified Net Worth (shareholders equity) evidence is unavailable. The strict Net-Worth filter requires verified equity ≥ ₹70 Cr INR.`,
      isNetWorth: false,
      evidence: bestEvidence,
      evaluatedAt,
    };
  }

  if (thresholdMet) {
    const formattedInr = formatInrCrores(amountInInr);
    const metricExplanation = isNetWorth
      ? `Verified Net Worth: ${formattedInr} (exceeds ₹70 Cr INR threshold). Filing: ${bestEvidence.sourceName} (${bestEvidence.reportingPeriod}).`
      : `Verified Financial Scale (${metricInfo.label}): ${formattedInr} (exceeds ₹70 Cr INR scale). Note: Metric represents ${metricInfo.label}, not Net Worth. Source: ${bestEvidence.sourceName} (${bestEvidence.reportingPeriod}).`;

    return {
      eligibilityState: 'QUALIFIED',
      state: 'QUALIFIED',
      filterMode,
      isQualified: true,
      isHighNetWorthQualified: true,
      thresholdInr: HIGH_NET_WORTH_THRESHOLD_INR,
      primaryMetricType: bestEvidence.metricType,
      matchingConfidence,
      amountInInr,
      rawAmount: bestEvidence.rawAmount,
      currency: bestEvidence.currency,
      metricLabel: isNetWorth
        ? `Verified Net Worth: ${formattedInr}`
        : `Verified ${metricInfo.label}: ${formattedInr}`,
      qualificationExplanation: metricExplanation,
      isNetWorth,
      evidence: bestEvidence,
      evaluatedAt,
    };
  } else {
    const formattedInr = formatInrCrores(amountInInr);
    return {
      eligibilityState: 'NOT_QUALIFIED',
      state: 'NOT_QUALIFIED',
      filterMode,
      isQualified: false,
      isHighNetWorthQualified: false,
      thresholdInr: HIGH_NET_WORTH_THRESHOLD_INR,
      primaryMetricType: bestEvidence.metricType,
      matchingConfidence,
      amountInInr,
      rawAmount: bestEvidence.rawAmount,
      currency: bestEvidence.currency,
      metricLabel: `${metricInfo.label}: ${formattedInr} (< ₹70 Cr INR)`,
      qualificationExplanation: `Verified ${metricInfo.label} is ${formattedInr}, which is below the ₹70 Crore INR threshold. Source: ${bestEvidence.sourceName}.`,
      isNetWorth,
      evidence: bestEvidence,
      evaluatedAt,
    };
  }
}
