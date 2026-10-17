export type ContactStatus =
  | 'NOT_CONTACTED'
  | 'CONTACTED'
  | 'CALL_ATTEMPTED'
  | 'EMAIL_SENT'
  | 'WHATSAPP_SENT'
  | 'REPLIED'
  | 'NOT_INTERESTED'
  | 'INVALID_CONTACT'
  | 'DO_NOT_CONTACT';

export interface LeadHistoryRecord {
  placeId: string;
  leadId?: string;
  businessName: string;
  category?: string;
  city?: string;
  state?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  timesReturned: number;
  timesContacted: number;
  lastContactedAt?: string;
  contactStatus: ContactStatus;
  outreachStatus?: string;
  campaignId?: string;
  userNotes?: string;
}

export interface ContactAttemptRecord {
  id: string;
  placeId: string;
  leadId?: string;
  action: string;
  channel: 'phone' | 'email' | 'whatsapp' | 'manual';
  timestamp: string;
  result?: string;
  notes?: string;
}

export interface SearchFingerprintRecord {
  fingerprint: string;
  country: string;
  state: string;
  city?: string;
  industry: string;
  contactFilter: string;
  websiteFilter: string;
  previouslyReturnedPlaceIds: string[];
  timesSearched: number;
  lastDeliveryAt: string;
}

export class LeadHistoryService {
  private histories: Map<string, LeadHistoryRecord> = new Map();
  private attempts: ContactAttemptRecord[] = [];
  private fingerprints: Map<string, SearchFingerprintRecord> = new Map();

  public generateFingerprintKey(params: {
    country?: string;
    state: string;
    city?: string;
    industry: string;
    contactFilter?: string;
    websiteFilter?: string;
  }): string {
    const norm = (s?: string) => (s || '').toLowerCase().trim().replace(/\s+/g, '_');
    return [
      norm(params.industry),
      norm(params.state),
      norm(params.city || 'all'),
      norm(params.contactFilter || 'all_contacts'),
      norm(params.websiteFilter || 'any_website'),
    ].join('|');
  }

  /**
   * Fetches the recently delivered place IDs for a given fingerprint from the database.
   * If database query encounters an issue (e.g. malformed connection or network glitch),
   * falls back safely to in-memory fingerprint history so lead search never crashes.
   */
  public async getRecentDeliveredPlaceIds(fingerprintKey: string, days: number = 7): Promise<Set<string>> {
    try {
      const prisma = (await import('@/lib/prisma')).prisma;
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - days);

      const history = await prisma.searchResultHistory.findMany({
        where: {
          fingerprintKey,
          deliveredAt: {
            gte: dateLimit,
          }
        },
        select: {
          placeId: true
        }
      });

      return new Set(history.map((h: any) => h.placeId));
    } catch (err: any) {
      console.warn('[LeadHistoryService] Safe fallback: could not query searchResultHistory from database:', err.message);
      // Fallback to in-memory fingerprint history
      const fp = this.fingerprints.get(fingerprintKey);
      return new Set(fp ? fp.previouslyReturnedPlaceIds : []);
    }
  }

  /**
   * Saves newly delivered candidates to the database for future recent-exclusion.
   * Guarded with safe error handling so persistence errors do not crash caller.
   */
  public async recordDeliveryToDb(
    fingerprintKey: string,
    jobId: string,
    deliveredLeads: { placeId: string; name: string }[]
  ): Promise<{ persistedToDb: boolean; inMemorySaved: boolean }> {
    if (deliveredLeads.length === 0) return { persistedToDb: true, inMemorySaved: false };

    // Always update in-memory fingerprint history so fallback has the data
    const existingFp = this.fingerprints.get(fingerprintKey);
    if (existingFp) {
      for (const lead of deliveredLeads) {
        if (!existingFp.previouslyReturnedPlaceIds.includes(lead.placeId)) {
          existingFp.previouslyReturnedPlaceIds.push(lead.placeId);
        }
      }
    } else {
      this.fingerprints.set(fingerprintKey, {
        fingerprint: fingerprintKey,
        country: 'India',
        state: 'Unknown',
        industry: 'Unknown',
        contactFilter: 'All Contacts',
        websiteFilter: 'Any Website',
        previouslyReturnedPlaceIds: deliveredLeads.map(l => l.placeId),
        timesSearched: 1,
        lastDeliveryAt: new Date().toISOString(),
      });
    }

    try {
      const prisma = (await import('@/lib/prisma')).prisma;
      
      await prisma.searchResultHistory.createMany({
        data: deliveredLeads.map(lead => ({
          fingerprintKey,
          jobId,
          placeId: lead.placeId,
          businessName: lead.name,
        }))
      });
      return { persistedToDb: true, inMemorySaved: true };
    } catch (err: any) {
      console.warn('[LeadHistoryService] Safe fallback: could not persist searchResultHistory to database:', err.message);
      return { persistedToDb: false, inMemorySaved: true };
    }
  }

  public getFingerprint(fingerprintKey: string): SearchFingerprintRecord | undefined {
    return this.fingerprints.get(fingerprintKey);
  }

  public getHistory(placeId: string): LeadHistoryRecord | undefined {
    return this.histories.get(placeId);
  }

  public getAllHistories(): LeadHistoryRecord[] {
    return Array.from(this.histories.values());
  }

  /**
   * Records newly delivered leads for a search fingerprint and increments return counts.
   */
  public recordDelivery(
    fingerprintKey: string,
    deliveredPlaceIds: string[],
    businessMetadata: Map<string, { name: string; city?: string; state?: string; leadId?: string }>,
    searchParams?: {
      country?: string;
      state: string;
      city?: string;
      industry: string;
      contactFilter?: string;
      websiteFilter?: string;
    }
  ): void {
    const now = new Date().toISOString();

    // 1. Update/Create LeadHistory for each delivered lead
    for (const placeId of deliveredPlaceIds) {
      const meta = businessMetadata.get(placeId);
      const existing = this.histories.get(placeId);

      if (existing) {
        existing.timesReturned += 1;
        existing.lastSeenAt = now;
        if (meta?.leadId) existing.leadId = meta.leadId;
        if (meta?.name) existing.businessName = meta.name;
        this.histories.set(placeId, existing);
      } else {
        const newRecord: LeadHistoryRecord = {
          placeId,
          leadId: meta?.leadId,
          businessName: meta?.name || 'Unknown Business',
          city: meta?.city,
          state: meta?.state,
          firstSeenAt: now,
          lastSeenAt: now,
          timesReturned: 1,
          timesContacted: 0,
          contactStatus: 'NOT_CONTACTED',
          outreachStatus: 'IDLE',
        };
        this.histories.set(placeId, newRecord);
      }
    }

    // 2. Update SearchFingerprint
    let fp = this.fingerprints.get(fingerprintKey);
    if (!fp && searchParams) {
      fp = {
        fingerprint: fingerprintKey,
        country: searchParams.country || 'India',
        state: searchParams.state,
        city: searchParams.city,
        industry: searchParams.industry,
        contactFilter: searchParams.contactFilter || 'All Contacts',
        websiteFilter: searchParams.websiteFilter || 'Any Website',
        previouslyReturnedPlaceIds: [],
        timesSearched: 0,
        lastDeliveryAt: now,
      };
    }

    if (fp) {
      fp.timesSearched += 1;
      fp.lastDeliveryAt = now;
      const combinedIds = new Set([...fp.previouslyReturnedPlaceIds, ...deliveredPlaceIds]);
      fp.previouslyReturnedPlaceIds = Array.from(combinedIds);
      this.fingerprints.set(fingerprintKey, fp);
    }
  }

  /**
   * Records a user outreach action (Call, Email, WhatsApp, Contacted, Not Interested, etc.)
   */
  public recordContactAction(params: {
    placeId: string;
    leadId?: string;
    action: string;
    channel: 'phone' | 'email' | 'whatsapp' | 'manual';
    result?: string;
    notes?: string;
  }): { success: boolean; updatedStatus: ContactStatus; record?: LeadHistoryRecord } {
    const now = new Date().toISOString();
    const { placeId, leadId, action, channel, result, notes } = params;

    // Map user action to ContactStatus
    let updatedStatus: ContactStatus = 'CONTACTED';
    const upperAction = action.toUpperCase();

    if (upperAction.includes('CALL')) updatedStatus = 'CALL_ATTEMPTED';
    else if (upperAction.includes('EMAIL')) updatedStatus = 'EMAIL_SENT';
    else if (upperAction.includes('WHATSAPP')) updatedStatus = 'WHATSAPP_SENT';
    else if (upperAction.includes('REPLY') || upperAction.includes('REPLIED')) updatedStatus = 'REPLIED';
    else if (upperAction.includes('NOT_INTERESTED') || upperAction.includes('REJECT')) updatedStatus = 'NOT_INTERESTED';
    else if (upperAction.includes('INVALID') || upperAction.includes('WRONG_NUMBER')) updatedStatus = 'INVALID_CONTACT';
    else if (upperAction.includes('DO_NOT_CONTACT') || upperAction.includes('UNSUBSCRIBE')) updatedStatus = 'DO_NOT_CONTACT';
    else if (upperAction.includes('CONTACTED') || upperAction.includes('TOUCHED')) updatedStatus = 'CONTACTED';

    // 1. Record Attempt
    const attempt: ContactAttemptRecord = {
      id: `attempt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      placeId,
      leadId,
      action: upperAction,
      channel,
      timestamp: now,
      result,
      notes,
    };
    this.attempts.push(attempt);

    // 2. Update LeadHistory
    let history = this.histories.get(placeId);
    if (!history) {
      history = {
        placeId,
        leadId,
        businessName: 'Business',
        firstSeenAt: now,
        lastSeenAt: now,
        timesReturned: 1,
        timesContacted: 1,
        lastContactedAt: now,
        contactStatus: updatedStatus,
        outreachStatus: 'ACTIVE',
        userNotes: notes,
      };
    } else {
      history.timesContacted += 1;
      history.lastContactedAt = now;
      history.contactStatus = updatedStatus;
      if (leadId) history.leadId = leadId;
      if (notes) history.userNotes = notes;
    }

    this.histories.set(placeId, history);

    return {
      success: true,
      updatedStatus,
      record: history,
    };
  }

  /**
   * Resets workflow history (for testing purposes).
   */
  public resetWorkflowState(): void {
    this.histories.clear();
    this.attempts = [];
    this.fingerprints.clear();
  }
}

export const leadHistoryService = new LeadHistoryService();
