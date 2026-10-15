import {
  BusinessVerificationStatus,
  LocationVerificationStatus,
  WebsiteReachabilityStatus,
} from './Enums';
import { Lead as FrontendLead } from '@/types';

export interface ContactItem {
  value: string;
  type: 'phone' | 'mobile' | 'email' | 'whatsapp' | 'contact_form' | 'contact_page' | 'social';
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
  confidence?: 'verified' | 'high' | 'medium';
  verified?: boolean;
}

export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  youtube?: string;
}

export interface AuditIssue {
  issue: string;
  category: 'seo' | 'ux' | 'technical' | 'performance';
  severity: 'high' | 'medium' | 'low' | 'critical';
  evidence: string;
  sourceUrl?: string;
}

export interface PerformanceMetrics {
  loadTimeMs?: number;
  pageSizeBytes?: number;
  mobileFriendly?: boolean;
  score?: number; // 0-100
}

export interface SeoMetrics {
  hasTitle: boolean;
  titleLength?: number;
  hasDescription: boolean;
  descriptionLength?: number;
  hasH1: boolean;
  hasCanonical: boolean;
  hasSchema: boolean;
  internalLinksCount: number;
  externalLinksCount: number;
}

export interface UxMetrics {
  mobileViewport: boolean;
  hasPhoneCTA: boolean;
  hasEmailCTA: boolean;
  hasWhatsAppCTA: boolean;
  hasContactForm: boolean;
  hasBookingCTA: boolean;
  trustSignalsCount: number;
}

export interface ScoreBreakdownItem {
  rule: string;
  points: number;
  reason: string;
}

export interface SourceEvidenceItem {
  sourceName: string;
  sourceId: string;
  rawTags?: Record<string, any>;
  observedAt: string;
}

/**
 * LeadPilot Core Lead Entity
 */
export interface LeadEntity {
  leadId: string;
  businessName: string;
  category: string;
  industry?: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;

  phone?: string;
  email?: string;
  whatsapp?: string;
  contactPage?: string;
  contactForm?: string;

  website?: string;
  domain?: string;
  websiteStatus: WebsiteReachabilityStatus | string;
  https: boolean;
  redirectUrl?: string;

  socialLinks: SocialLinks;
  contacts: ContactItem[];

  businessVerificationStatus: BusinessVerificationStatus;
  locationVerificationStatus: LocationVerificationStatus;

  websiteAudit?: {
    overallScore: number;
    issues: AuditIssue[];
    pagesCrawled: number;
  };
  auditIssues: AuditIssue[];
  performanceData?: PerformanceMetrics;
  seoData?: SeoMetrics;
  uxData?: UxMetrics;

  leadScore: number; // 0 - 100
  scoreBreakdown: ScoreBreakdownItem[];

  sources: string[];
  sourceEvidence: SourceEvidenceItem[];
  enrichmentStatus?: 'DISCOVERED' | 'ENRICHING' | 'ENRICHED' | 'QUALIFIED' | 'REJECTED';
  auditStatus?: 'PENDING' | 'AUDITING' | 'AUDITED';
  googlePlaceId?: string;
  rating?: number | null;
  reviewCount?: number | null;
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
  commercialMilestones?: any[];
  firstKnownGmvDate?: string | null;
  osmId?: string;
  provenance?: Record<string, { value: any; source: string; verified: boolean }>;

  createdAt: string;
  updatedAt: string;
}

/**
 * Converts a backend LeadEntity into the frontend Lead format expected by UI tables and modals.
 */
export function leadEntityToFrontend(lead: LeadEntity): FrontendLead {
  const issues = lead.auditIssues || [];
  const statusStr =
    lead.websiteStatus === 'LIVE' || lead.websiteStatus === 'Working'
      ? 'Working'
      : lead.websiteStatus === 'UNREACHABLE' || lead.websiteStatus === 'Unreachable'
      ? 'Unreachable'
      : !lead.website
      ? 'No Website'
      : 'Needs Improvement';

  return {
    id: lead.leadId,
    businessName: lead.businessName,
    category: lead.category,
    industry: lead.industry || lead.category,
    address: lead.address,
    state: lead.state,
    city: lead.city,
    country: lead.country,
    googlePlaceId: lead.googlePlaceId,
    rating: lead.rating,
    reviewCount: lead.reviewCount ?? lead.userRatingCount,
    userRatingCount: lead.userRatingCount ?? lead.reviewCount,
    positiveReviewDataAvailable: lead.positiveReviewDataAvailable,
    positiveReviewCount: lead.positiveReviewCount,
    negativeReviewCount: lead.negativeReviewCount,
    neutralReviewCount: lead.neutralReviewCount,
    positiveReviewRatio: lead.positiveReviewRatio,
    reviews: lead.reviews,
    commercialMilestones: lead.commercialMilestones,
    firstKnownGmvDate: lead.firstKnownGmvDate,
    phone: lead.phone,
    email: lead.email,
    emailSource: lead.contacts?.find((c) => c.type === 'email')?.source || (lead.email ? 'official_website' : undefined),
    websiteUrl: lead.website,
    websiteStatus: statusStr as any,
    leadScore: lead.leadScore,
    scoreBreakdown: lead.scoreBreakdown || [],
    auditIssues: issues.map((i) => i.issue),
    websiteIssues: issues.map((i) => i.issue),
    osmId: lead.sourceEvidence?.[0]?.sourceId ? String(lead.sourceEvidence[0].sourceId) : undefined,
    osmType: (lead.sourceEvidence?.[0]?.rawTags?.osmType as any) || 'node',
    source: lead.sources?.[0] || 'google_places',
    sources: lead.sources,
    sourceEvidence: lead.sourceEvidence,
    latitude: lead.latitude,
    longitude: lead.longitude,
    location: {
      city: lead.city,
      state: lead.state,
      country: lead.country || 'India',
      address: lead.address,
      postcode: lead.postcode,
    },
    contact: {
      name: lead.businessName,
      phone: lead.phone,
      email: lead.email,
      hasPhone: Boolean(lead.phone),
      hasEmail: Boolean(lead.email),
      verified: lead.contacts?.some((c) => c.verified === true) ?? false,
      linkedin: lead.socialLinks?.linkedin,
    },
    website: {
      url: lead.website,
      hasWebsite: Boolean(lead.website),
      status: statusStr as any,
      issuesCount: issues.length,
      detectedIssues: issues.map((i) => i.issue),
      mobileOptimized: lead.uxData?.mobileViewport ?? true,
      sslSecure: lead.https,
      lastAudited: lead.updatedAt,
    },
  };
}
