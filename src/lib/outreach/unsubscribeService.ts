import crypto from 'crypto';
import { SuppressionService } from './suppressionService';

export class UnsubscribeService {
  private static getSecret(): string {
    return process.env.JWT_SECRET || process.env.TOKEN_ENCRYPTION_KEY || 'leadpilot-unsubscribe-secret-fallback-key';
  }

  /**
   * Generates a tamper-proof signed unsubscribe token for an email address.
   */
  static generateToken(email: string, leadId?: string): string {
    const cleanEmail = email.trim().toLowerCase();
    const payload = JSON.stringify({
      email: cleanEmail,
      leadId: leadId || null,
      issuedAt: Date.now(),
    });
    const encodedPayload = Buffer.from(payload).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getSecret())
      .update(encodedPayload)
      .digest('base64url');

    return `${encodedPayload}.${signature}`;
  }

  /**
   * Verifies an unsubscribe token and extracts the email.
   */
  static verifyToken(token: string): { email: string; leadId?: string } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return null;

      const [encodedPayload, signature] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', this.getSecret())
        .update(encodedPayload)
        .digest('base64url');

      if (signature !== expectedSignature) {
        return null;
      }

      const decodedString = Buffer.from(encodedPayload, 'base64url').toString('utf8');
      const data = JSON.parse(decodedString);

      if (!data.email || typeof data.email !== 'string') return null;

      return {
        email: data.email.trim().toLowerCase(),
        leadId: data.leadId || undefined,
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Build the full one-click unsubscribe URL.
   */
  static getUnsubscribeUrl(email: string, leadId?: string): string {
    const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || 'http://localhost:3000';
    const token = this.generateToken(email, leadId);
    return `${baseUrl}/api/outreach/unsubscribe?token=${token}`;
  }

  /**
   * Process unsubscribe request idempotently.
   */
  static async processUnsubscribe(email: string, source: string = 'One-Click Unsubscribe'): Promise<boolean> {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) return false;

    await SuppressionService.suppressContact(cleanEmail, 'EMAIL', 'UNSUBSCRIBED', source);
    return true;
  }
}
