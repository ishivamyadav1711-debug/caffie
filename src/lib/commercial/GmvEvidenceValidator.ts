import * as dns from 'dns';
import { URL } from 'url';

export interface GmvValidationResult {
  valid: boolean;
  rejectionReason?: string;
  metricType: "GMV" | "NON_GMV" | "UNKNOWN";
  dateAccuracy?: "EXACT" | "MONTH_YEAR" | "YEAR";
  verifiedSource: boolean;
}

const FORBIDDEN_IPS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1/,
  /^fc00:/,
  /^fe80:/
];

const NON_GMV_TERMS = [
  'revenue',
  'sales',
  'arr',
  'mrr',
  'turnover',
  'income',
  'profit',
  'ebitda',
  'valuation',
  'funding',
  'investment',
  'market cap',
  'founded',
  'launched',
  'raised',
  'acquired'
];

export class GmvEvidenceValidator {
  
  /**
   * Main validation entry point. 
   */
  public async validateEvidence(params: {
    evidenceText: string;
    sourceUrl: string;
    businessName: string;
    claimedGmvAmount?: number;
    claimedDate?: string;
    claimedDateAccuracy?: "EXACT" | "MONTH_YEAR" | "YEAR" | "ESTIMATED";
  }): Promise<GmvValidationResult> {
    
    // 1. Check Date Accuracy
    if (params.claimedDateAccuracy === "ESTIMATED") {
      return this.reject("ESTIMATED_DATE", "UNKNOWN");
    }

    if (!params.evidenceText) {
      return this.reject("NO_GMV_EVIDENCE", "UNKNOWN");
    }

    const textLower = params.evidenceText.toLowerCase();

    // 2. Explicit GMV terminology check
    const hasGmvTerm = textLower.includes('gmv') || textLower.includes('gross merchandise value');
    if (!hasGmvTerm) {
      // It might have non-GMV terms
      const hasNonGmv = NON_GMV_TERMS.some(t => textLower.includes(t));
      return this.reject(hasNonGmv ? "NON_GMV_METRIC" : "NO_GMV_EVIDENCE", hasNonGmv ? "NON_GMV" : "UNKNOWN");
    }

    // 3. Business Identity Check (simplified string match for now)
    const businessNameTokens = params.businessName.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    let identityMatch = false;
    for (const token of businessNameTokens) {
      if (textLower.includes(token)) {
        identityMatch = true;
        break;
      }
    }
    if (!identityMatch) {
      return this.reject("BUSINESS_IDENTITY_MISMATCH", "GMV");
    }

    // 4. Source URL Security Check (SSRF protection)
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(params.sourceUrl);
    } catch {
      return this.reject("FABRICATED_OR_INVALID_URL", "GMV");
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return this.reject("FABRICATED_OR_INVALID_URL", "GMV");
    }

    try {
      const isSafe = await this.isSafeHostname(parsedUrl.hostname);
      if (!isSafe) {
        return this.reject("FABRICATED_OR_INVALID_URL", "GMV");
      }
    } catch {
      return this.reject("FABRICATED_OR_INVALID_URL", "GMV");
    }

    // 5. Source Accessibility & Content Verification
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(params.sourceUrl, { 
        signal: controller.signal,
        headers: { 'User-Agent': 'LeadPilot-Commercial-Auditor/1.0' }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return this.reject("SOURCE_INACCESSIBLE", "GMV");
      }
      
      // Limit size
      const text = await this.readBodyWithLimit(response.body, 1024 * 1024 * 2); // 2MB limit
      const pageTextLower = text.toLowerCase();

      // Check if the exact evidence claim actually exists on the page
      // Allow for some minor formatting differences
      const normalizedClaim = params.evidenceText.replace(/\s+/g, ' ').trim().toLowerCase();
      
      // A more robust check could be used here (e.g. searching for the number and GMV near each other)
      // but for strictness, we require the claim or a substantial part of it to be present.
      
      const claimTokens = normalizedClaim.split(' ').filter(t => t.length > 3);
      let foundTokens = 0;
      for (const token of claimTokens) {
        if (pageTextLower.includes(token)) {
          foundTokens++;
        }
      }
      
      if (claimTokens.length > 0 && (foundTokens / claimTokens.length) < 0.5) {
          return this.reject("SOURCE_UNVERIFIED", "GMV");
      }
      
    } catch (e) {
      return this.reject("SOURCE_INACCESSIBLE", "GMV");
    }

    return {
      valid: true,
      metricType: "GMV",
      dateAccuracy: params.claimedDateAccuracy,
      verifiedSource: true
    };
  }

  private reject(reason: string, metricType: "GMV" | "NON_GMV" | "UNKNOWN"): GmvValidationResult {
    return {
      valid: false,
      rejectionReason: reason,
      metricType,
      verifiedSource: false
    };
  }

  private isSafeHostname(hostname: string): Promise<boolean> {
    return new Promise((resolve) => {
      // Localhost checks
      if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        return resolve(false);
      }

      dns.lookup(hostname, (err, address) => {
        if (err) return resolve(false);
        for (const regex of FORBIDDEN_IPS) {
          if (regex.test(address)) {
            return resolve(false);
          }
        }
        resolve(true);
      });
    });
  }

  private async readBodyWithLimit(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
    if (!body) return "";
    
    const reader = body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        size += value.length;
        chunks.push(value);
        if (size > limit) {
          break; // Stop reading if we exceed the limit
        }
      }
    }

    const allBytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      allBytes.set(chunk, offset);
      offset += chunk.length;
    }
    
    return new TextDecoder().decode(allBytes);
  }
}
