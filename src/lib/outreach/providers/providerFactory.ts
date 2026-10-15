import { EmailProvider, SmsProvider, WhatsAppProvider } from './types';
import { ResendEmailProvider, SendGridEmailProvider } from './emailProvider';
import { GmailEmailProvider } from './gmailProvider';
import { TwilioSmsProvider } from './smsProvider';
import { MetaWhatsAppProvider } from './whatsappProvider';

export class OutreachProviderFactory {
  private static emailProviderInstance?: EmailProvider;
  private static gmailProviderInstance?: GmailEmailProvider;
  private static smsProviderInstance?: SmsProvider;
  private static whatsAppProviderInstance?: WhatsAppProvider;

  /**
   * Get the system-level email provider (Resend or SendGrid).
   * This is for LEGACY non-Gmail campaigns only.
   */
  static getEmailProvider(): EmailProvider {
    if (!this.emailProviderInstance) {
      const preferred = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
      if (preferred === 'sendgrid') {
        this.emailProviderInstance = new SendGridEmailProvider();
      } else {
        this.emailProviderInstance = new ResendEmailProvider();
      }
    }
    return this.emailProviderInstance;
  }

  /**
   * Get the Gmail email provider (user-owned sender).
   * This is the REQUIRED provider for Gmail campaigns.
   * NEVER falls back to Resend/SendGrid silently.
   */
  static getGmailProvider(): GmailEmailProvider {
    if (!this.gmailProviderInstance) {
      this.gmailProviderInstance = new GmailEmailProvider();
    }
    return this.gmailProviderInstance;
  }

  static getSmsProvider(): SmsProvider {
    if (!this.smsProviderInstance) {
      this.smsProviderInstance = new TwilioSmsProvider();
    }
    return this.smsProviderInstance;
  }

  static getWhatsAppProvider(): WhatsAppProvider {
    if (!this.whatsAppProviderInstance) {
      this.whatsAppProviderInstance = new MetaWhatsAppProvider();
    }
    return this.whatsAppProviderInstance;
  }

  static getSystemProviderStatus() {
    const email = this.getEmailProvider();
    const gmail = this.getGmailProvider();
    const sms = this.getSmsProvider();
    const whatsapp = this.getWhatsAppProvider();

    return {
      email: {
        provider: email.name,
        configured: email.isConfigured(),
        status: email.isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
      },
      gmail: {
        provider: gmail.name,
        configured: gmail.isConfigured(),
        status: gmail.isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
        note: 'Per-user SenderAccount required for actual sending',
      },
      sms: {
        provider: sms.name,
        configured: sms.isConfigured(),
        status: sms.isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
      },
      whatsapp: {
        provider: whatsapp.name,
        configured: whatsapp.isConfigured(),
        status: whatsapp.isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
      },
    };
  }
}

