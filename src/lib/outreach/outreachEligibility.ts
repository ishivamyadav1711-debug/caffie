import { prisma } from '../prisma';
import { SuppressionService } from './suppressionService';
import { OutreachIdempotencyGuard } from './outreachIdempotency';
import { OutreachProviderFactory } from './providers/providerFactory';
import { isValidPhoneNumber, parsePhoneNumber } from 'libphonenumber-js';

export interface ChannelEligibility {
  eligible: boolean;
  recipient?: string;
  reason?: string;
  providerConfigured: boolean;
  providerName: string;
}

export interface OutreachEligibilityResult {
  leadId: string;
  businessName: string;
  canSendAny: boolean;
  email: ChannelEligibility;
  sms: ChannelEligibility;
  whatsapp: ChannelEligibility;
  reasons: string[];
  recommendedChannel: 'EMAIL' | 'SMS' | 'WHATSAPP' | 'NONE';
}

export class OutreachEligibilityService {
  /**
   * Evaluates end-to-end outreach eligibility across Email, SMS, and WhatsApp.
   * Enforces verification status, suppression, duplicate cooldown, and provider readiness.
   */
  static async checkEligibility(leadId: string): Promise<OutreachEligibilityResult> {
    if (leadId.startsWith('mock_') || leadId.toLowerCase().includes('demo')) {
      return {
        leadId,
        businessName: 'Mock Demo Business',
        canSendAny: false,
        email: { eligible: false, providerConfigured: false, providerName: 'none', reason: 'Outreach is strictly disabled for synthetic demo/mock records.' },
        sms: { eligible: false, providerConfigured: false, providerName: 'none', reason: 'Outreach is strictly disabled for synthetic demo/mock records.' },
        whatsapp: { eligible: false, providerConfigured: false, providerName: 'none', reason: 'Outreach is strictly disabled for synthetic demo/mock records.' },
        reasons: ['Outreach is strictly disabled for synthetic demo/mock records.'],
        recommendedChannel: 'NONE',
      };
    }

    const business = await prisma.business.findUnique({
      where: { id: leadId },
      include: {
        contacts: true,
        outreach: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    if (!business) {
      return {
        leadId,
        businessName: 'Unknown Business',
        canSendAny: false,
        email: { eligible: false, providerConfigured: false, providerName: 'none', reason: 'Lead not found in database.' },
        sms: { eligible: false, providerConfigured: false, providerName: 'none', reason: 'Lead not found in database.' },
        whatsapp: { eligible: false, providerConfigured: false, providerName: 'none', reason: 'Lead not found in database.' },
        reasons: ['Lead not found in canonical database.'],
        recommendedChannel: 'NONE',
      };
    }

    if ((business as any).isMock) {
      return {
        leadId,
        businessName: business.name,
        canSendAny: false,
        email: { eligible: false, providerConfigured: false, providerName: 'none', reason: 'Outreach is strictly disabled for synthetic demo/mock records.' },
        sms: { eligible: false, providerConfigured: false, providerName: 'none', reason: 'Outreach is strictly disabled for synthetic demo/mock records.' },
        whatsapp: { eligible: false, providerConfigured: false, providerName: 'none', reason: 'Outreach is strictly disabled for synthetic demo/mock records.' },
        reasons: ['Outreach is strictly disabled for synthetic demo/mock records.'],
        recommendedChannel: 'NONE',
      };
    }

    const emailProvider = OutreachProviderFactory.getEmailProvider();
    const smsProvider = OutreachProviderFactory.getSmsProvider();
    const whatsAppProvider = OutreachProviderFactory.getWhatsAppProvider();

    const reasons: string[] = [];

    // --- 1. EMAIL ELIGIBILITY ---
    let emailEligible = false;
    let emailReason = '';
    const rawEmail = (business.email || business.contacts[0]?.email || '').trim().toLowerCase();

    if (!rawEmail) {
      emailReason = 'No email address registered for this business.';
    } else if (rawEmail.endsWith('.invalid') || rawEmail.endsWith('.example') || rawEmail.includes('@example.')) {
      emailReason = 'Outreach is disabled for mock/demo email addresses.';
    } else {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/;
      if (!emailRegex.test(rawEmail)) {
        emailReason = `Email syntax invalid: ${rawEmail}`;
      } else {
        const suppression = await SuppressionService.isSuppressed(rawEmail, 'EMAIL');
        if (suppression.isSuppressed) {
          emailReason = `Email is suppressed (${suppression.reason}).`;
        } else {
          const duplicate = await OutreachIdempotencyGuard.checkDuplicate(leadId, 'EMAIL', rawEmail);
          if (duplicate.hasDuplicate) {
            emailReason = duplicate.reason || 'Outreach already sent or in-flight.';
          } else {
            emailEligible = true;
            if (!emailProvider.isConfigured()) {
              emailReason = 'Email provider (Resend/SendGrid) is not configured in environment.';
            }
          }
        }
      }
    }

    // --- 2. PHONE / SMS ELIGIBILITY ---
    let smsEligible = false;
    let smsReason = '';
    let normalizedPhone: string | undefined = undefined;
    const rawPhone = (business.phone || business.contacts[0]?.phone || '').trim();

    if (!rawPhone) {
      smsReason = 'No telephone number registered for this business.';
    } else if (rawPhone.includes('555-01') || rawPhone.includes('55501') || rawPhone.startsWith('+1555')) {
      smsReason = 'Outreach is disabled for fictional demo phone numbers.';
    } else {
      try {
        if (isValidPhoneNumber(rawPhone, 'IN')) {
          const parsed = parsePhoneNumber(rawPhone, 'IN');
          normalizedPhone = parsed.format('E.164');
        } else if (isValidPhoneNumber(rawPhone)) {
          const parsed = parsePhoneNumber(rawPhone);
          normalizedPhone = parsed.format('E.164');
        }
      } catch {}

      if (!normalizedPhone) {
        smsReason = `Telephone number ${rawPhone} is not a valid E.164 number.`;
      } else {
        const suppression = await SuppressionService.isSuppressed(normalizedPhone, 'SMS');
        if (suppression.isSuppressed) {
          smsReason = `Phone number is suppressed (${suppression.reason}).`;
        } else {
          const duplicate = await OutreachIdempotencyGuard.checkDuplicate(leadId, 'SMS', normalizedPhone);
          if (duplicate.hasDuplicate) {
            smsReason = duplicate.reason || 'SMS outreach already sent or in-flight.';
          } else {
            smsEligible = true;
            if (!smsProvider.isConfigured()) {
              smsReason = 'SMS provider (Twilio) is not configured in environment.';
            }
          }
        }
      }
    }

    // --- 3. WHATSAPP ELIGIBILITY ---
    let whatsAppEligible = false;
    let whatsAppReason = '';

    if (!normalizedPhone) {
      whatsAppReason = smsReason || 'No valid E.164 phone available for WhatsApp.';
    } else {
      const suppression = await SuppressionService.isSuppressed(normalizedPhone, 'WHATSAPP');
      if (suppression.isSuppressed) {
        whatsAppReason = `Phone number is suppressed for WhatsApp (${suppression.reason}).`;
      } else {
        const duplicate = await OutreachIdempotencyGuard.checkDuplicate(leadId, 'WHATSAPP', normalizedPhone);
        if (duplicate.hasDuplicate) {
          whatsAppReason = duplicate.reason || 'WhatsApp outreach already sent or in-flight.';
        } else {
          whatsAppEligible = true;
          if (!whatsAppProvider.isConfigured()) {
            whatsAppReason = 'Meta WhatsApp Business API is not configured in environment.';
          }
        }
      }
    }

    // Determine recommended channel (Email preferred for B2B, then WhatsApp, then SMS)
    let recommendedChannel: 'EMAIL' | 'SMS' | 'WHATSAPP' | 'NONE' = 'NONE';
    if (emailEligible) recommendedChannel = 'EMAIL';
    else if (whatsAppEligible) recommendedChannel = 'WHATSAPP';
    else if (smsEligible) recommendedChannel = 'SMS';

    if (emailReason) reasons.push(`Email: ${emailReason}`);
    if (smsReason) reasons.push(`SMS: ${smsReason}`);
    if (whatsAppReason) reasons.push(`WhatsApp: ${whatsAppReason}`);

    return {
      leadId,
      businessName: business.name,
      canSendAny: emailEligible || smsEligible || whatsAppEligible,
      email: {
        eligible: emailEligible,
        recipient: rawEmail || undefined,
        reason: emailReason || undefined,
        providerConfigured: emailProvider.isConfigured(),
        providerName: emailProvider.name,
      },
      sms: {
        eligible: smsEligible,
        recipient: normalizedPhone || rawPhone || undefined,
        reason: smsReason || undefined,
        providerConfigured: smsProvider.isConfigured(),
        providerName: smsProvider.name,
      },
      whatsapp: {
        eligible: whatsAppEligible,
        recipient: normalizedPhone || rawPhone || undefined,
        reason: whatsAppReason || undefined,
        providerConfigured: whatsAppProvider.isConfigured(),
        providerName: whatsAppProvider.name,
      },
      reasons,
      recommendedChannel,
    };
  }
}
