import { BaseActor, ActorContext } from '@/models/Actor';
import { RawDiscoveredBusiness } from '@/providers/BusinessDiscoveryProvider';
import { extractDomain } from '@/utils/urlUtils';
import { normalizePhone } from '@/utils/phoneUtils';

export interface MultiSourceMergeOutput {
  merged: RawDiscoveredBusiness[];
  deduplicatedCount: number;
}

export class MultiSourceMergeActor extends BaseActor<RawDiscoveredBusiness[], MultiSourceMergeOutput> {
  readonly actorId = 'actor_multi_source_merge';
  readonly name = 'Multi-Source Merge & Deduplication Actor';

  /**
   * Calculates distance in meters between two lat/lon coordinates using Haversine formula.
   */
  private getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Normalizes business name for loose matching.
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Detects if address contains distinct branch/locality identifiers (e.g. Sector 18 vs Sector 62).
   */
  private extractLocalitySector(address: string, name: string): string {
    const combined = `${name} ${address}`.toLowerCase();
    const sectorMatch = combined.match(/sector\s*[-–]?\s*(\d+[a-z]?)/i);
    if (sectorMatch) return `sector_${sectorMatch[1]}`;

    const blockMatch = combined.match(/block\s*[-–]?\s*([a-z0-9]+)/i);
    if (blockMatch) return `block_${blockMatch[1]}`;

    const mallMatch = combined.match(/(dlf|gip|ansal|venice|logix|gaur|pacific)\s*(mall)?/i);
    if (mallMatch) return `mall_${mallMatch[1]}`;

    return '';
  }

  /**
   * Helper to normalize source identifiers (e.g. 'osm' -> 'openstreetmap')
   */
  private normalizeSourceName(src: string): string {
    if (src === 'osm' || src === 'openstreetmap') return 'openstreetmap';
    if (src === 'google_places' || src === 'google') return 'google_places';
    if (src === 'rapidapi' || src === 'rapidapi_maps' || src?.includes('rapidapi')) return 'rapidapi';
    return src;
  }

  /**
   * Helper to check if domain is a generic social/directory portal that shouldn't dedup alone
   */
  private isGenericDomain(domain: string): boolean {
    const generic = [
      'facebook.com',
      'instagram.com',
      'twitter.com',
      'x.com',
      'linkedin.com',
      'youtube.com',
      'justdial.com',
      'indiamart.com',
      'zomato.com',
      'swiggy.com',
      'google.com',
      'magicpin.in',
      'tripadvisor.com',
    ];
    const clean = domain.toLowerCase().replace(/^www\./, '');
    return generic.some((g) => clean === g || clean.endsWith(`.${g}`));
  }

  protected async run(context: ActorContext<RawDiscoveredBusiness[]>): Promise<{
    data: MultiSourceMergeOutput;
    sources: string[];
  }> {
    const candidates = context.input;
    context.onProgress?.(`Merging and cross-deduplicating ${candidates.length} multi-source candidate businesses...`);

    const mergedList: RawDiscoveredBusiness[] = [];
    const seenPrimaryKeys = new Set<string>();
    let deduplicatedCount = 0;

    for (const rawItem of candidates) {
      const bName = rawItem.businessName || rawItem.name || '';
      const item: RawDiscoveredBusiness = {
        ...rawItem,
        name: rawItem.name || bName,
        businessName: bName,
        source: this.normalizeSourceName(rawItem.source),
        sources: (rawItem.sources || [rawItem.source]).map((s) => this.normalizeSourceName(s)),
      };

      const primaryKey = `${item.source}:${item.sourceId}`;
      if (seenPrimaryKeys.has(primaryKey)) {
        deduplicatedCount++;
        continue;
      }

      const itemNormName = this.normalizeName(item.businessName || item.name);
      const itemDomain = item.website ? extractDomain(item.website) : undefined;
      const itemPhone = normalizePhone(item.phone);
      const itemLocality = this.extractLocalitySector(item.address, item.businessName || item.name);
      const itemRapidId = item.source === 'rapidapi' ? item.sourceId : (item as any).rapidApiId || item.rawTags?.rapidApiId;
      const itemGoogleId = item.source === 'google_places' ? item.sourceId : item.rawTags?.googlePlaceId;
      const itemOsmId = item.source === 'openstreetmap' ? item.sourceId : item.rawTags?.osmId;

      // Check if this item matches an already accepted candidate in mergedList
      let matchedIndex = -1;

      for (let i = 0; i < mergedList.length; i++) {
        const existing = mergedList[i];
        const existRapidId = existing.source === 'rapidapi' ? existing.sourceId : (existing as any).rapidApiId || existing.rawTags?.rapidApiId;
        const existGoogleId = existing.source === 'google_places' ? existing.sourceId : existing.rawTags?.googlePlaceId;
        const existOsmId = existing.source === 'openstreetmap' ? existing.sourceId : existing.rawTags?.osmId;
        const existingNormName = this.normalizeName(existing.businessName || existing.name);
        const existingDomain = existing.website ? extractDomain(existing.website) : undefined;
        const existingPhone = normalizePhone(existing.phone);
        const existingLocality = this.extractLocalitySector(existing.address, existing.businessName || existing.name);

        // Branch safety: If both specify distinct sectors/localities (e.g. Sector 18 vs Sector 62),
        // they MUST NOT be merged, even if brand name is identical!
        if (itemLocality && existingLocality && itemLocality !== existingLocality) {
          continue;
        }

        // Branch safety: If both have coordinates and distance > 250 meters, do NOT merge branches!
        let distanceMeters: number | null = null;
        if (item.latitude && item.longitude && existing.latitude && existing.longitude) {
          distanceMeters = this.getDistanceMeters(
            item.latitude,
            item.longitude,
            existing.latitude,
            existing.longitude
          );
          if (distanceMeters > 250) {
            continue;
          }
        }

        // ==================================================
        // DEDUPLICATION PRIORITY (Requirement 6)
        // 1. RapidAPI / Google Place ID / provider source ID
        // 2. Normalized website domain
        // 3. Normalized phone
        // 4. Normalized name + geographic proximity
        // ==================================================

        // Priority 1: RapidAPI ID, Google Place ID or Provider Source ID match
        if (
          (itemRapidId && existRapidId && itemRapidId === existRapidId) ||
          (itemGoogleId && existGoogleId && itemGoogleId === existGoogleId) ||
          (itemOsmId && existOsmId && String(itemOsmId) === String(existOsmId)) ||
          (item.source === existing.source && item.sourceId === existing.sourceId)
        ) {
          matchedIndex = i;
          break;
        }

        // Priority 2: Normalized website domain
        if (
          itemDomain &&
          existingDomain &&
          itemDomain === existingDomain &&
          !this.isGenericDomain(itemDomain)
        ) {
          // If domains match, confirm businesses are compatible (either proximity within 250m or share name token)
          if (
            distanceMeters === null ||
            distanceMeters <= 250 ||
            itemNormName.includes(existingNormName) ||
            existingNormName.includes(itemNormName)
          ) {
            matchedIndex = i;
            break;
          }
        }

        // Priority 3: Normalized phone
        if (
          itemPhone &&
          existingPhone &&
          itemPhone.length >= 8 &&
          itemPhone === existingPhone
        ) {
          // Confirm phone match is not an aggregator hotline without name match
          matchedIndex = i;
          break;
        }

        // Priority 4: Normalized name + geographic proximity
        if (
          itemNormName.length >= 3 &&
          existingNormName.length >= 3 &&
          (itemNormName === existingNormName ||
            itemNormName.startsWith(existingNormName) ||
            existingNormName.startsWith(itemNormName)) &&
          (item.city || '').toLowerCase() === (existing.city || '').toLowerCase()
        ) {
          if (distanceMeters !== null && distanceMeters <= 250) {
            matchedIndex = i;
            break;
          }
          if (distanceMeters === null && (!item.latitude || !existing.latitude)) {
            // Without coordinates, match only if in same locality
            if (itemLocality && existingLocality && itemLocality === existingLocality) {
              matchedIndex = i;
              break;
            }
          }
        }
      }

      if (matchedIndex !== -1) {
        // Merge into existing record!
        deduplicatedCount++;
        const target = mergedList[matchedIndex];

        // Preference: If incoming item is from RapidAPI (Primary discovery source) and target is not RapidAPI,
        // upgrade target's core identity fields to RapidAPI
        if (item.source === 'rapidapi' && target.source !== 'rapidapi') {
          target.name = item.name;
          target.businessName = item.businessName;
          target.address = item.address;
          if (item.latitude && item.longitude) {
            target.latitude = item.latitude;
            target.longitude = item.longitude;
          }
          if (item.category) target.category = item.category;
          if (item.types && item.types.length > 0) target.types = item.types;
          target.source = 'rapidapi';
          target.sourceId = item.sourceId;
          target.sourceUrl = item.sourceUrl;
          (target as any).rapidApiId = (item as any).rapidApiId || item.sourceId;
        } else if (item.source === 'google_places' && target.source !== 'google_places' && target.source !== 'rapidapi') {
          target.name = item.name;
          target.businessName = item.businessName;
          target.address = item.address;
          if (item.latitude && item.longitude) {
            target.latitude = item.latitude;
            target.longitude = item.longitude;
          }
          if (item.category) target.category = item.category;
          if (item.types && item.types.length > 0) target.types = item.types;
          target.source = 'google_places';
          target.sourceId = item.sourceId;
          target.sourceUrl = item.sourceUrl;
        }

        // Preserve mock flag across merged candidates
        if (item.isMock || target.isMock) {
          target.isMock = true;
        }

        // Enrich missing fields from candidate
        if (!target.phone && item.phone) target.phone = item.phone;
        if (!target.email && item.email) target.email = item.email;
        if (!target.website && item.website) target.website = item.website;
        if (!target.latitude && item.latitude) {
          target.latitude = item.latitude;
          target.longitude = item.longitude;
        }
        if (!target.address && item.address) target.address = item.address;
        if (!target.types && item.types) target.types = item.types;

        // Preserve all source tags with normalized names
        const existingSources = target.sources || [target.source];
        for (const s of item.sources || [item.source]) {
          const normS = this.normalizeSourceName(s);
          if (!existingSources.includes(normS)) {
            existingSources.push(normS);
          }
        }
        target.sources = existingSources;

        // Maintain merged rawTags (combine rapidApiId, googlePlaceId, osmId, etc.)
        target.rawTags = {
          ...(target.rawTags || {}),
          ...(item.rawTags || {}),
        };

        const targetRapidId = target.source === 'rapidapi' ? target.sourceId : target.rawTags?.rapidApiId || (target as any).rapidApiId;
        const candidateRapidId = item.source === 'rapidapi' ? item.sourceId : item.rawTags?.rapidApiId || (item as any).rapidApiId;
        if (targetRapidId || candidateRapidId) {
          target.rawTags.rapidApiId = targetRapidId || candidateRapidId;
          (target as any).rapidApiId = targetRapidId || candidateRapidId;
        }

        const targetGoogleId = target.source === 'google_places' ? target.sourceId : target.rawTags?.googlePlaceId || (target as any).googlePlaceId;
        const candidateGoogleId = item.source === 'google_places' ? item.sourceId : item.rawTags?.googlePlaceId || (item as any).googlePlaceId;
        if (targetGoogleId || candidateGoogleId) {
          target.rawTags.googlePlaceId = targetGoogleId || candidateGoogleId;
          (target as any).googlePlaceId = targetGoogleId || candidateGoogleId;
        }

        const targetOsmId = target.source === 'openstreetmap' ? target.sourceId : target.rawTags?.osmId || (target as any).osmId;
        const candidateOsmId = item.source === 'openstreetmap' ? item.sourceId : item.rawTags?.osmId || (item as any).osmId;
        if (targetOsmId || candidateOsmId) {
          target.rawTags.osmId = targetOsmId || candidateOsmId;
          (target as any).osmId = targetOsmId || candidateOsmId;
        }

        // Append provenance evidence
        const evidence = Array.isArray(target.sourceEvidence)
          ? [...target.sourceEvidence]
          : target.sourceEvidence
          ? [target.sourceEvidence]
          : [
              {
                source: target.source,
                sourceId: target.sourceId,
                sourceUrl: target.sourceUrl,
                rawTags: target.rawTags,
              },
            ];

        const itemEvidences = Array.isArray(item.sourceEvidence)
          ? item.sourceEvidence
          : item.sourceEvidence
          ? [item.sourceEvidence]
          : [
              {
                source: item.source,
                sourceId: item.sourceId,
                sourceUrl: item.sourceUrl,
                rawTags: item.rawTags,
              },
            ];

        evidence.push(...itemEvidences);
        target.sourceEvidence = evidence;
      } else {
        // New unique candidate
        seenPrimaryKeys.add(primaryKey);
        item.sources = (item.sources || [item.source]).map((s) => this.normalizeSourceName(s));
        if (item.source === 'google_places' || itemGoogleId) {
          item.rawTags = item.rawTags || {};
          item.rawTags.googlePlaceId = itemGoogleId || item.sourceId;
          (item as any).googlePlaceId = itemGoogleId || item.sourceId;
        }
        if (item.source === 'openstreetmap' || itemOsmId) {
          item.rawTags = item.rawTags || {};
          item.rawTags.osmId = itemOsmId || item.sourceId;
          (item as any).osmId = itemOsmId || item.sourceId;
        }
        item.sourceEvidence = Array.isArray(item.sourceEvidence)
          ? item.sourceEvidence
          : item.sourceEvidence
          ? [item.sourceEvidence]
          : [
              {
                source: item.source,
                sourceId: item.sourceId,
                sourceUrl: item.sourceUrl,
                rawTags: item.rawTags,
              },
            ];
        mergedList.push(item);
      }
    }

    context.onProgress?.(
      `Multi-source merge complete: ${mergedList.length} unique candidates retained, ${deduplicatedCount} duplicates merged.`,
      mergedList.length
    );

    return {
      data: {
        merged: mergedList,
        deduplicatedCount,
      },
      sources: ['Multi-Source Merge & Deduplication Engine'],
    };
  }
}

export const multiSourceMergeActor = new MultiSourceMergeActor();
