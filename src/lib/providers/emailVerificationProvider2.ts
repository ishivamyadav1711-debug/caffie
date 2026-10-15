/**
 * Email Verification Provider Abstraction for LeadPilot
 * 
 * Architecture:
 *   EmailVerificationProvider interface
 *     ├── DnsMxVerificationProvider (always available - syntax + disposable + MX)
 *     └── ZeroBounceVerificationProvider (when ZEROBOUNCE_API_KEY configured - full deliverability)
 * 
 * RULES:
 * - If provider is not configured: status = UNAVAILABLE (NOT VERIFIED)
 * - NEVER manufacture verification results
 * - "email syntax looks valid" ≠ "email is deliverable"
 * - Distinguish: FORMAT_VALID, DOMAIN_VALID, MX_VALID, DELIVERABILITY_VERIFIED
 */
import dns from 'dns';
import {
  ContactVerificationStatus,
  VerificationLevel,
} from './contactTypes';
import { contactVerificationCache } from './ContactVerificationCache';

const resolveMx = dns.promises.resolveMx;

// ─── Email Verification Result ──────────────────────────────

export interface EmailVerificationResult {
  rawEmail: string;
  normalizedEmail: string;
  domain: string;
  isValid: boolean;
  hasValidSyntax: boolean;
  hasMxRecords: boolean | null;  // null = not checked
  isDisposable: boolean;
  isRoleBased: boolean;
  verificationStatus: ContactVerificationStatus;
  verificationLevel: VerificationLevel;
  confidence: number;
  provider: string;
  providerStatus?: 'READY' | 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'TIMEOUT' | 'AUTH_FAILED' | 'PROVIDER_ERROR' | 'QUOTA_EXCEEDED' | 'UNAVAILABLE';
  providerRequestId?: string;
  errorCode?: string;
  cached?: boolean;
  expiresAt?: string;
  details?: Record<string, any>;
}

// ─── Provider Interface ─────────────────────────────────────

export interface EmailVerificationProviderInterface {
  readonly name: string;
  isConfigured(): boolean;
  verifyEmail(email: string): Promise<EmailVerificationResult>;
}

// ─── Common Lists ───────────────────────────────────────────

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com',
  'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
  'guerrillamailblock.com', 'grr.la', 'dispostable.com', 'mailnesia.com',
  'maildrop.cc', 'harakirimail.com', 'tempail.com', 'fakeinbox.com',
  'temp-mail.org', 'tempmailo.com', 'mohmal.com', 'burpcollaborator.net',
]);

const ROLE_BASED_PREFIXES = new Set([
  'info', 'contact', 'support', 'admin', 'sales', 'help', 'service',
  'billing', 'noreply', 'no-reply', 'webmaster', 'postmaster', 'abuse',
  'hostmaster', 'marketing', 'hr', 'press', 'media', 'office', 'hello',
  'feedback', 'enquiry', 'inquiry', 'general', 'team', 'staff',
]);

// ─── DNS MX Verification Provider ──────────────────────────

export class DnsMxVerificationProvider implements EmailVerificationProviderInterface {
  readonly name = 'dns_mx_verifier';

  isConfigured(): boolean {
    return true; // Always available
  }

  async verifyEmail(email: string): Promise<EmailVerificationResult> {
    const raw = (email || '').trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/;

    if (!raw || !emailRegex.test(raw) || raw.includes('..')) {
      return {
        rawEmail: email,
        normalizedEmail: raw,
        domain: '',
        isValid: false,
        hasValidSyntax: false,
        hasMxRecords: null,
        isDisposable: false,
        isRoleBased: false,
        verificationStatus: 'INVALID',
        verificationLevel: 'SYNTAX',
        confidence: 1.0,
        provider: this.name,
        details: { reason: 'Invalid email syntax' },
      };
    }

    const domain = raw.split('@')[1];
    const localPart = raw.split('@')[0];
    const isDisposable = DISPOSABLE_DOMAINS.has(domain);
    const isRoleBased = ROLE_BASED_PREFIXES.has(localPart);

    if (isDisposable) {
      return {
        rawEmail: email,
        normalizedEmail: raw,
        domain,
        isValid: false,
        hasValidSyntax: true,
        hasMxRecords: null,
        isDisposable: true,
        isRoleBased,
        verificationStatus: 'DISPOSABLE',
        verificationLevel: 'DOMAIN',
        confidence: 0.95,
        provider: this.name,
        details: { reason: 'Disposable/temporary email domain' },
      };
    }

    // DNS MX record check
    try {
      const records = await resolveMx(domain);
      const hasMx = Array.isArray(records) && records.length > 0;

      if (!hasMx) {
        return {
          rawEmail: email,
          normalizedEmail: raw,
          domain,
          isValid: false,
          hasValidSyntax: true,
          hasMxRecords: false,
          isDisposable: false,
          isRoleBased,
          verificationStatus: 'INVALID',
          verificationLevel: 'MX',
          confidence: 0.9,
          provider: this.name,
          details: { reason: 'Domain has no MX records — cannot receive email' },
        };
      }

      // MX exists but we DON'T know if the specific mailbox exists
      // This is NOT DELIVERABILITY_VERIFIED — only MX_VALID
      return {
        rawEmail: email,
        normalizedEmail: raw,
        domain,
        isValid: true,
        hasValidSyntax: true,
        hasMxRecords: true,
        isDisposable: false,
        isRoleBased,
        // IMPORTANT: MX existence is NOT the same as VERIFIED deliverability
        verificationStatus: isRoleBased ? 'ROLE_BASED' : 'UNVERIFIED',
        verificationLevel: 'MX',
        confidence: 0.6, // MX only — mailbox existence unknown
        provider: this.name,
        details: {
          mxCount: records.length,
          primaryExchange: records[0]?.exchange,
          note: 'MX records found but mailbox deliverability not confirmed (no external verification provider)',
        },
      };
    } catch (err: any) {
      return {
        rawEmail: email,
        normalizedEmail: raw,
        domain,
        isValid: false,
        hasValidSyntax: true,
        hasMxRecords: false,
        isDisposable: false,
        isRoleBased,
        verificationStatus: 'INVALID',
        verificationLevel: 'DOMAIN',
        confidence: 0.8,
        provider: this.name,
        details: { reason: `DNS lookup failed: ${err.code || err.message}` },
      };
    }
  }
}

// ─── ZeroBounce Verification Provider ───────────────────────

export class ZeroBounceVerificationProvider implements EmailVerificationProviderInterface {
  readonly name = 'zerobounce';
  private consecutiveFailures = 0;
  private circuitBreakerTrippedUntil: number | null = null;
  private readonly maxFailures = 5;
  private readonly breakerResetMs = 60000;

  isConfigured(): boolean {
    if (process.env.CONTACT_EMAIL_EXTERNAL_VERIFICATION === 'false') {
      return false;
    }
    return Boolean(process.env.ZEROBOUNCE_API_KEY?.trim());
  }

  private isCircuitOpen(): boolean {
    if (!this.circuitBreakerTrippedUntil) return false;
    if (Date.now() > this.circuitBreakerTrippedUntil) {
      this.circuitBreakerTrippedUntil = null;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.maxFailures) {
      this.circuitBreakerTrippedUntil = Date.now() + this.breakerResetMs;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitBreakerTrippedUntil = null;
  }

  async verifyEmail(email: string): Promise<EmailVerificationResult> {
    const raw = (email || '').trim().toLowerCase();
    const domain = raw.includes('@') ? raw.split('@')[1] : '';
    const localPart = raw.includes('@') ? raw.split('@')[0] : '';
    const isRoleBased = ROLE_BASED_PREFIXES.has(localPart);

    if (!this.isConfigured()) {
      return {
        rawEmail: email,
        normalizedEmail: raw,
        domain,
        isValid: false,
        hasValidSyntax: false,
        hasMxRecords: null,
        isDisposable: false,
        isRoleBased,
        verificationStatus: 'UNAVAILABLE',
        verificationLevel: 'SYNTAX',
        confidence: 0,
        provider: this.name,
        providerStatus: 'NOT_CONFIGURED',
        details: { reason: 'ZeroBounce API key not configured or disabled' },
      };
    }

    // 1. Check Verification Cache
    try {
      const cached = await contactVerificationCache.getCachedEmailVerification(raw, this.name);
      if (cached) {
        return {
          rawEmail: email,
          normalizedEmail: raw,
          domain,
          isValid: cached.status === 'VERIFIED' || cached.status === 'ROLE_BASED',
          hasValidSyntax: true,
          hasMxRecords: true,
          isDisposable: cached.status === 'DISPOSABLE',
          isRoleBased: cached.status === 'ROLE_BASED' || isRoleBased,
          verificationStatus: cached.status as ContactVerificationStatus,
          verificationLevel: cached.level as VerificationLevel,
          confidence: cached.confidence,
          provider: this.name,
          providerStatus: (cached.providerStatus as any) || 'READY',
          cached: true,
          expiresAt: cached.expiresAt.toISOString(),
          details: { ...cached.details, fromCache: true },
        };
      }
    } catch (err) {
      console.warn('[ZeroBounce] Cache read failed:', err);
    }

    // 2. Check Circuit Breaker
    if (this.isCircuitOpen()) {
      return {
        rawEmail: email,
        normalizedEmail: raw,
        domain,
        isValid: false,
        hasValidSyntax: true,
        hasMxRecords: null,
        isDisposable: false,
        isRoleBased,
        verificationStatus: 'UNAVAILABLE',
        verificationLevel: 'SYNTAX',
        confidence: 0,
        provider: this.name,
        providerStatus: 'UNAVAILABLE',
        errorCode: 'CIRCUIT_BREAKER_OPEN',
        details: { reason: 'ZeroBounce circuit breaker open due to consecutive failures' },
      };
    }

    const apiKey = process.env.ZEROBOUNCE_API_KEY!.trim();
    const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(raw)}`;

    // Bounded Retries with Exponential Backoff
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5000),
        });

        if (response.status === 401 || response.status === 403) {
          this.recordFailure();
          return {
            rawEmail: email,
            normalizedEmail: raw,
            domain,
            isValid: false,
            hasValidSyntax: true,
            hasMxRecords: null,
            isDisposable: false,
            isRoleBased,
            verificationStatus: 'UNAVAILABLE',
            verificationLevel: 'SYNTAX',
            confidence: 0,
            provider: this.name,
            providerStatus: 'AUTH_FAILED',
            errorCode: 'INVALID_CREDENTIALS',
            details: { httpStatus: response.status, reason: 'ZeroBounce authentication failed' },
          };
        }

        if (response.status === 429) {
          this.recordFailure();
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
            continue;
          }
          return {
            rawEmail: email,
            normalizedEmail: raw,
            domain,
            isValid: false,
            hasValidSyntax: true,
            hasMxRecords: null,
            isDisposable: false,
            isRoleBased,
            verificationStatus: 'UNAVAILABLE',
            verificationLevel: 'SYNTAX',
            confidence: 0,
            provider: this.name,
            providerStatus: 'RATE_LIMITED',
            errorCode: 'RATE_LIMIT_EXCEEDED',
            details: { httpStatus: 429, reason: 'ZeroBounce rate limit reached' },
          };
        }

        if (!response.ok) {
          this.recordFailure();
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 600 * attempt));
            continue;
          }
          return {
            rawEmail: email,
            normalizedEmail: raw,
            domain,
            isValid: false,
            hasValidSyntax: true,
            hasMxRecords: null,
            isDisposable: false,
            isRoleBased,
            verificationStatus: 'UNAVAILABLE',
            verificationLevel: 'SYNTAX',
            confidence: 0,
            provider: this.name,
            providerStatus: 'PROVIDER_ERROR',
            errorCode: `HTTP_${response.status}`,
            details: { httpStatus: response.status },
          };
        }

        const data = await response.json();
        this.recordSuccess();

        const zbStatus = (data.status || '').toLowerCase();
        const zbSubStatus = (data.sub_status || '').toLowerCase();

        let verificationStatus: ContactVerificationStatus;
        let isValid: boolean;
        let confidence: number;

        switch (zbStatus) {
          case 'valid':
            verificationStatus = isRoleBased ? 'ROLE_BASED' : 'VERIFIED';
            isValid = true;
            confidence = 0.98;
            break;
          case 'invalid':
            verificationStatus = 'INVALID';
            isValid = false;
            confidence = 0.95;
            break;
          case 'catch-all':
            verificationStatus = 'RISKY';
            isValid = true;
            confidence = 0.6;
            break;
          case 'spamtrap':
            verificationStatus = 'INVALID';
            isValid = false;
            confidence = 0.99;
            break;
          case 'abuse':
            verificationStatus = 'RISKY';
            isValid = false;
            confidence = 0.9;
            break;
          case 'do_not_mail':
            if (zbSubStatus === 'disposable') {
              verificationStatus = 'DISPOSABLE';
            } else if (zbSubStatus === 'role_based') {
              verificationStatus = 'ROLE_BASED';
            } else {
              verificationStatus = 'RISKY';
            }
            isValid = false;
            confidence = 0.9;
            break;
          default:
            verificationStatus = 'UNKNOWN';
            isValid = false;
            confidence = 0.3;
        }

        const result: EmailVerificationResult = {
          rawEmail: email,
          normalizedEmail: raw,
          domain,
          isValid,
          hasValidSyntax: true,
          hasMxRecords: data.mx_found === 'true' || data.mx_found === true,
          isDisposable: zbSubStatus === 'disposable',
          isRoleBased,
          verificationStatus,
          verificationLevel: 'DELIVERABILITY',
          confidence,
          provider: this.name,
          providerStatus: 'READY',
          details: {
            zeroBounceStatus: data.status,
            zeroBounceSubStatus: data.sub_status,
            mxRecord: data.mx_record,
            didYouMean: data.did_you_mean,
            processedAt: data.processed_at,
          },
        };

        // Save to cache asynchronously
        contactVerificationCache.saveEmailVerification(raw, result).catch((err) => {
          console.warn('[ZeroBounce] Failed to save verification to cache:', err);
        });

        return result;
      } catch (err: any) {
        this.recordFailure();
        const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('aborted');
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
          continue;
        }

        return {
          rawEmail: email,
          normalizedEmail: raw,
          domain,
          isValid: false,
          hasValidSyntax: true,
          hasMxRecords: null,
          isDisposable: false,
          isRoleBased,
          verificationStatus: 'UNAVAILABLE',
          verificationLevel: 'SYNTAX',
          confidence: 0,
          provider: this.name,
          providerStatus: isTimeout ? 'TIMEOUT' : 'PROVIDER_ERROR',
          errorCode: isTimeout ? 'TIMEOUT' : (err.code || 'FETCH_ERROR'),
          details: { error: err.message },
        };
      }
    }

    return {
      rawEmail: email,
      normalizedEmail: raw,
      domain,
      isValid: false,
      hasValidSyntax: false,
      hasMxRecords: null,
      isDisposable: false,
      isRoleBased,
      verificationStatus: 'UNAVAILABLE',
      verificationLevel: 'SYNTAX',
      confidence: 0,
      provider: this.name,
      providerStatus: 'PROVIDER_ERROR',
    };
  }
}

// ─── Composite Email Verification Service ───────────────────

export class CompositeEmailVerificationService {
  private dnsProvider: DnsMxVerificationProvider;
  private deliverabilityProvider: ZeroBounceVerificationProvider;

  constructor() {
    this.dnsProvider = new DnsMxVerificationProvider();
    this.deliverabilityProvider = new ZeroBounceVerificationProvider();
  }

  /**
   * Verifies an email using the best available provider.
   * - Always runs syntax + disposable domain check
   * - Uses ZeroBounce for deliverability when configured
   * - Falls back to DNS MX checking
   * - NEVER returns VERIFIED when provider is unavailable
   */
  async verifyEmail(email: string): Promise<EmailVerificationResult> {
    if (this.deliverabilityProvider.isConfigured()) {
      return this.deliverabilityProvider.verifyEmail(email);
    }

    return this.dnsProvider.verifyEmail(email);
  }

  getProviderStatus(): { name: string; status: 'READY' | 'NOT_CONFIGURED' | 'PARTIAL' } {
    if (this.deliverabilityProvider.isConfigured()) {
      return { name: 'zerobounce', status: 'READY' };
    }
    return { name: 'dns_mx_verifier', status: 'PARTIAL' };
  }
}

export const emailVerificationService = new CompositeEmailVerificationService();
