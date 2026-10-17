import { BaseActor, ActorContext } from '@/models/Actor';
import { BusinessWithScore } from './LeadScoringActor';
import { LeadEntity } from '@/models/Lead';
import { canonicalizeUrl } from '@/utils/urlUtils';
import { normalizePhone } from '@/utils/phoneUtils';
import { normalizeEmail } from '@/utils/emailUtils';

export class DataNormalizationActor extends BaseActor<BusinessWithScore[], LeadEntity[]> {
  readonly actorId = 'actor_data_normalization';
  readonly name = 'Data Normalization Actor';

  protected async run(context: ActorContext<BusinessWithScore[]>): Promise<{
    data: LeadEntity[];
    sources: string[];
  }> {
    const businesses = context.input;
    context.onProgress?.(`Normalizing data records and compiling final lead entities...`);

    const now = new Date().toISOString();

    const entities: LeadEntity[] = businesses.map((b) => {
      const canonicalWeb = canonicalizeUrl(b.websiteUrl);
      const cleanPhone = normalizePhone(b.phone, (b as any).country);
      const cleanEmail = normalizeEmail(b.email);

      const leadId = `lead_${b.source.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${b.sourceId}`;

      const allSources: string[] = Array.from(
        new Set([...((b as any).sources || [b.source]), ...(b.crawlResult ? [b.crawlResult.providerName] : [])])
      );

      const evidenceList =
        (b as any).sourceEvidence && (b as any).sourceEvidence.length > 0
          ? (b as any).sourceEvidence.map((ev: any) => ({
              sourceName: ev.source,
              sourceId: ev.sourceId,
              rawTags: ev.rawTags,
              observedAt: now,
            }))
          : [
              {
                sourceName: b.source,
                sourceId: b.sourceId,
                rawTags: b.rawTags,
                observedAt: now,
              },
            ];

      return {
        leadId,
        businessName: b.businessName.trim(),
        category: b.category.trim(),
        industry: b.categoryTag || b.category,
        address: b.address.trim(),
        city: b.city || '',
        state: b.state || '',
        country: 'India',
        postcode: b.postcode,
        latitude: b.latitude,
        longitude: b.longitude,

        phone: cleanPhone,
        email: cleanEmail,
        whatsapp: b.whatsapp,
        contactPage: b.contactPage,
        contactForm: b.contactForm,

        website: canonicalWeb,
        domain: b.domain,
        websiteStatus: b.reachability?.status || (canonicalWeb ? 'LIVE' : 'NO_WEBSITE'),
        https: b.reachability?.isHttps ?? (canonicalWeb?.startsWith('https://') ?? false),
        redirectUrl: b.reachability?.finalUrl,

        socialLinks: b.socialLinks || {},
        contacts: b.contacts || [],

        businessVerificationStatus: b.businessVerificationStatus,
        locationVerificationStatus: 'VERIFIED',

        websiteAudit: b.auditResult
          ? {
              overallScore: b.auditResult.overallScore,
              issues: b.auditResult.issues,
              pagesCrawled: b.crawlResult?.pages.length || 1,
            }
          : undefined,

        auditIssues: b.auditResult?.issues || [],
        performanceData: b.auditResult?.performance,
        seoData: b.auditResult?.seo,
        uxData: b.auditResult?.ux,

        leadScore: b.leadScore,
        scoreBreakdown: b.scoreBreakdown,

        sources: allSources,
        sourceEvidence: evidenceList,

        createdAt: now,
        updatedAt: now,
      };
    });

    context.onProgress?.(`Data normalization complete: ${entities.length} final lead entities ready.`, entities.length);

    return {
      data: entities,
      sources: ['LeadPilot Normalizer'],
    };
  }
}

export const dataNormalizationActor = new DataNormalizationActor();
