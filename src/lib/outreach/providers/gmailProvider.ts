/**
 * LeadPilot — Gmail Email Provider
 *
 * Implements the EmailProvider contract for Gmail API sending.
 *
 * CRITICAL RULES:
 * - Sender is selected ONLY via campaign.senderAccountId → SenderAccount
 * - Never selects sender by recipient email
 * - Never falls back to Resend/SendGrid silently
 * - Blocks sending with GMAIL_AUTHORIZATION_REQUIRED if no SenderAccount
 * - Captures and returns both Gmail messageId and threadId
 * - Auto-refreshes expired OAuth tokens using encrypted refresh tokens
 */
import { EmailProvider, SendEmailInput, SendResult } from './types';
import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/auth/crypto';
import { UnsubscribeService } from '../unsubscribeService';

/** Extended input that includes the senderAccountId for Gmail provider */
export interface GmailSendEmailInput extends SendEmailInput {
  senderAccountId: string;
  userId: string;
}

/** Extended result that includes Gmail-specific fields */
export interface GmailSendResult extends SendResult {
  gmailMessageId?: string;
  gmailThreadId?: string;
}

export class GmailEmailProvider implements EmailProvider {
  readonly name = 'gmail';

  isConfigured(): boolean {
    // Gmail is configured per-user via SenderAccount, not globally.
    // The system-level check just confirms GOOGLE_CLIENT_ID is present.
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  /**
   * Send an email via the Gmail API using the specified SenderAccount.
   *
   * The senderAccountId and userId must be provided in the input.
   * The provider will:
   * 1. Load the SenderAccount by ID
   * 2. Verify user ownership
   * 3. Refresh the token if expired
   * 4. Send via Gmail API
   * 5. Return messageId and threadId
   */
  async sendEmail(input: SendEmailInput): Promise<GmailSendResult> {
    const gmailInput = input as GmailSendEmailInput;

    if (!gmailInput.senderAccountId) {
      return {
        success: false,
        provider: this.name,
        status: 'FAILED',
        recipient: input.to,
        channel: 'EMAIL',
        errorCode: 'GMAIL_AUTHORIZATION_REQUIRED',
        errorMessage:
          'No Gmail sender account specified. The user must authorize Gmail before sending.',
      };
    }

    // 1. Load the SenderAccount
    const senderAccount = await prisma.senderAccount.findUnique({
      where: { id: gmailInput.senderAccountId },
    });

    if (!senderAccount) {
      return {
        success: false,
        provider: this.name,
        status: 'FAILED',
        recipient: input.to,
        channel: 'EMAIL',
        errorCode: 'GMAIL_AUTHORIZATION_REQUIRED',
        errorMessage: 'Gmail sender account not found.',
      };
    }

    // 2. Verify user ownership
    if (senderAccount.userId !== gmailInput.userId) {
      return {
        success: false,
        provider: this.name,
        status: 'FAILED',
        recipient: input.to,
        channel: 'EMAIL',
        errorCode: 'SENDER_OWNERSHIP_VIOLATION',
        errorMessage: 'The sender account does not belong to the authenticated user.',
      };
    }

    // 3. Check status
    if (senderAccount.status !== 'CONNECTED') {
      return {
        success: false,
        provider: this.name,
        status: 'FAILED',
        recipient: input.to,
        channel: 'EMAIL',
        errorCode: 'GMAIL_AUTHORIZATION_REQUIRED',
        errorMessage: `Gmail sender account status is ${senderAccount.status}. Re-authorize Gmail.`,
      };
    }

    // 4. Get access token (refresh if expired)
    let accessToken: string;
    try {
      accessToken = await this.getValidAccessToken(senderAccount);
    } catch (err: any) {
      return {
        success: false,
        provider: this.name,
        status: 'FAILED',
        recipient: input.to,
        channel: 'EMAIL',
        errorCode: 'GMAIL_TOKEN_REFRESH_FAILED',
        errorMessage: err.message || 'Failed to refresh Gmail access token.',
      };
    }

    // 5. Build raw RFC 2822 message with one-click unsubscribe
    const raw = this.buildRawMessage(
      senderAccount.email,
      senderAccount.displayName || senderAccount.email,
      input.to,
      input.subject,
      input.bodyText,
      input.bodyHtml,
      input.leadId
    );

    // 6. Send via Gmail API
    try {
      const response = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        // Update SenderAccount status if token is revoked
        if (response.status === 401 || response.status === 403) {
          await prisma.senderAccount.update({
            where: { id: senderAccount.id },
            data: {
              status: response.status === 401 ? 'EXPIRED' : 'REVOKED',
              lastError: data.error?.message || `HTTP ${response.status}`,
            },
          });
        }

        return {
          success: false,
          provider: this.name,
          status: 'FAILED',
          recipient: input.to,
          channel: 'EMAIL',
          errorCode: response.status === 429 ? 'RATE_LIMIT_EXCEEDED' : `GMAIL_API_${response.status}`,
          errorMessage: data.error?.message || `Gmail API returned HTTP ${response.status}`,
          rawResponse: data,
        };
      }

      // 7. Update lastUsedAt
      await prisma.senderAccount.update({
        where: { id: senderAccount.id },
        data: { lastUsedAt: new Date() },
      });

      return {
        success: true,
        provider: this.name,
        providerMessageId: data.id,
        gmailMessageId: data.id,
        gmailThreadId: data.threadId,
        status: 'SENT',
        recipient: input.to,
        channel: 'EMAIL',
        sentAt: new Date(),
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: this.name,
        status: 'FAILED',
        recipient: input.to,
        channel: 'EMAIL',
        errorCode: 'GMAIL_NETWORK_ERROR',
        errorMessage: err.message || 'Failed to connect to Gmail API.',
      };
    }
  }

  /**
   * Get a valid access token, refreshing if expired.
   */
  private async getValidAccessToken(
    senderAccount: {
      id: string;
      accessToken: string;
      refreshToken: string | null;
      tokenExpiry: Date | null;
    }
  ): Promise<string> {
    // Check if current token is still valid (with 5 min buffer)
    if (
      senderAccount.tokenExpiry &&
      senderAccount.tokenExpiry.getTime() > Date.now() + 5 * 60 * 1000
    ) {
      return decrypt(senderAccount.accessToken);
    }

    // Need to refresh
    if (!senderAccount.refreshToken) {
      throw new Error(
        'Gmail access token expired and no refresh token available. Re-authorize Gmail.'
      );
    }

    const decryptedRefreshToken = decrypt(senderAccount.refreshToken);

    const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: decryptedRefreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!refreshResponse.ok) {
      const errData = await refreshResponse.json().catch(() => ({}));
      // Mark account as expired
      await prisma.senderAccount.update({
        where: { id: senderAccount.id },
        data: {
          status: 'EXPIRED',
          lastError: errData.error_description || 'Token refresh failed',
        },
      });
      throw new Error(
        errData.error_description || 'Failed to refresh Gmail access token.'
      );
    }

    const refreshData = await refreshResponse.json();

    // Encrypt and store the new access token
    const encryptedNewAccess = encrypt(refreshData.access_token);
    const newExpiry = refreshData.expires_in
      ? new Date(Date.now() + refreshData.expires_in * 1000)
      : null;

    await prisma.senderAccount.update({
      where: { id: senderAccount.id },
      data: {
        accessToken: encryptedNewAccess,
        tokenExpiry: newExpiry,
        status: 'CONNECTED',
        lastError: null,
      },
    });

    return refreshData.access_token;
  }

  /**
   * Build a base64url-encoded RFC 2822 message with RFC 8058 one-click unsubscribe support.
   */
  private buildRawMessage(
    fromEmail: string,
    fromName: string,
    to: string,
    subject: string,
    bodyText: string,
    bodyHtml?: string,
    leadId?: string
  ): string {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const unsubUrl = UnsubscribeService.getUnsubscribeUrl(to, leadId);

    const formattedText = bodyText.includes('unsubscribe')
      ? bodyText
      : `${bodyText}\n\n---\nTo unsubscribe from future communications, please visit: ${unsubUrl}`;

    const formattedHtml = bodyHtml
      ? (bodyHtml.includes('unsubscribe')
          ? bodyHtml
          : `${bodyHtml}<br/><br/><hr style="border:none;border-top:1px solid #e2e8f0;"/><p style="font-size:11px;color:#94a3b8;">To unsubscribe from future communications, <a href="${unsubUrl}" style="color:#64748b;">click here</a>.</p>`)
      : undefined;

    let message: string;

    if (formattedHtml) {
      // Multipart message with both text and HTML
      message = [
        `From: "${fromName}" <${fromEmail}>`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `List-Unsubscribe: <${unsubUrl}>`,
        'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        formattedText,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        formattedHtml,
        '',
        `--${boundary}--`,
      ].join('\r\n');
    } else {
      message = [
        `From: "${fromName}" <${fromEmail}>`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `List-Unsubscribe: <${unsubUrl}>`,
        'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        formattedText,
      ].join('\r\n');
    }

    return Buffer.from(message).toString('base64url');
  }
}
