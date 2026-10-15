/**
 * Canonical Contact Types & Verification States for LeadPilot
 * 
 * RULES:
 * - NO FAKE DATA. Contacts only exist if actually discovered.
 * - NEVER mark unverified as VERIFIED.
 * - NEVER mark provider-unavailable as VERIFIED.
 * - Every contact must have provenance (source + sourceUrl).
 */

// ─── Contact Type ───────────────────────────────────────────

export type ContactType = 'PHONE' | 'EMAIL' | 'WHATSAPP' | 'CONTACT_FORM' | 'SOCIAL' | 'OTHER';

// ─── Verification Status ────────────────────────────────────

export type ContactVerificationStatus =
  | 'UNKNOWN'
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'INVALID'
  | 'RISKY'
  | 'BOUNCED'
  | 'DISPOSABLE'
  | 'ROLE_BASED'
  | 'LANDLINE'
  | 'MOBILE'
  | 'VOIP'
  | 'UNAVAILABLE';    // Provider not configured or failed

// ─── Provider Operational Status ────────────────────────────

export type ProviderOperationalStatus =
  | 'READY'
  | 'NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'AUTH_FAILED'
  | 'PROVIDER_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'UNAVAILABLE';

// ─── Verification Level ─────────────────────────────────────

export type VerificationLevel =
  | 'SYNTAX'          // format/regex only
  | 'DOMAIN'          // domain exists
  | 'MX'              // mail exchange records exist
  | 'DELIVERABILITY'  // mailbox confirmed (external provider)
  | 'CARRIER';        // phone carrier lookup (external provider)

// ─── Phone Line Type ────────────────────────────────────────

export type PhoneLineType = 'MOBILE' | 'LANDLINE' | 'VOIP' | 'UNKNOWN';

// ─── Canonical Contact Record ───────────────────────────────

export interface CanonicalContact {
  contactType: ContactType;
  rawValue: string;
  normalizedValue: string;
  source: string;           // google_places | osm | official_website | web_search
  sourceUrl?: string;       // The URL where this contact was found
  sourceProvider?: string;  // Provider that discovered this
  confidence: number;       // 0.0 - 1.0
  verificationStatus: ContactVerificationStatus;
  verifiedAt?: string;
  isPrimary: boolean;
  isPublic: boolean;
  isRoleBased: boolean;
  isDisposable: boolean;
  evidence?: string;        // Extraction evidence (e.g., "mailto:hello@abc.in" or "tel:+919876543210")
  metadata?: Record<string, any>;

  // Phone-specific
  countryCode?: string;
  lineType?: PhoneLineType;

  // Email-specific
  domain?: string;
}

// ─── Contact Quality ────────────────────────────────────────

export type ContactQualityLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface ContactQualityAssessment {
  level: ContactQualityLevel;
  hasPhone: boolean;
  hasEmail: boolean;
  hasVerifiedPhone: boolean;
  hasVerifiedEmail: boolean;
  hasContact: boolean;
  hasVerifiedContact: boolean;
  phoneCount: number;
  emailCount: number;
  verifiedPhoneCount: number;
  verifiedEmailCount: number;
  explanation: string;
}

/**
 * Calculates a transparent contact quality assessment from actual contact records.
 * 
 * HIGH:    Verified phone + verified email
 * MEDIUM:  Verified phone OR verified email
 * LOW:     Public but unverified contact
 * NONE:    No usable contact
 */
export function assessContactQuality(contacts: CanonicalContact[]): ContactQualityAssessment {
  const phones = contacts.filter(c => c.contactType === 'PHONE');
  const emails = contacts.filter(c => c.contactType === 'EMAIL');

  const verifiedStatuses = new Set<ContactVerificationStatus>(['VERIFIED', 'MOBILE', 'LANDLINE']);
  const usableStatuses = new Set<ContactVerificationStatus>([
    'VERIFIED', 'MOBILE', 'LANDLINE', 'VOIP', 'UNVERIFIED', 'UNKNOWN',
  ]);

  const usablePhones = phones.filter(c => usableStatuses.has(c.verificationStatus));
  const usableEmails = emails.filter(c => usableStatuses.has(c.verificationStatus));
  const verifiedPhones = phones.filter(c => verifiedStatuses.has(c.verificationStatus));
  const verifiedEmails = emails.filter(c => c.verificationStatus === 'VERIFIED');

  const hasPhone = usablePhones.length > 0;
  const hasEmail = usableEmails.length > 0;
  const hasVerifiedPhone = verifiedPhones.length > 0;
  const hasVerifiedEmail = verifiedEmails.length > 0;
  const hasContact = hasPhone || hasEmail;
  const hasVerifiedContact = hasVerifiedPhone || hasVerifiedEmail;

  let level: ContactQualityLevel;
  let explanation: string;

  if (hasVerifiedPhone && hasVerifiedEmail) {
    level = 'HIGH';
    explanation = 'Verified phone + verified email available';
  } else if (hasVerifiedPhone || hasVerifiedEmail) {
    level = 'MEDIUM';
    explanation = hasVerifiedPhone ? 'Verified phone available' : 'Verified email available';
  } else if (hasContact) {
    level = 'LOW';
    explanation = 'Public contact available but unverified';
  } else {
    level = 'NONE';
    explanation = 'No usable contact information';
  }

  return {
    level,
    hasPhone,
    hasEmail,
    hasVerifiedPhone,
    hasVerifiedEmail,
    hasContact,
    hasVerifiedContact,
    phoneCount: usablePhones.length,
    emailCount: usableEmails.length,
    verifiedPhoneCount: verifiedPhones.length,
    verifiedEmailCount: verifiedEmails.length,
    explanation,
  };
}

// ─── Contact Filter Evaluation ──────────────────────────────

export type ExtendedContactFilterType =
  | 'ALL_CONTACTS'
  | 'EMAIL_AND_PHONE'
  | 'EMAIL_ONLY'
  | 'PHONE_ONLY'
  | 'PHONE_OR_EMAIL'
  | 'NO_CONTACT'
  | 'VERIFIED_PHONE'
  | 'VERIFIED_EMAIL'
  | 'VERIFIED_PHONE_OR_EMAIL'
  | 'VERIFIED_PHONE_AND_EMAIL';

/**
 * Normalizes frontend contact filter strings to canonical enum values.
 */
export function normalizeContactFilter(raw?: string): ExtendedContactFilterType {
  if (!raw) return 'ALL_CONTACTS';
  const norm = raw.toUpperCase().replace(/[\s_-]+/g, '_').replace(/\+/g, 'AND');

  if (norm === 'ALL_CONTACTS' || norm === 'ANY_CONTACT' || norm === 'ANY') return 'ALL_CONTACTS';
  if (norm === 'EMAIL_AND_PHONE' || norm === 'EMAILANDPHONE' || norm === 'EMAIL_PHONE') return 'EMAIL_AND_PHONE';
  if (norm === 'EMAIL_ONLY' || norm === 'HAS_EMAIL') return 'EMAIL_ONLY';
  if (norm === 'PHONE_ONLY' || norm === 'HAS_PHONE') return 'PHONE_ONLY';
  if (norm === 'PHONE_OR_EMAIL' || norm === 'HAS_PHONE_OR_EMAIL') return 'PHONE_OR_EMAIL';
  if (norm === 'NO_CONTACT') return 'NO_CONTACT';
  if (norm === 'VERIFIED_PHONE') return 'VERIFIED_PHONE';
  if (norm === 'VERIFIED_EMAIL') return 'VERIFIED_EMAIL';
  if (norm === 'VERIFIED_PHONE_OR_EMAIL') return 'VERIFIED_PHONE_OR_EMAIL';
  if (norm === 'VERIFIED_PHONE_AND_EMAIL') return 'VERIFIED_PHONE_AND_EMAIL';

  return 'ALL_CONTACTS';
}

/**
 * Evaluates whether a business's contacts pass a contact filter.
 * Returns { match, reason } where reason is the rejection reason if !match.
 */
export function evaluateContactFilter(
  filter: ExtendedContactFilterType,
  quality: ContactQualityAssessment
): { match: boolean; reason?: string } {
  switch (filter) {
    case 'ALL_CONTACTS':
      return { match: true };

    case 'PHONE_OR_EMAIL':
      return quality.hasContact
        ? { match: true }
        : { match: false, reason: 'CONTACT_FILTER_MISMATCH' };

    case 'PHONE_ONLY':
      return quality.hasPhone
        ? { match: true }
        : { match: false, reason: 'CONTACT_FILTER_MISMATCH' };

    case 'EMAIL_ONLY':
      return quality.hasEmail
        ? { match: true }
        : { match: false, reason: 'CONTACT_FILTER_MISMATCH' };

    case 'EMAIL_AND_PHONE':
      return quality.hasPhone && quality.hasEmail
        ? { match: true }
        : { match: false, reason: 'CONTACT_FILTER_MISMATCH' };

    case 'VERIFIED_PHONE':
      return quality.hasVerifiedPhone
        ? { match: true }
        : { match: false, reason: 'CONTACT_FILTER_MISMATCH' };

    case 'VERIFIED_EMAIL':
      return quality.hasVerifiedEmail
        ? { match: true }
        : { match: false, reason: 'CONTACT_FILTER_MISMATCH' };

    case 'VERIFIED_PHONE_OR_EMAIL':
      return quality.hasVerifiedContact
        ? { match: true }
        : { match: false, reason: 'CONTACT_FILTER_MISMATCH' };

    case 'VERIFIED_PHONE_AND_EMAIL':
      return quality.hasVerifiedPhone && quality.hasVerifiedEmail
        ? { match: true }
        : { match: false, reason: 'CONTACT_FILTER_MISMATCH' };

    case 'NO_CONTACT':
      return !quality.hasContact
        ? { match: true }
        : { match: false, reason: 'CONTACT_FILTER_MISMATCH' };

    default:
      return { match: true };
  }
}
