/**
 * Contact Persistence Service for LeadPilot
 * 
 * Persists canonical contacts, verification results, and quality assessments
 * to PostgreSQL / Neon via Prisma.
 * 
 * RULES:
 * - PostgreSQL is the source of truth (NOT in-memory Maps)
 * - Deduplicates contacts by normalizedValue + businessId + contactType
 * - Never creates contacts without provenance (source)
 * - Verification results always persisted with provider and timestamp
 */
import { prisma } from '@/lib/prisma';
import {
  CanonicalContact,
  ContactQualityAssessment,
  assessContactQuality,
  ContactVerificationStatus,
} from './contactTypes';
import type { PhoneVerificationResult } from './phoneVerificationProvider';
import type { EmailVerificationResult } from './emailVerificationProvider2';

// ─── Persist Contacts for a Business ────────────────────────

export interface PersistContactsInput {
  businessId: string;
  businessName?: string;
  contacts: CanonicalContact[];
}

export interface PersistContactsResult {
  persisted: number;
  deduplicated: number;
  contactIds: string[];
}

/**
 * Persists an array of canonical contacts for a business.
 * Deduplicates by normalizedValue + contactType.
 * Returns IDs of persisted contact records.
 */
export async function persistContacts(input: PersistContactsInput): Promise<PersistContactsResult> {
  const { businessId, businessName, contacts } = input;
  const contactIds: string[] = [];
  let deduplicated = 0;

  // Ensure business record exists in database to satisfy foreign key constraint
  try {
    const existingBiz = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    });
    if (!existingBiz) {
      await prisma.business.create({
        data: {
          id: businessId,
          name: businessName || 'Unknown Business',
          category: 'General',
          industry: 'General',
          status: 'New',
        },
      });
    }
  } catch (err) {
    console.warn(`[ContactPersistence] Failed to ensure Business ${businessId} exists:`, err);
  }

  for (const contact of contacts) {
    try {
      // Check for existing contact with same normalized value
      const existing = await prisma.contact.findFirst({
        where: {
          businessId,
          contactType: contact.contactType,
          normalizedValue: contact.normalizedValue,
        },
      });

      if (existing) {
        // Update if new data has higher confidence
        if (contact.confidence > (existing.confidence || 0)) {
          await prisma.contact.update({
            where: { id: existing.id },
            data: {
              source: contact.source,
              sourceUrl: contact.sourceUrl,
              sourceProvider: contact.sourceProvider,
              confidence: contact.confidence,
              verificationStatus: contact.verificationStatus,
              verifiedAt: contact.verifiedAt ? new Date(contact.verifiedAt) : undefined,
              lastCheckedAt: new Date(),
              evidence: contact.evidence,
              metadata: contact.metadata ? JSON.stringify(contact.metadata) : undefined,
            },
          });
        }
        contactIds.push(existing.id);
        deduplicated++;
        continue;
      }

      const created = await prisma.contact.create({
        data: {
          businessId,
          contactType: contact.contactType,
          rawValue: contact.rawValue,
          normalizedValue: contact.normalizedValue,
          email: contact.contactType === 'EMAIL' ? contact.normalizedValue : undefined,
          phone: contact.contactType === 'PHONE' ? contact.normalizedValue : undefined,
          domain: contact.domain,
          countryCode: contact.countryCode,
          lineType: contact.lineType,
          source: contact.source,
          sourceUrl: contact.sourceUrl,
          sourceProvider: contact.sourceProvider,
          confidence: contact.confidence,
          verificationStatus: contact.verificationStatus,
          verifiedAt: contact.verifiedAt ? new Date(contact.verifiedAt) : undefined,
          firstDiscoveredAt: new Date(),
          isPrimary: contact.isPrimary,
          isPublic: contact.isPublic,
          isRoleBased: contact.isRoleBased,
          isDisposable: contact.isDisposable,
          evidence: contact.evidence,
          metadata: contact.metadata ? JSON.stringify(contact.metadata) : undefined,
        },
      });

      contactIds.push(created.id);
    } catch (err) {
      console.warn(`[ContactPersistence] Failed to persist contact ${contact.normalizedValue}:`, err);
    }
  }

  return {
    persisted: contactIds.length,
    deduplicated,
    contactIds,
  };
}

// ─── Persist Phone Verification ─────────────────────────────

export async function persistPhoneVerification(
  contactId: string,
  result: PhoneVerificationResult
): Promise<void> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { normalizedValue: true },
    });

    const normalizedValue = contact?.normalizedValue || result.normalizedPhone || result.rawPhone;

    await prisma.contactVerification.create({
      data: {
        contactId,
        type: 'PHONE',
        normalizedValue,
        provider: result.provider,
        status: result.verificationStatus,
        level: result.verificationLevel,
        providerStatus: result.providerStatus || (result.verificationStatus === 'VERIFIED' ? 'READY' : undefined),
        providerRequestId: result.providerRequestId,
        errorCode: result.errorCode,
        hasValidSyntax: result.isValid,
        lineType: result.lineType,
        carrier: result.carrier,
        confidence: result.confidence,
        evidence: result.details?.evidence ? JSON.stringify(result.details.evidence) : undefined,
        expiresAt: result.expiresAt ? new Date(result.expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        details: result.details ? JSON.stringify(result.details) : undefined,
      },
    });

    // Update the contact's verification status
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        verificationStatus: result.verificationStatus,
        lineType: result.lineType,
        countryCode: result.countryCode,
        verifiedAt: result.verificationStatus === 'VERIFIED' ? new Date() : undefined,
        lastCheckedAt: new Date(),
        confidence: result.confidence,
      },
    });
  } catch (err) {
    console.warn(`[ContactPersistence] Failed to persist phone verification for contact ${contactId}:`, err);
  }
}

// ─── Persist Email Verification ─────────────────────────────

export async function persistEmailVerification(
  contactId: string,
  result: EmailVerificationResult
): Promise<void> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { normalizedValue: true },
    });

    const normalizedValue = contact?.normalizedValue || result.normalizedEmail || result.rawEmail;

    await prisma.contactVerification.create({
      data: {
        contactId,
        type: 'EMAIL',
        normalizedValue,
        provider: result.provider,
        status: result.verificationStatus,
        level: result.verificationLevel,
        providerStatus: result.providerStatus || (result.verificationStatus === 'VERIFIED' ? 'READY' : undefined),
        providerRequestId: result.providerRequestId,
        errorCode: result.errorCode,
        hasValidSyntax: result.hasValidSyntax,
        hasMxRecords: result.hasMxRecords,
        isDisposable: result.isDisposable,
        isRoleBased: result.isRoleBased,
        confidence: result.confidence,
        evidence: result.details?.evidence ? JSON.stringify(result.details.evidence) : undefined,
        expiresAt: result.expiresAt ? new Date(result.expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        details: result.details ? JSON.stringify(result.details) : undefined,
      },
    });

    // Update the contact's verification status
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        verificationStatus: result.verificationStatus,
        domain: result.domain,
        isRoleBased: result.isRoleBased,
        isDisposable: result.isDisposable,
        verifiedAt: result.verificationStatus === 'VERIFIED' ? new Date() : undefined,
        lastCheckedAt: new Date(),
        confidence: result.confidence,
      },
    });
  } catch (err) {
    console.warn(`[ContactPersistence] Failed to persist email verification for contact ${contactId}:`, err);
  }
}

// ─── Get Contacts for Business ──────────────────────────────

export async function getBusinessContacts(businessId: string): Promise<CanonicalContact[]> {
  try {
    const contacts = await prisma.contact.findMany({
      where: { businessId },
      orderBy: [{ isPrimary: 'desc' }, { confidence: 'desc' }],
    });

    return contacts.map((c) => ({
      contactType: c.contactType as any,
      rawValue: c.rawValue || c.phone || c.email || '',
      normalizedValue: c.normalizedValue || c.phone || c.email || '',
      source: c.source || 'unknown',
      sourceUrl: c.sourceUrl || undefined,
      sourceProvider: c.sourceProvider || undefined,
      confidence: c.confidence || 0,
      verificationStatus: c.verificationStatus as ContactVerificationStatus,
      verifiedAt: c.verifiedAt?.toISOString(),
      isPrimary: c.isPrimary,
      isPublic: c.isPublic,
      isRoleBased: c.isRoleBased,
      isDisposable: c.isDisposable,
      evidence: c.evidence || undefined,
      metadata: c.metadata ? JSON.parse(c.metadata) : undefined,
      countryCode: c.countryCode || undefined,
      lineType: c.lineType as any,
      domain: c.domain || undefined,
    }));
  } catch {
    return [];
  }
}

// ─── Get Contact Quality for Business ───────────────────────

export async function getBusinessContactQuality(businessId: string): Promise<ContactQualityAssessment> {
  const contacts = await getBusinessContacts(businessId);
  return assessContactQuality(contacts);
}

// ─── Update Business Contactability Fields ──────────────────

export async function updateBusinessContactability(businessId: string): Promise<void> {
  try {
    const quality = await getBusinessContactQuality(businessId);

    // Update the Business model's primary phone/email from highest-confidence contacts
    const contacts = await prisma.contact.findMany({
      where: { businessId },
      orderBy: [{ isPrimary: 'desc' }, { confidence: 'desc' }],
    });

    const bestPhone = contacts.find(c => c.contactType === 'PHONE' && c.normalizedValue);
    const bestEmail = contacts.find(c => c.contactType === 'EMAIL' && c.normalizedValue);

    await prisma.business.update({
      where: { id: businessId },
      data: {
        phone: bestPhone?.normalizedValue || undefined,
        email: bestEmail?.normalizedValue || undefined,
      },
    });
  } catch (err) {
    console.warn(`[ContactPersistence] Failed to update business contactability for ${businessId}:`, err);
  }
}
