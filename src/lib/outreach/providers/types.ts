/**
 * LeadPilot — Outreach Provider Contracts
 * Real provider abstractions for Email, SMS, and WhatsApp.
 */

export interface SendEmailInput {
  to: string;
  from?: string;
  replyTo?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  businessName: string;
  leadId: string;
  idempotencyKey?: string;
}

export interface SendSmsInput {
  to: string; // E.164 formatted phone number
  from?: string;
  message: string;
  leadId: string;
  idempotencyKey?: string;
}

export interface SendWhatsAppInput {
  to: string; // E.164 formatted phone number without '+'
  message: string;
  templateName?: string;
  templateLanguage?: string;
  leadId: string;
  idempotencyKey?: string;
}

export interface SendResult {
  success: boolean;
  provider: string;
  providerMessageId?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  status: 'SENT' | 'QUEUED' | 'FAILED';
  recipient: string;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
  sentAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  sendEmail(input: SendEmailInput): Promise<SendResult>;
}

export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  sendSms(input: SendSmsInput): Promise<SendResult>;
}

export interface WhatsAppProvider {
  readonly name: string;
  isConfigured(): boolean;
  sendMessage(input: SendWhatsAppInput): Promise<SendResult>;
}
