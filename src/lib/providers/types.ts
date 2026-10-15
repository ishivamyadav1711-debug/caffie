/**
 * Provider Abstractions & Structured Domain Types for LeadPilot
 */

export interface DiscoveredBusiness {
  provider: string;
  sourceId: string;
  name: string;
  category: string;
  industry: string;
  address?: string;
  city?: string;
  state?: string;
  country: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  websiteUrl?: string;
  rating?: number;
  reviewCount?: number;
  businessStatus?: string;
  rawPayload?: Record<string, any>;
  sourceUrl?: string;
  collectedAt: string;
}

export interface DiscoveryCriteria {
  industry: string;
  state: string;
  city?: string;
  country?: string;
  limit: number;
}

export interface BusinessDiscoveryProvider {
  readonly name: string;
  isConfigured(): boolean;
  searchBusinesses(criteria: DiscoveryCriteria): Promise<DiscoveredBusiness[]>;
}

export interface EmailVerificationResult {
  email: string;
  status: 'DELIVERABLE' | 'UNDELIVERABLE' | 'RISKY' | 'UNKNOWN';
  provider: string;
  hasValidSyntax: boolean;
  hasMxRecords: boolean;
  isDisposable: boolean;
  confidence: number;
  verifiedAt: string;
  details?: Record<string, any>;
}

export interface EmailVerificationProvider {
  readonly name: string;
  verifyEmail(email: string): Promise<EmailVerificationResult>;
}

export interface PhoneValidationResult {
  rawPhone: string;
  isValid: boolean;
  formattedE164?: string;
  formattedNational?: string;
  formattedInternational?: string;
  countryCode?: string;
  lineType?: 'MOBILE' | 'FIXED_LINE' | 'VOIP' | 'UNKNOWN';
  confidence: number;
  provider: string;
}

export interface PhoneValidationProvider {
  readonly name: string;
  validatePhone(phone: string, defaultCountry?: string): Promise<PhoneValidationResult>;
}

export interface CrawlPageResult {
  url: string;
  title?: string;
  metaDescription?: string;
  h1?: string;
  statusCode: number;
  emails: string[];
  phones: string[];
  whatsappLinks: string[];
  socialLinks: string[];
  hasContactForm: boolean;
  hasBookingCta: boolean;
  internalLinks: string[];
  crawledAt: string;
}

export interface WebsiteCrawlSummary {
  domain: string;
  rootUrl: string;
  isReachable: boolean;
  isHttps: boolean;
  httpStatus?: number;
  responseTimeMs?: number;
  hasMobileViewport: boolean;
  pagesCrawled: CrawlPageResult[];
  emails: string[];
  phones: string[];
  whatsappLinks: string[];
  bookingLinks: string[];
  socialLinks: string[];
  hasContactForm: boolean;
  hasBookingCta: boolean;
  hasPhoneCta: boolean;
  detectedIssues: string[];
}

export interface WebsiteCrawlerProvider {
  readonly name: string;
  crawl(url: string, pageLimit?: number): Promise<WebsiteCrawlSummary>;
}

export interface WebsiteAuditResult {
  url: string;
  isReachable: boolean;
  performanceScore?: number;
  accessibilityScore?: number;
  bestPracticesScore?: number;
  seoScore?: number;
  isPageSpeedAvailable: boolean;
  coreWebVitals?: {
    lcpMs?: number;
    cls?: number;
    fidMs?: number;
    inpMs?: number;
  };
  technicalIssues: string[];
  mobileIssues: string[];
  seoIssues: string[];
  conversionIssues: string[];
  auditedAt: string;
}

export interface WebsiteAuditProvider {
  readonly name: string;
  auditWebsite(url: string): Promise<WebsiteAuditResult>;
}

export interface LeadEvidenceItem {
  evidenceType: string;
  claim: string;
  sourceUrl?: string;
  snippet?: string;
  confidence: number;
  observedAt: string;
}

export interface LeadScoringResult {
  opportunityScore: number;
  fitScore: number;
  digitalNeedScore: number;
  contactabilityScore: number;
  evidenceScore: number;
  reasons: string[];
  evidence: LeadEvidenceItem[];
}

export interface TargetPlan {
  industry: string;
  location: {
    state: string;
    city?: string;
    country: string;
  };
  contactRequirement: 'ANY' | 'PHONE_OR_EMAIL' | 'BOTH' | 'EMAIL_ONLY' | 'PHONE_ONLY';
  websiteRequirement: 'ANY' | 'NO_WEBSITE' | 'NEEDS_IMPROVEMENT' | 'WORKING';
  minOpportunityScore: number;
  targetServices: string[];
  rawQuery: string;
}

export interface LLMProvider {
  readonly name: string;
  isConfigured(): boolean;
  planTarget(naturalLanguageQuery: string): Promise<TargetPlan>;
  summarizeLead(businessName: string, evidence: LeadEvidenceItem[]): Promise<string>;
  generateOutreach(
    businessName: string,
    contactName?: string,
    evidence?: LeadEvidenceItem[]
  ): Promise<{ subject: string; body: string }>;
}
