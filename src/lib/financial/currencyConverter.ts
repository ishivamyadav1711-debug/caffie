import { DOCUMENTED_FX_RATES_TO_INR, HIGH_NET_WORTH_THRESHOLD_INR } from './types';

export interface CurrencyConversionResult {
  rawAmount: number;
  currency: string;
  amountInInr: number;
  rateUsed: number;
  conversionMethod: string;
  effectiveDate: string;
  thresholdMet: boolean;
}

/**
 * Converts any supported currency to INR using the documented conversion benchmark.
 * Note: Uses fixed documented conversion benchmark rates with explicit effective date (October 2026).
 * Safely handles zero, negative, or invalid amounts without throwing.
 */
export function convertToInr(rawAmount: number, rawCurrency: string): CurrencyConversionResult {
  const safeAmount = typeof rawAmount === 'number' && !isNaN(rawAmount) ? Math.max(0, rawAmount) : 0;
  const currency = (rawCurrency || 'INR').trim().toUpperCase();
  const benchmark = DOCUMENTED_FX_RATES_TO_INR[currency] || {
    rate: 1.0,
    method: 'Unrecognized currency fallback (1:1 direct)',
    effectiveDate: '2026-10-01',
  };

  const amountInInr = Math.round(safeAmount * benchmark.rate);
  // Threshold can only be met if amount is positive and >= ₹70 Crore
  const thresholdMet = amountInInr >= HIGH_NET_WORTH_THRESHOLD_INR;

  return {
    rawAmount: safeAmount,
    currency,
    amountInInr,
    rateUsed: benchmark.rate,
    conversionMethod: benchmark.method,
    effectiveDate: benchmark.effectiveDate,
    thresholdMet,
  };
}

/**
 * Formats an amount in Crores (Cr) INR for display.
 * e.g., 700000000 -> "₹70.0 Cr INR"
 *       1250000000 -> "₹125.0 Cr INR"
 *       0 -> "₹0.0 Cr INR"
 */
export function formatInrCrores(amountInInr: number): string {
  if (typeof amountInInr !== 'number' || isNaN(amountInInr)) return '₹0.0 Cr INR';
  const crores = amountInInr / 10_000_000;
  return `₹${crores.toFixed(1)} Cr INR`;
}
