import { BaseActor, ActorContext } from '@/models/Actor';
import { RawDiscoveredBusiness } from '@/providers/BusinessDiscoveryProvider';
import { BusinessVerificationStatus } from '@/models/Enums';
import { validateIndustryRelevance } from '@/lib/taxonomy/industryTaxonomy';

export interface VerifiedBusiness extends RawDiscoveredBusiness {
  industry?: string;
  businessVerificationStatus: BusinessVerificationStatus;
}

export interface BusinessVerificationInputObject {
  businesses: RawDiscoveredBusiness[];
  requestedIndustry?: string;
}

export type BusinessVerificationInput = RawDiscoveredBusiness[] | BusinessVerificationInputObject;

export interface BusinessVerificationOutput {
  verified: VerifiedBusiness[];
  rejected: { business: RawDiscoveredBusiness; reason: string; details?: string }[];
}

export class BusinessVerificationActor extends BaseActor<BusinessVerificationInput, BusinessVerificationOutput> {
  readonly actorId = 'actor_business_verification';
  readonly name = 'Business Verification Actor';
  readonly priority = 'HIGH' as const;
  readonly blocking = true;
  readonly timeoutMs = 2500;
  readonly dependencies = ['actor_location_verification'];

  protected async run(context: ActorContext<BusinessVerificationInput>): Promise<{
    data: BusinessVerificationOutput;
    sources: string[];
  }> {
    const rawInput = context.input;
    const businesses: RawDiscoveredBusiness[] = Array.isArray(rawInput) ? rawInput : rawInput.businesses;
    const requestedIndustry: string | undefined = Array.isArray(rawInput) ? undefined : rawInput.requestedIndustry;

    context.onProgress?.(`Verifying business identity & industry relevance for ${businesses.length} candidates...`);

    const verified: VerifiedBusiness[] = [];
    const rejected: { business: RawDiscoveredBusiness; reason: string; details?: string }[] = [];

    for (const b of businesses) {
      const name = b.businessName ? b.businessName.trim() : '';

      // 1. Missing name check
      if (!name || name.length < 2 || name.toLowerCase() === 'unnamed' || name.toLowerCase() === 'no name') {
        rejected.push({ business: b, reason: 'MISSING_NAME', details: 'Business name is missing or invalid' });
        continue;
      }

      // 2. Category sanity check
      if (!b.category || b.category.trim().length === 0) {
        rejected.push({ business: b, reason: 'CATEGORY_UNVERIFIED', details: 'Category evidence is missing from provider' });
        continue;
      }

      // 3. Canonical Industry relevance validation (Early rejection of wrong industries)
      let canonicalCategory = b.category;
      let canonicalIndustry = (b as any).industry || requestedIndustry;

      if (requestedIndustry && requestedIndustry.trim().length > 0) {
        const valResult = validateIndustryRelevance(
          {
            businessName: b.businessName,
            category: b.category,
            types: (b as any).types,
            rawTags: b.rawTags,
          },
          requestedIndustry
        );

        if (!valResult.isValid) {
          const reasonCode = valResult.normalizedCategory === 'CATEGORY_UNVERIFIED' ? 'CATEGORY_UNVERIFIED' : 'INVALID_CATEGORY';
          rejected.push({
            business: b,
            reason: reasonCode,
            details: valResult.rejectionReason || `Category "${b.category}" does not match requested industry "${requestedIndustry}"`,
          });
          continue;
        }

        canonicalCategory = valResult.normalizedCategory;
        canonicalIndustry = valResult.canonicalIndustry;
      }

      let status: BusinessVerificationStatus = 'VERIFIED';
      if (!b.address || (!b.phone && !b.website)) {
        status = 'PARTIAL';
      }

      verified.push({
        ...b,
        category: canonicalCategory,
        industry: canonicalIndustry,
        businessVerificationStatus: status,
      });
    }

    context.onProgress?.(`Business verification complete: ${verified.length} verified.`);

    return {
      data: { verified, rejected },
      sources: ['Business Identity Engine'],
    };
  }
}

export const businessVerificationActor = new BusinessVerificationActor();

