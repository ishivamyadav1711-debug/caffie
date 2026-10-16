/**
 * High-Net-Worth Financial Intelligence Types & Thresholds
 * 
 * Target threshold: ₹70 Crore INR (700,000,000 INR)
 * Supports distinct metric types, currency conversion, provenance tracking, and explicit eligibility states.
 */

export const HIGH_NET_WORTH_THRESHOLD_INR = 700_000_000; // ₹70 Crore INR

/**
 * Explicit financial metric types.
 * Net Worth, Revenue, Valuation, Assets, Market Cap, and Funding MUST NOT be treated as interchangeable.
 */
export type FinancialMetricType =
  | 'NET_WORTH'     // Shareholders' Equity / Total Net Worth
  | 'REVENUE'       // Annual Revenue / Turnover / Gross Sales
  | 'VALUATION'     // Enterprise / Post-Money Valuation
  | 'MARKET_CAP'    // Public Market Capitalization
  | 'ASSETS'        // Total Balance Sheet Assets
  | 'FUNDING'       // Total Equity Funding Raised
  | 'UNKNOWN';      // Unclassified

/**
 * Three explicit eligibility states mandated for experimental financial qualification.
 */
export type FinancialEligibilityState =
  | 'QUALIFIED'              // Verified public evidence meets or exceeds ₹70 Crore INR threshold
  | 'NOT_QUALIFIED'          // Verified public evidence exists, but scale is strictly below ₹70 Crore INR
  | 'INSUFFICIENT_EVIDENCE'; // No reliable public registry filing or verified disclosure available

/**
 * Documented baseline FX conversion rates to INR (Baseline Date: October 2026).
 */
export const DOCUMENTED_FX_RATES_TO_INR: Record<string, { rate: number; method: string; effectiveDate: string }> = {
  INR: { rate: 1.0, method: 'Direct base currency', effectiveDate: '2026-10-01' },
  USD: { rate: 84.0, method: 'RBI / Interbank reference benchmark', effectiveDate: '2026-10-01' },
  CAD: { rate: 61.5, method: 'Bank of Canada / Interbank reference benchmark', effectiveDate: '2026-10-01' },
  EUR: { rate: 91.5, method: 'ECB / Interbank reference benchmark', effectiveDate: '2026-10-01' },
  GBP: { rate: 109.0, method: 'BoE / Interbank reference benchmark', effectiveDate: '2026-10-01' },
};

export interface FinancialEvidenceRecord {
  id?: string;
  metricType: FinancialMetricType;
  rawAmount: number;
  currency: string;
  amountInInr: number;
  conversionRateUsed: number;
  conversionMethod: string;
  conversionDate: string;
  thresholdMet: boolean; // >= ₹70 Crore INR
  reportingPeriod: string; // e.g. "FY2023-24", "CY2023", "Q4 2023"
  sourceName: string; // e.g. "Ministry of Corporate Affairs (MCA)", "SEC Edgar", "SEDAR+", "Official Annual Report"
  sourceUrl: string;
  sourceTier: 'TIER_1_REGISTRY' | 'TIER_2_FILING' | 'TIER_3_PUBLIC_REPORT';
  evidenceDate: string;
  notes?: string;
}

export interface FinancialEligibilityResult {
  eligibilityState: FinancialEligibilityState;
  isQualified: boolean;
  thresholdInr: number;
  primaryMetricType: FinancialMetricType;
  amountInInr?: number;
  rawAmount?: number;
  currency?: string;
  metricLabel: string;
  qualificationExplanation: string;
  isNetWorth: boolean; // True ONLY if primaryMetricType === 'NET_WORTH'
  evidence?: FinancialEvidenceRecord;
  evaluatedAt: string;
}
