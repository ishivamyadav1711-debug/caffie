/**
 * LeadPilot — Ownership Guard
 *
 * Enforces user ownership on campaigns, sender accounts, outreach,
 * replies, and leads.
 *
 * RULES:
 * - Campaign must belong to the authenticated user (campaign.userId === userId)
 * - Sender account must belong to the user (senderAccount.userId === userId)
 * - Campaign's sender account must be validated before sending
 * - Outreach records are created with user context
 */
import { prisma } from '../prisma';

export interface OwnershipCheckResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
  campaign?: any;
  senderAccount?: any;
}

export class OwnershipGuard {
  /**
   * Validate that a campaign belongs to the user and has a valid Gmail sender.
   * Returns the campaign and senderAccount if valid.
   */
  static async validateCampaignOwnership(
    userId: string,
    campaignId: string
  ): Promise<OwnershipCheckResult> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { senderAccount: true },
    });

    if (!campaign) {
      return {
        valid: false,
        errorCode: 'CAMPAIGN_NOT_FOUND',
        errorMessage: 'Campaign does not exist.',
      };
    }

    // Check campaign ownership - strictly require campaign.userId to exist and match authenticated user
    if (!campaign.userId || campaign.userId !== userId) {
      return {
        valid: false,
        errorCode: 'CAMPAIGN_OWNERSHIP_VIOLATION',
        errorMessage: 'This campaign does not belong to the authenticated user.',
      };
    }

    return { valid: true, campaign };
  }

  /**
   * Validate that a campaign has a connected Gmail sender that belongs to the user.
   */
  static async validateCampaignSender(
    userId: string,
    campaignId: string
  ): Promise<OwnershipCheckResult> {
    const ownership = await this.validateCampaignOwnership(userId, campaignId);
    if (!ownership.valid) return ownership;

    const campaign = ownership.campaign;

    if (!campaign.senderAccountId) {
      return {
        valid: false,
        errorCode: 'GMAIL_AUTHORIZATION_REQUIRED',
        errorMessage:
          'No sender account linked to this campaign. Connect Gmail first.',
        campaign,
      };
    }

    const senderAccount = campaign.senderAccount;

    if (!senderAccount) {
      return {
        valid: false,
        errorCode: 'GMAIL_AUTHORIZATION_REQUIRED',
        errorMessage: 'Sender account not found.',
        campaign,
      };
    }

    // Verify sender belongs to the user
    if (senderAccount.userId !== userId) {
      return {
        valid: false,
        errorCode: 'SENDER_OWNERSHIP_VIOLATION',
        errorMessage: 'The sender account does not belong to the authenticated user.',
        campaign,
      };
    }

    if (senderAccount.status !== 'CONNECTED') {
      return {
        valid: false,
        errorCode: 'GMAIL_AUTHORIZATION_REQUIRED',
        errorMessage: `Gmail sender is ${senderAccount.status}. Re-authorize Gmail.`,
        campaign,
        senderAccount,
      };
    }

    return { valid: true, campaign, senderAccount };
  }

  /**
   * Validate that a sender account belongs to the user.
   */
  static async validateSenderOwnership(
    userId: string,
    senderAccountId: string
  ): Promise<OwnershipCheckResult> {
    const senderAccount = await prisma.senderAccount.findUnique({
      where: { id: senderAccountId },
    });

    if (!senderAccount) {
      return {
        valid: false,
        errorCode: 'SENDER_NOT_FOUND',
        errorMessage: 'Sender account does not exist.',
      };
    }

    if (senderAccount.userId !== userId) {
      return {
        valid: false,
        errorCode: 'SENDER_OWNERSHIP_VIOLATION',
        errorMessage: 'This sender account does not belong to the authenticated user.',
      };
    }

    return { valid: true, senderAccount };
  }

  /**
   * Validate that an outreach record belongs to the user (via its campaign).
   */
  static async validateOutreachOwnership(
    userId: string,
    outreachId: string
  ): Promise<OwnershipCheckResult> {
    const outreach = await prisma.outreach.findUnique({
      where: { id: outreachId },
      include: { campaign: true },
    });

    if (!outreach) {
      return {
        valid: false,
        errorCode: 'OUTREACH_NOT_FOUND',
        errorMessage: 'Outreach record not found.',
      };
    }

    if (outreach.campaign && (!outreach.campaign.userId || outreach.campaign.userId !== userId)) {
      return {
        valid: false,
        errorCode: 'OUTREACH_OWNERSHIP_VIOLATION',
        errorMessage: 'This outreach does not belong to the authenticated user.',
      };
    }

    return { valid: true };
  }
}
