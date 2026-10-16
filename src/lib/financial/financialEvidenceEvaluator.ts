import {
  FinancialEligibilityResult,
  FinancialEvidenceRecord,
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
  MARKET_CAP: { label: 'Market Capitalization', isNetWorth: false },
  ASSETS: { label: 'Total Balance Sheet Assets', isNetWorth: false },
  FUNDING: { label: 'Total Equity Funding Raised', isNetWorth: false },
  UNKNOWN: { label: 'Unclassified Financial Metric', isNetWorth: false },
};

/**
 * Evaluates a business against the ₹70 Crore INR threshold based on public financial evidence.
 * 
 * Rules:
 * 1. If evidence is empty, null, or undefined -> INSUFFICIENT_EVIDENCE.
 * 2. Never infer net worth from business name, star rating, reviews, website status, or company size.
 * 3. Convert all evidence currencies to INR using documented benchmark FX rates.
 * 4. Distinctly label whether the qualifying evidence is verified Net Worth or verified Revenue/Valuation scale.
 */
export function evaluateFinancialEligibility(
  evidenceList: FinancialEvidenceRecord[] | undefined,
  businessInfo?: { businessName: string; country?: string }
): FinancialEligibilityResult {
  const evaluatedAt = new Date().toISOString();

  // Rule 1: No evidence provided -> INSUFFICIENT_EVIDENCE
  if (!evidenceList || !Array.isArray(evidenceList) || evidenceList.length === 0) {
    return {
      eligibilityState: 'INSUFFICIENT_EVIDENCE',
      isQualified: false,
      thresholdInr: HIGH_NET_WORTH_THRESHOLD_INR,
      primaryMetricType: 'UNKNOWN',
      metricLabel: 'Insufficient Evidence',
      qualificationExplanation:
        'No verifiable public financial filings, registry records (MCA/SEC/SEDAR+), or audited disclosures were available for this business.',
      isNetWorth: false,
      evaluatedAt,
    };
  }

  // Find the strongest piece of evidence: prefer NET_WORTH if present, else highest verified INR scale
  const sorted = [...evidenceList].sort((a, b) => {
    // Net worth takes precedence when evaluating net worth
    if (a.metricType === 'NET_WORTH' && b.metricType !== 'NET_WORTH') return -1;
    if (b.metricType === 'NET_WORTH' && a.metricType !== 'NET_WORTH') return 1;
    return b.amountInInr - a.amountInInr;
  });

  const bestEvidence = sorted[0];
  const { amountInInr, thresholdMet } = convertToInr(bestEvidence.rawAmount, bestEvidence.currency);
  const metricInfo = METRIC_DESCRIPTIONS[bestEvidence.metricType] || METRIC_DESCRIPTIONS.UNKNOWN;
  const isNetWorth = metricInfo.isNetWorth;

  if (thresholdMet) {
    const formattedInr = formatInrCrores(amountInInr);
    const metricExplanation = isNetWorth
      ? `Verified Net Worth: ${formattedInr} (exceeds ₹70 Cr INR threshold). Filing: ${bestEvidence.sourceName} (${bestEvidence.reportingPeriod}).`
      : `Verified Financial Scale (${metricInfo.label}): ${formattedInr} (exceeds ₹70 Cr INR scale). Note: Metric represents ${metricInfo.label}, not Net Worth. Source: ${bestEvidence.sourceName} (${bestEvidence.reportingPeriod}).`;

    return {
      eligibilityState: 'QUALIFIED',
      isQualified: true,
      thresholdInr: HIGH_NET_WORTH_THRESHOLD_INR,
      primaryMetricType: bestEvidence.metricType,
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
      isQualified: false,
      thresholdInr: HIGH_NET_WORTH_THRESHOLD_INR,
      primaryMetricType: bestEvidence.metricType,
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
