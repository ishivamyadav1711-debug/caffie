export type EnrichmentField = "workEmail" | "personalEmail" | "phone";

export interface EnrichmentInput {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  company_city?: string | null;
  company_country?: string | null;
  fields: ("workEmail" | "personalEmail" | "phone")[];
}

export interface FieldEnrichmentResult {
  value: string | null;
  provider: string | null;
  confidence?: number | null;
  status: "ROUTED" | "FOUND" | "NOT_FOUND" | "SKIPPED" | "FAILED" | "INVALID";
  type?: "GENERIC" | "SPECIFIC" | "PERSONAL" | "MOBILE" | null;
  reason?: string;
  verified?: boolean;
}

export interface ProviderEmailResult {
  email: string;
  provider: "prospeo" | "tomba";
  confidence: number;
  type: "GENERIC" | "SPECIFIC";
}

export interface ProviderPhoneResult {
  phone: string;
  provider: "icypeas" | "enrich.so";
  type?: "MOBILE";
  confidence?: number;
}

export interface ProviderPersonalEmailResult {
  email: string;
  provider: "leadmagic" | "enrich.so";
  type?: "PERSONAL";
  confidence?: number;
}

export interface PlannedWaterfall {
  workEmail?: string[];
  personalEmail?: string[];
  phone?: string[];
}

export interface Layer0RoutingMetadata {
  requestedFields: EnrichmentField[];
  primaryIdentifier: "domain" | "company_name";
  hasPersonName: boolean;
  domainMxValid?: boolean | null;
  plannedWaterfall: PlannedWaterfall;
  skippedFields?: { field: EnrichmentField; reason: string }[];
}

export interface EnrichmentOutput {
  success: boolean;
  workEmail: FieldEnrichmentResult | null;
  personalEmail: FieldEnrichmentResult | null;
  phone: FieldEnrichmentResult | null;
  cached: boolean;
  totalCost: number;
  routing: Layer0RoutingMetadata;
}
