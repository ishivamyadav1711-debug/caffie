import dns from 'dns';
import { prospeoFindEmail } from './prospeo';
import { tombaFindEmail } from './tomba';
import { findymailFindEmail } from './findymail';
import { icypeasFindPhone } from './icypeas';
import { emailVerificationService } from '@/lib/providers/emailVerificationProvider2';
import { phoneVerificationService } from '@/lib/providers/phoneVerificationProvider';

const cache = new Map<string, any>();

export async function enrichContact(input: { first_name: string; last_name?: string; company_domain?: string; company_name?: string; company_country?: string }) {
  const key = `${input.first_name}:${input.last_name || ''}:${input.company_domain || input.company_name || ''}`.toLowerCase();
  if (cache.has(key)) return { ...cache.get(key), cached: true };
  let totalCost = 0;
  if (input.company_domain) {
    const mx = await dns.promises.resolveMx(input.company_domain).then((r) => r.length > 0).catch(() => false);
    if (!mx) console.log('[Enrichment] Domain has no MX records:', input.company_domain);
  }
  let workEmail: { value: string; provider: string; confidence: number } | null = null;
  for (const fn of [prospeoFindEmail, tombaFindEmail, findymailFindEmail]) {
    totalCost += 1;
    const res = await fn(input);
    if (res?.email) {
      const v = await emailVerificationService.verifyEmail(res.email);
      workEmail = { value: res.email, provider: res.provider, confidence: v.isValid ? res.confidence : 0.5 };
      break;
    }
  }
  let phone: { value: string; provider: string } | null = null;
  totalCost += 1;
  const pRes = await icypeasFindPhone(input);
  if (pRes?.phone) {
    const pv = await phoneVerificationService.verifyPhone(pRes.phone, input.company_country);
    phone = { value: pv.normalizedE164 || pv.normalizedPhone || pRes.phone, provider: pRes.provider };
  }
  const result = { workEmail, phone, cached: false, totalCost };
  cache.set(key, result);
  return result;
}
