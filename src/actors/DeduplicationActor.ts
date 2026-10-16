import { BaseActor, ActorContext } from '@/models/Actor';
import { VerifiedBusiness } from './BusinessVerificationActor';
import { extractDomain } from '@/utils/urlUtils';
import { normalizePhone } from '@/utils/phoneUtils';

export interface DeduplicationOutput {
  unique: VerifiedBusiness[];
  duplicatesCount: number;
}

export class DeduplicationActor extends BaseActor<VerifiedBusiness[], DeduplicationOutput> {
  readonly actorId = 'actor_deduplication';
  readonly name = 'Deduplication Actor';
  readonly priority = 'HIGH' as const;
  readonly blocking = true;
  readonly timeoutMs = 2000;
  readonly dependencies = ['actor_business_verification'];

  private isGenericDomain(domain: string): boolean {
    const generic = [
      'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
      'linkedin.com', 'youtube.com', 'justdial.com', 'indiamart.com',
      'zomato.com', 'swiggy.com', 'google.com', 'magicpin.in', 'tripadvisor.com'
    ];
    const clean = domain.toLowerCase().replace(/^www\./, '');
    return generic.some((g) => clean === g || clean.endsWith(`.${g}`));
  }

  protected async run(context: ActorContext<VerifiedBusiness[]>): Promise<{
    data: DeduplicationOutput;
    sources: string[];
  }> {
    const businesses = context.input;
    context.onProgress?.(`Deduplicating ${businesses.length} candidate businesses...`);

    const seenSourceIds = new Set<string>();
    const seenProviderIds = new Set<string>();
    const seenPhones = new Map<string, string>(); // phone -> normalizedName
    const seenDomains = new Map<string, string>(); // domain -> normalizedName
    const seenLocations = new Map<string, { lat: number; lon: number }[]>();
    const unique: VerifiedBusiness[] = [];
    let duplicatesCount = 0;

    for (const b of businesses) {
      // 1. Primary Source ID check
      const primaryKey = `${b.source}:${b.sourceId}`;
      if (seenSourceIds.has(primaryKey)) {
        duplicatesCount++;
        continue;
      }

      // 2. Stable Provider IDs check (RapidAPI, Google Place, OSM)
      const rapidId = b.rawTags?.rapidApiId || (b as any).rapidApiId || (b.source === 'rapidapi' ? b.sourceId : undefined);
      const googleId = b.rawTags?.googlePlaceId || (b as any).googlePlaceId || (b.source === 'google_places' ? b.sourceId : undefined);
      const osmId = b.rawTags?.osmId || (b as any).osmId || (b.source === 'osm' || b.source === 'openstreetmap' ? b.sourceId : undefined);

      if (rapidId && seenProviderIds.has(`rapidapi:${rapidId}`)) {
        duplicatesCount++;
        continue;
      }
      if (googleId && seenProviderIds.has(`google:${googleId}`)) {
        duplicatesCount++;
        continue;
      }
      if (osmId && seenProviderIds.has(`osm:${osmId}`)) {
        duplicatesCount++;
        continue;
      }

      const normalizedName = (b.businessName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      // 3. Normalized Phone check (A direct phone number identifies a specific physical branch)
      const normPhone = normalizePhone(b.phone);
      if (normPhone && normPhone.length >= 8) {
        const existingNameForPhone = seenPhones.get(normPhone);
        if (existingNameForPhone) {
          // If name tokens overlap or match, it is the same branch
          if (
            normalizedName.includes(existingNameForPhone) ||
            existingNameForPhone.includes(normalizedName)
          ) {
            duplicatesCount++;
            continue;
          }
        }
      }

      // 4. Normalized Domain check
      // Distinct branches share a website domain (e.g. clinic chain, retail chain).
      // Only merge if they also share the phone number OR are within ~250m proximity!
      const domain = b.website ? extractDomain(b.website) : undefined;
      if (domain && !this.isGenericDomain(domain)) {
        const existingNameForDomain = seenDomains.get(domain);
        if (
          existingNameForDomain &&
          (normalizedName === existingNameForDomain ||
            normalizedName.includes(existingNameForDomain) ||
            existingNameForDomain.includes(normalizedName))
        ) {
          const samePhone = Boolean(normPhone && seenPhones.has(normPhone));
          let closeProximity = false;
          if (b.latitude && b.longitude) {
            const existingLocs = seenLocations.get(normalizedName) || [];
            for (const loc of existingLocs) {
              const latDiff = Math.abs(loc.lat - b.latitude);
              const lonDiff = Math.abs(loc.lon - b.longitude);
              // ~0.0025 degrees is ~250m
              if (latDiff < 0.0025 && lonDiff < 0.0025) {
                closeProximity = true;
                break;
              }
            }
          }
          if (samePhone || closeProximity) {
            duplicatesCount++;
            continue;
          }
        }
      }

      // 5. Name + Proximity check (~50 meters)
      // Multiple branches (e.g. McDonald's in different locations) must NOT be merged.
      let isDuplicateLocation = false;
      if (b.latitude && b.longitude) {
        const existingLocs = seenLocations.get(normalizedName) || [];
        for (const loc of existingLocs) {
          const latDiff = Math.abs(loc.lat - b.latitude);
          const lonDiff = Math.abs(loc.lon - b.longitude);
          // ~0.0005 degrees is approx 50 meters
          if (latDiff < 0.0005 && lonDiff < 0.0005) {
            isDuplicateLocation = true;
            break;
          }
        }
      }

      if (isDuplicateLocation) {
        duplicatesCount++;
        continue;
      }

      seenSourceIds.add(primaryKey);
      if (rapidId) seenProviderIds.add(`rapidapi:${rapidId}`);
      if (googleId) seenProviderIds.add(`google:${googleId}`);
      if (osmId) seenProviderIds.add(`osm:${osmId}`);
      if (normPhone && normPhone.length >= 8) seenPhones.set(normPhone, normalizedName);
      if (domain && !this.isGenericDomain(domain)) seenDomains.set(domain, normalizedName);

      if (b.latitude && b.longitude) {
        const locList = seenLocations.get(normalizedName) || [];
        locList.push({ lat: b.latitude, lon: b.longitude });
        seenLocations.set(normalizedName, locList);
      }
      unique.push(b);
    }

    context.onProgress?.(`Deduplication complete: ${unique.length} unique businesses retained.`);

    return {
      data: { unique, duplicatesCount },
      sources: ['Deduplication Matrix'],
    };
  }
}

export const deduplicationActor = new DeduplicationActor();
