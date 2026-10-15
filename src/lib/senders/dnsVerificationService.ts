/**
 * LeadPilot — Truthful DNS Verification Service
 *
 * Implements Phase 3 Production-Ready DNS Verification:
 * - Live DNS TXT lookup using Node.js built-in dns/promises
 * - Real SPF inspection (v=spf1)
 * - Real DMARC inspection (v=DMARC1 at _dmarc.<domain>)
 * - Real DKIM inspection (<selector>._domainkey.<domain>)
 * - NEVER pretends DKIM can be verified without a selector
 * - NEVER fabricates fake green checks
 */
import { resolveTxt } from 'node:dns/promises';

export type DnsStatus = 'VERIFIED' | 'NOT_VERIFIED' | 'ERROR';
export type DkimStatus = 'VERIFIED' | 'NOT_VERIFIED' | 'SELECTOR_REQUIRED' | 'ERROR';

export interface SpfCheckResult {
  status: DnsStatus;
  record?: string;
  evidence?: string;
}

export interface DkimCheckResult {
  status: DkimStatus;
  selector?: string;
  record?: string;
  evidence?: string;
}

export interface DmarcCheckResult {
  status: DnsStatus;
  policy?: string;
  record?: string;
  evidence?: string;
}

export interface DnsVerificationResult {
  domain: string;
  verifiedAt: string;
  spf: SpfCheckResult;
  dkim: DkimCheckResult;
  dmarc: DmarcCheckResult;
  overallReady: boolean;
}

export class DnsVerificationService {
  private static readonly DNS_TIMEOUT_MS = 5000;

  /**
   * Helper to execute a promise with timeout.
   */
  private static async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
  }

  /**
   * Look up TXT records for a hostname safely.
   */
  private static async safeResolveTxt(hostname: string): Promise<string[]> {
    try {
      const records = await this.withTimeout(resolveTxt(hostname), this.DNS_TIMEOUT_MS);
      // resolveTxt returns string[][], join chunks
      return records.map((chunks) => chunks.join(''));
    } catch (err: any) {
      if (err.code === 'ENODATA' || err.code === 'ENOTFOUND' || err.code === 'ESERVFAIL') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Check SPF record on domain.
   */
  static async checkSpf(domain: string): Promise<SpfCheckResult> {
    try {
      const txts = await this.safeResolveTxt(domain);
      const spfRecord = txts.find((t) => t.trim().startsWith('v=spf1'));

      if (!spfRecord) {
        return {
          status: 'NOT_VERIFIED',
          evidence: 'No SPF (v=spf1) TXT record found on domain.',
        };
      }

      // Check if it includes Google Workspace or common mechanisms
      const isGoogleIncluded = spfRecord.includes('_spf.google.com');
      const hasPolicy = spfRecord.includes('-all') || spfRecord.includes('~all') || spfRecord.includes('?all');

      let evidence = `SPF record active: ${spfRecord}`;
      if (isGoogleIncluded) {
        evidence += ' (Google Workspace authorization confirmed)';
      }

      return {
        status: hasPolicy ? 'VERIFIED' : 'NOT_VERIFIED',
        record: spfRecord,
        evidence,
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        evidence: `DNS error resolving SPF for ${domain}: ${err.message}`,
      };
    }
  }

  /**
   * Check DMARC record at _dmarc.<domain>.
   */
  static async checkDmarc(domain: string): Promise<DmarcCheckResult> {
    const dmarcHost = `_dmarc.${domain}`;
    try {
      const txts = await this.safeResolveTxt(dmarcHost);
      const dmarcRecord = txts.find((t) => t.trim().startsWith('v=DMARC1'));

      if (!dmarcRecord) {
        return {
          status: 'NOT_VERIFIED',
          evidence: `No DMARC (v=DMARC1) TXT record found at ${dmarcHost}.`,
        };
      }

      // Extract policy (p=none, p=quarantine, p=reject)
      const policyMatch = dmarcRecord.match(/p\s*=\s*(none|quarantine|reject)/i);
      const policy = policyMatch ? policyMatch[1].toLowerCase() : 'unknown';

      return {
        status: 'VERIFIED',
        policy: `p=${policy}`,
        record: dmarcRecord,
        evidence: `DMARC policy active: p=${policy} (${dmarcRecord})`,
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        evidence: `DNS error resolving DMARC for ${dmarcHost}: ${err.message}`,
      };
    }
  }

  /**
   * Check DKIM record with explicit selector.
   * If no selector is provided, returns SELECTOR_REQUIRED without guessing.
   */
  static async checkDkim(domain: string, selector?: string): Promise<DkimCheckResult> {
    const trimmedSelector = selector?.trim();
    if (!trimmedSelector) {
      return {
        status: 'SELECTOR_REQUIRED',
        evidence: 'DKIM verification requires the specific DNS selector configured in your Google Workspace admin console (e.g. "google").',
      };
    }

    const dkimHost = `${trimmedSelector}._domainkey.${domain}`;
    try {
      const txts = await this.safeResolveTxt(dkimHost);
      const dkimRecord = txts.find((t) => t.includes('v=DKIM1') || t.includes('p=') || t.includes('k=rsa'));

      if (!dkimRecord) {
        return {
          status: 'NOT_VERIFIED',
          selector: trimmedSelector,
          evidence: `No DKIM public key found at ${dkimHost}.`,
        };
      }

      return {
        status: 'VERIFIED',
        selector: trimmedSelector,
        record: dkimRecord.length > 80 ? `${dkimRecord.substring(0, 77)}...` : dkimRecord,
        evidence: `DKIM public key record verified for selector "${trimmedSelector}".`,
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        selector: trimmedSelector,
        evidence: `DNS error resolving DKIM at ${dkimHost}: ${err.message}`,
      };
    }
  }

  /**
   * Complete domain DNS audit.
   */
  static async verifyDomain(domain: string, dkimSelector?: string): Promise<DnsVerificationResult> {
    const cleanDomain = domain.trim().toLowerCase();
    const [spf, dmarc, dkim] = await Promise.all([
      this.checkSpf(cleanDomain),
      this.checkDmarc(cleanDomain),
      this.checkDkim(cleanDomain, dkimSelector),
    ]);

    const overallReady = spf.status === 'VERIFIED' && dmarc.status === 'VERIFIED';

    return {
      domain: cleanDomain,
      verifiedAt: new Date().toISOString(),
      spf,
      dkim,
      dmarc,
      overallReady,
    };
  }
}
