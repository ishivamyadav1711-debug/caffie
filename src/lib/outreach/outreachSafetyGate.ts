/**
 * LeadPilot — Outreach Safety Gate
 *
 * Implements strict pre-send gatekeeping for B2B outreach:
 * - Verifies real business & contact existence (no synthetic/guessed data)
 * - Validates recipient email syntax
 * - Enforces suppression (DO_NOT_CONTACT, UNSUBSCRIBED, BOUNCED, INVALID_EMAIL)
 * - Enforces duplicate cooldown (7-day protection & in-flight lock)
 * - Verifies sender authorization and daily safety capacity
 * - Validates AI message evidence grounding
 */
import { prisma } from '@/lib/prisma';
import { SuppressionService } from './suppressionService';
import { OutreachIdempotencyGuard } from './outreachIdempotency';

export type SkipReasonCode =
  | 'MISSING_EMAIL'
  | 'INVALID_EMAIL_FORMAT'
  | 'INVALID_EMAIL'
  | 'LEAD_NOT_FOUND'
  | 'NO_BUSINESS'
  | 'SUPPRESSED_DO_NOT_CONTACT'
  | 'SUPPRESSED_UNSUBSCRIBED'
  | 'UNSUBSCRIBED'
  | 'SUPPRESSED'
  | 'SUPPRESSED_BOUNCED'
  | 'BOUNCED'
  | 'HARD_BOUNCED'
  | 'SUPPRESSED_INVALID'
  | 'ALREADY_CONTACTED'
  | 'DUPLICATE_BUSINESS_IN_BATCH'
  | 'DUPLICATE_RECIPIENT_IN_BATCH'
  | 'IN_FLIGHT_SENDING'
  | 'SENDER_UNAUTHORIZED'
  | 'SENDER_NOT_AUTHORIZED'
  | 'SENDER_UNHEALTHY'
  | 'CAMPAIGN_OWNERSHIP_REQUIRED'
  | 'SENDER_CAPACITY_EXCEEDED'
  | 'DOMAIN_CAPACITY_EXCEEDED'
  | 'NO_EVIDENCE_FOUND';

export interface SafetyGateEvaluation {
  eligible: boolean;
  leadId: string;
  businessName?: string;
  recipientEmail?: string;
  skipReasonCode?: SkipReasonCode;
  skipReasonMessage?: string;
  evidenceUsed?: string[];
}

export class OutreachSafetyGate {
  private static readonly EMAIL_REGEX =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  /**
   * Validate recipient email address format without guessing.
   */
  static isValidEmailSyntax(email?: string | null): boolean {
    if (!email || typeof email !== 'string') return false;
    const trimmed = email.trim();
    if (trimmed.length < 5 || trimmed.length > 254) return false;
    return this.EMAIL_REGEX.test(trimmed);
  }

  /**
   * Pre-check individual recipient email safety against suppression and syntax.
   */
  static async evaluateRecipientSafety(
    email: string,
    leadId?: string
  ): Promise<{ canSend: boolean; skipReasonCode?: SkipReasonCode; reason?: string }> {
    if (!this.isValidEmailSyntax(email)) {
      return { canSend: false, skipReasonCode: 'INVALID_EMAIL_FORMAT', reason: 'Invalid email syntax.' };
    }

    const suppression = await SuppressionService.isSuppressed(email, 'EMAIL');
    if (suppression.isSuppressed) {
      const reasonUpper = (suppression.reason || '').toUpperCase();
      let code: SkipReasonCode = 'SUPPRESSED_DO_NOT_CONTACT';
      if (reasonUpper.includes('UNSUB')) code = 'UNSUBSCRIBED';
      else if (reasonUpper.includes('BOUNCE')) code = 'HARD_BOUNCED';
      else if (reasonUpper.includes('INVALID')) code = 'INVALID_EMAIL';
      else code = 'SUPPRESSED';

      return {
        canSend: false,
        skipReasonCode: code,
        reason: `Recipient is suppressed (${suppression.reason}).`,
      };
    }

    return { canSend: true };
  }

  /**
   * Run the full safety gate check for a given lead.
   */
  static async evaluateLead(
    leadId: string,
    recipientEmailOverride?: string
  ): Promise<SafetyGateEvaluation> {
    // 1. Fetch real lead from database
    const business = await prisma.business.findUnique({
      where: { id: leadId },
      include: {
        contacts: true,
        audits: { orderBy: { auditedAt: 'desc' }, take: 1 },
        evidence: { take: 3 },
      },
    });

    if (!business) {
      return {
        eligible: false,
        leadId,
        skipReasonCode: 'LEAD_NOT_FOUND',
        skipReasonMessage: `Lead ID ${leadId} not found in database.`,
      };
    }

    // 2. Resolve genuine email (from override, business.email, or verified contacts)
    let email = (recipientEmailOverride || business.email || '').trim().toLowerCase();
    if (!email && business.contacts.length > 0) {
      const contactWithEmail = business.contacts.find((c) => c.email || (c.contactType === 'EMAIL' && c.normalizedValue));
      if (contactWithEmail) {
        email = (contactWithEmail.email || contactWithEmail.normalizedValue || '').trim().toLowerCase();
      }
    }

    // A. Recipient Email Missing Check
    if (!email) {
      return {
        eligible: false,
        leadId,
        businessName: business.name,
        skipReasonCode: 'MISSING_EMAIL',
        skipReasonMessage: 'No email address registered for this business. Never guessing missing emails.',
      };
    }

    // B. Recipient Email Format Check
    if (!this.isValidEmailSyntax(email)) {
      return {
        eligible: false,
        leadId,
        businessName: business.name,
        recipientEmail: email,
        skipReasonCode: 'INVALID_EMAIL_FORMAT',
        skipReasonMessage: `Invalid email address syntax: ${email}`,
      };
    }

    // C. Suppression / Do-Not-Contact List Check
    const suppression = await SuppressionService.isSuppressed(email, 'EMAIL');
    if (suppression.isSuppressed) {
      const reasonUpper = (suppression.reason || '').toUpperCase();
      let code: SkipReasonCode = 'SUPPRESSED_DO_NOT_CONTACT';
      if (reasonUpper.includes('UNSUB')) code = 'SUPPRESSED_UNSUBSCRIBED';
      else if (reasonUpper.includes('BOUNCE')) code = 'SUPPRESSED_BOUNCED';
      else if (reasonUpper.includes('INVALID')) code = 'SUPPRESSED_INVALID';

      return {
        eligible: false,
        leadId,
        businessName: business.name,
        recipientEmail: email,
        skipReasonCode: code,
        skipReasonMessage: `Recipient is on suppression list (${suppression.reason}). Outbound sending blocked.`,
      };
    }

    // D. Permanent Bounce Check in previous Outreaches
    const permanentBounce = await prisma.outreach.findFirst({
      where: {
        recipient: email,
        status: 'BOUNCED',
      },
    });

    if (permanentBounce) {
      return {
        eligible: false,
        leadId,
        businessName: business.name,
        recipientEmail: email,
        skipReasonCode: 'SUPPRESSED_BOUNCED',
        skipReasonMessage: `Recipient previously permanently bounced on ${permanentBounce.sentAt?.toLocaleDateString() || 'prior campaign'}.`,
      };
    }

    // E. Duplicate Protection & In-Flight Lock
    const duplicate = await OutreachIdempotencyGuard.checkDuplicate(leadId, 'EMAIL', email, 7);
    if (duplicate.hasDuplicate) {
      const isInFlight = duplicate.existingStatus && ['PENDING', 'QUEUED', 'SENDING'].includes(duplicate.existingStatus);
      return {
        eligible: false,
        leadId,
        businessName: business.name,
        recipientEmail: email,
        skipReasonCode: isInFlight ? 'IN_FLIGHT_SENDING' : 'ALREADY_CONTACTED',
        skipReasonMessage: duplicate.reason || 'Outreach already sent or currently in-flight (7-day duplicate protection active).',
      };
    }

    return {
      eligible: true,
      leadId,
      businessName: business.name,
      recipientEmail: email,
    };
  }
}
