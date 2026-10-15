export interface SearchDiscoveryParams {
  industry: string;
  state: string;
  city?: string;
  country?: string;
  keywords?: string[];
  limit: number;
  bbox?: [number, number, number, number] | any;
}

export interface RawDiscoveredBusiness {
  source: string;
  sources?: string[];
  sourceId: string;
  sourceUrl?: string;
  confidence?: string;
  name: string; // Normalized name
  businessName: string; // Backwards compatible alias
  category: string;
  address: string;
  city?: string;
  state?: string;
  postalCode?: string; // Normalized postal code
  postcode?: string; // Backwards compatible alias
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  website?: string;
  socialLinks?: any;
  openingHours?: string;
  osmType?: 'node' | 'way' | 'relation';
  osmId?: number;
  categoryTag?: string;
  types?: string[];
  googlePlaceId?: string;
  rating?: number | null;
  userRatingCount?: number | null;
  businessStatus?: string;
  positiveReviewDataAvailable?: boolean;
  positiveReviewCount?: number | null;
  negativeReviewCount?: number | null;
  neutralReviewCount?: number | null;
  positiveReviewRatio?: number | null;
  reviews?: Array<{
    authorName?: string;
    rating: number;
    text?: string;
    publishTime?: string;
  }>;
  rawTags: Record<string, any>;
  sourceEvidence?: {
    source: string;
    sourceId: string;
    sourceUrl?: string;
    rawTags?: Record<string, any>;
  }[];
}

export interface DiscoveryResult {
  providerId: string;
  providerName: string;
  resolvedAreaName?: string;
  rawCount: number;
  businesses: RawDiscoveredBusiness[];
  sourceComplete: boolean;
  status:
    | 'SUCCESS'
    | 'COMPLETE'
    | 'PARTIAL'
    | 'FAILED'
    | 'DISABLED'
    | 'NO_RESULTS'
    | 'NOT_CONFIGURED'
    | 'AUTH_FAILED'
    | 'REQUEST_FAILED'
    | 'RATE_LIMITED'
    | 'PROVIDER_NOT_CONFIGURED'
    | 'PROVIDER_FAILURE';
  statusReason?: string;
  errors?: string[];
  pagesRequested?: number;
  queryUsed?: string;
  endpointUsed?: string;
  durationMs: number;
}

export interface BusinessDiscoveryProvider {
  readonly providerId: string;
  readonly name: string;

  discoverBusinesses(params: SearchDiscoveryParams): Promise<DiscoveryResult>;
}
