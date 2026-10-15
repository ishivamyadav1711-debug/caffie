import { prisma } from '../prisma';
import { OutreachEligibilityService } from './outreachEligibility';
import { OutreachTemplateService } from './outreachTemplates';
import { OutreachProviderFactory } from './providers/providerFactory';
import { OutreachIdempotencyGuard } from './outreachIdempotency';
import { SendResult } from './providers/types';

export interface OutreachExecutionResult {
  success: boolean;
  outreachId?: string;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
  recipient: string;
  status: 'SENT' | 'QUEUED' | 'FAILED' | 'SUPPRESSED';
  provider: string;
  providerMessageId?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  subject?: string;
  message: string;
  evidenceUsed: string[];
  errorCode?: string;
  errorMessage?: string;
  businessName: string;
}

export class OutreachService {
  /**
   * One-click Outreach Execution:
   * 1. Pre-send eligibility & suppression check
   * 2. Evidence-grounded message generation
   * 3. Idempotency guard
   * 4. Real provider dispatch
   * 5. Canonical database recording
   * 6. Audit trail logging
   */
  static async sendOutreach(
    leadId: string,
    channelPreference?: 'EMAIL' | 'SMS' | 'WHATSAPP',
    campaignId?: string,
    userId?: string,
    customSubject?: string,
    customBody?: string
  ): Promise<OutreachExecutionResult> {
    // 1. Eligibility Check
    const eligibility = await OutreachEligibilityService.checkEligibility(leadId);
    if (!eligibility.canSendAny) {
      return {
        success: false,
        channel: channelPreference || 'EMAIL',
        recipient: 'None',
        status: 'FAILED',
        provider: 'none',
        message: '',
        evidenceUsed: [],
        errorCode: 'LEAD_NOT_ELIGIBLE',
        errorMessage: eligibility.reasons.join(' | ') || 'Lead has no eligible and configured outreach channels.',
        businessName: eligibility.businessName,
      };
    }

    // Determine target channel
    let selectedChannel: 'EMAIL' | 'SMS' | 'WHATSAPP' = eligibility.recommendedChannel as any;
    if (channelPreference) {
      if (channelPreference === 'EMAIL' && eligibility.email.eligible) {
        selectedChannel = 'EMAIL';
      } else if (channelPreference === 'SMS' && eligibility.sms.eligible) {
        selectedChannel = 'SMS';
      } else if (channelPreference === 'WHATSAPP' && eligibility.whatsapp.eligible) {
        selectedChannel = 'WHATSAPP';
      } else {
        const channelReason =
          channelPreference === 'EMAIL'
            ? eligibility.email.reason
            : channelPreference === 'SMS'
            ? eligibility.sms.reason
            : eligibility.whatsapp.reason;

        return {
          success: false,
          channel: channelPreference,
          recipient: 'None',
          status: 'FAILED',
          provider: 'none',
          message: '',
          evidenceUsed: [],
          errorCode: 'CHANNEL_INELIGIBLE',
          errorMessage: `Requested channel ${channelPreference} is not eligible: ${channelReason}`,
          businessName: eligibility.businessName,
        };
      }
    }

    const recipient =
      selectedChannel === 'EMAIL'
        ? eligibility.email.recipient!
        : selectedChannel === 'SMS'
        ? eligibility.sms.recipient!
        : eligibility.whatsapp.recipient!;

    // 2. Generate Evidence-Grounded Copy
    const generated = await OutreachTemplateService.generateMessage(leadId);
    if (!generated) {
      return {
        success: false,
        channel: selectedChannel,
        recipient,
        status: 'FAILED',
        provider: 'none',
        message: '',
        evidenceUsed: [],
        errorCode: 'TEMPLATE_GENERATION_FAILED',
        errorMessage: 'Unable to load evidence to generate outreach message.',
        businessName: eligibility.businessName,
      };
    }

    const subject = selectedChannel === 'EMAIL' 
      ? (customSubject && customSubject.trim().length > 0 ? customSubject.trim() : generated.subject)
      : undefined;

    const defaultBodyText =
      selectedChannel === 'EMAIL'
        ? generated.bodyText
        : selectedChannel === 'SMS'
        ? generated.smsMessage
        : generated.whatsAppMessage;

    const messageText = customBody && customBody.trim().length > 0 ? customBody.trim() : defaultBodyText;

    // 3. Duplicate / Idempotency Check
    const idempotencyKey = OutreachIdempotencyGuard.generateKey(leadId, selectedChannel, recipient);
    const dupCheck = await OutreachIdempotencyGuard.checkDuplicate(leadId, selectedChannel, recipient);
    if (dupCheck.hasDuplicate) {
      return {
        success: false,
        channel: selectedChannel,
        recipient,
        status: 'FAILED',
        provider: 'none',
        message: messageText,
        evidenceUsed: generated.evidenceUsed,
        errorCode: 'DUPLICATE_OUTREACH',
        errorMessage: dupCheck.reason || 'Duplicate outreach attempt blocked by idempotency guard.',
        businessName: eligibility.businessName,
      };
    }

    // 4. Create PENDING Outreach record in Database
    // If campaign has a senderAccountId, link the outreach to it
    let campaignSenderAccountId: string | undefined;
    if (campaignId) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { senderAccountId: true },
      });
      campaignSenderAccountId = campaign?.senderAccountId ?? undefined;
    }

    const outreachRecord = await prisma.outreach.create({
      data: {
        businessId: leadId,
        campaignId,
        channel: selectedChannel,
        recipient,
        subject,
        message: messageText,
        status: 'SENDING',
        verificationStatus: 'VERIFIED',
        evidenceUsed: JSON.stringify(generated.evidenceUsed),
        excelSyncStatus: 'PENDING',
        senderAccountId: campaignSenderAccountId ?? null,
      },
    });

    // 5. Audit Log: OUTREACH_CREATED
    await prisma.outreachAuditLog.create({
      data: {
        userId,
        businessId: leadId,
        outreachId: outreachRecord.id,
        action: 'OUTREACH_CREATED',
        channel: selectedChannel,
        metadata: JSON.stringify({ recipient, idempotencyKey }),
      },
    });

    // 6. Execute Dispatch through Real Provider
    let sendResult: SendResult;

    if (selectedChannel === 'EMAIL') {
      // Determine whether to use Gmail or legacy provider
      if (campaignSenderAccountId && userId) {
        // Gmail campaign — use Gmail provider exclusively, NO Resend/SendGrid fallback
        const gmailProvider = OutreachProviderFactory.getGmailProvider();
        sendResult = await gmailProvider.sendEmail({
          to: recipient,
          subject: generated.subject,
          bodyText: generated.bodyText,
          bodyHtml: generated.bodyHtml,
          businessName: generated.businessName,
          leadId,
          idempotencyKey,
          senderAccountId: campaignSenderAccountId,
          userId,
        } as any);
      } else {
        // Legacy path — Resend/SendGrid (no senderAccount linked)
        const provider = OutreachProviderFactory.getEmailProvider();
        sendResult = await provider.sendEmail({
          to: recipient,
          subject: generated.subject,
          bodyText: generated.bodyText,
          bodyHtml: generated.bodyHtml,
          businessName: generated.businessName,
          leadId,
          idempotencyKey,
        });
      }
    } else if (selectedChannel === 'SMS') {
      const provider = OutreachProviderFactory.getSmsProvider();
      sendResult = await provider.sendSms({
        to: recipient,
        message: generated.smsMessage,
        leadId,
        idempotencyKey,
      });
    } else {
      const provider = OutreachProviderFactory.getWhatsAppProvider();
      sendResult = await provider.sendMessage({
        to: recipient,
        message: generated.whatsAppMessage,
        leadId,
        idempotencyKey,
      });
    }

    // 7. Update Database with Real Provider Response
    const now = new Date();
    if (sendResult.success) {
      await prisma.outreach.update({
        where: { id: outreachRecord.id },
        data: {
          status: 'SENT',
          provider: sendResult.provider,
          providerMessageId: sendResult.providerMessageId,
          // Persist Gmail messageId and threadId if available
          ...(sendResult.gmailMessageId
            ? { gmailMessageId: sendResult.gmailMessageId }
            : {}),
          ...(sendResult.gmailThreadId
            ? { gmailThreadId: sendResult.gmailThreadId }
            : {}),
          sentAt: now,
          excelSyncStatus: 'SYNCED',
        },
      });

      // Update business status
      await prisma.business.update({
        where: { id: leadId },
        data: { status: 'Contacted' },
      }).catch(() => {});

      // Audit Log: OUTREACH_SENT
      await prisma.outreachAuditLog.create({
        data: {
          userId,
          businessId: leadId,
          outreachId: outreachRecord.id,
          action: 'OUTREACH_SENT',
          channel: selectedChannel,
          provider: sendResult.provider,
          metadata: JSON.stringify({
            providerMessageId: sendResult.providerMessageId,
            gmailMessageId: sendResult.gmailMessageId,
            gmailThreadId: sendResult.gmailThreadId,
            sentAt: now.toISOString(),
          }),
        },
      });

      return {
        success: true,
        outreachId: outreachRecord.id,
        channel: selectedChannel,
        recipient,
        status: 'SENT',
        provider: sendResult.provider,
        providerMessageId: sendResult.providerMessageId,
        gmailMessageId: sendResult.gmailMessageId,
        gmailThreadId: sendResult.gmailThreadId,
        subject,
        message: messageText,
        evidenceUsed: generated.evidenceUsed,
        businessName: generated.businessName,
      };
    } else {
      // Failed dispatch
      await prisma.outreach.update({
        where: { id: outreachRecord.id },
        data: {
          status: 'FAILED',
          provider: sendResult.provider,
          errorCode: sendResult.errorCode,
          errorMessage: sendResult.errorMessage,
          failedAt: now,
        },
      });

      // Audit Log: OUTREACH_FAILED
      await prisma.outreachAuditLog.create({
        data: {
          userId,
          businessId: leadId,
          outreachId: outreachRecord.id,
          action: 'OUTREACH_FAILED',
          channel: selectedChannel,
          provider: sendResult.provider,
          metadata: JSON.stringify({
            errorCode: sendResult.errorCode,
            errorMessage: sendResult.errorMessage,
          }),
        },
      });

      return {
        success: false,
        outreachId: outreachRecord.id,
        channel: selectedChannel,
        recipient,
        status: 'FAILED',
        provider: sendResult.provider,
        errorCode: sendResult.errorCode,
        errorMessage: sendResult.errorMessage || 'Provider failed to transmit message.',
        subject,
        message: messageText,
        evidenceUsed: generated.evidenceUsed,
        businessName: generated.businessName,
      };
    }
  }
}
