/**
 * High-Net-Worth Financial Intelligence Types & Thresholds
 * 
 * Target threshold: ₹70 Crore INR (700,000,000 INR)
 * Supports distinct metric types, currency conversion, provenance tracking, and explicit eligibility states.
 */

export const HIGH_NET_WORTH_THRESHOLD_INR = 700_000_000; // ₹70 Crore INR

/**
 * Explicit financial metric types.
 * Net Worth, Revenue, Valuation, Total Assets, Market Cap, and Funding MUST NOT be treated as interchangeable.
 */
export type FinancialMetricType =
  | 'NET_WORTH'     // Shareholders' Equity / Total Net Worth
  | 'REVENUE'       // Annual Revenue / Turnover / Gross Sales
  | 'VALUATION'     // Enterprise / Post-Money Valuation
  | 'TOTAL_ASSETS'  // Total Balance Sheet Assets
  | 'ASSETS'        // Alias for TOTAL_ASSETS for backward compatibility
  | 'MARKET_CAP'    // Public Market Capitalization
  | 'FUNDING'       // Total Equity Funding Raised
  | 'UNKNOWN';      // Unclassified

/**
 * Filter mode:
 * STRICT_NET_WORTH: Qualifies ONLY if verified Net Worth >= ₹70 Cr INR.
 * BROAD_FINANCIAL_SCALE: Separately named mode qualifying any verified scale >= ₹70 Cr INR while distinctly labeling metric.
 */
export type FinancialFilterMode = 'STRICT_NET_WORTH' | 'BROAD_FINANCIAL_SCALE';

/**
 * Three explicit eligibility states mandated for financial qualification.
 */
export type FinancialEligibilityState =
  | 'QUALIFIED'              // Verified public evidence meets or exceeds ₹70 Crore INR threshold for selected mode
  | 'NOT_QUALIFIED'          // Verified public evidence exists, but scale is strictly below ₹70 Crore INR
  | 'INSUFFICIENT_EVIDENCE'; // No reliable public registry filing or verified disclosure available

/**
 * Documented baseline FX conversion rates to INR.
 * Note: Fixed documented conversion benchmark, effective date October 2026.
 */
export const DOCUMENTED_FX_RATES_TO_INR: Record<string, { rate: number; method: string; effectiveDate: string }> = {
  INR: { rate: 1.0, method: 'Direct base currency (INR)', effectiveDate: '2026-10-01' },
  USD: { rate: 84.0, method: 'RBI / Interbank reference benchmark (84.0 INR/USD)', effectiveDate: '2026-10-01' },
  CAD: { rate: 61.5, method: 'Bank of Canada / Interbank reference benchmark (61.5 INR/CAD)', effectiveDate: '2026-10-01' },
  EUR: { rate: 91.5, method: 'ECB / Interbank reference benchmark (91.5 INR/EUR)', effectiveDate: '2026-10-01' },
  GBP: { rate: 109.0, method: 'BoE / Interbank reference benchmark (109.0 INR/GBP)', effectiveDate: '2026-10-01' },
};

export interface FinancialEvidenceRecord {
  id?: string;
  entityName: string;
  matchingConfidence: number; // 0.0 to 1.0
  cik?: string; // SEC CIK if applicable
  metricType: FinancialMetricType;
  rawAmount: number; // Reported value
  currency: string;  // Original currency
  amountInInr: number; // Converted INR value
  conversionRateUsed: number;
  conversionMethod: string;
  conversionDate: string;
  thresholdMet: boolean; // >= ₹70 Crore INR
  reportingPeriod: string; // e.g. "FY2023-24", "CY2023", "Q4 2023"
  effectiveDate?: string;
  sourceName: string; // e.g. "US SEC EDGAR 10-K / XBRL", "Ministry of Corporate Affairs (MCA)", "SEDAR+"
  sourceUrl: string;
  sourceTier: 'TIER_1_REGISTRY' | 'TIER_2_FILING' | 'TIER_3_PUBLIC_REPORT';
  retrievalDate: string;
  evidenceDate: string;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED' | 'STALE' | 'CONTRADICTORY';
  notes?: string;
}

export interface FinancialEligibilityResult {
  eligibilityState: FinancialEligibilityState;
  filterMode: FinancialFilterMode;
  isQualified: boolean;
  thresholdInr: number;
  primaryMetricType: FinancialMetricType;
  matchingConfidence: number;
  amountInInr?: number;
  rawAmount?: number;
  currency?: string;
  metricLabel: string;
  qualificationExplanation: string;
  isNetWorth: boolean; // True ONLY if primaryMetricType === 'NET_WORTH'
  evidence?: FinancialEvidenceRecord;
  evaluatedAt: string;
}
