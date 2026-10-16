import { rapidApiCircuitBreaker, googlePlacesCircuitBreaker, osmCircuitBreaker } from '../resilience/CircuitBreaker';
import { googleUsageTracker } from '../billing/GoogleUsageTracker';

export type ProviderFailureReason =
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'QUOTA_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'CONFIGURATION_ERROR';

export interface ProviderHealth {
  enabled: boolean;
  configured: boolean;
  healthy: boolean;
  reason?: ProviderFailureReason;
  message?: string;
}

export interface SystemProvidersHealth {
  primaryProvider: string;
  rapidapi: ProviderHealth;
  googlePlaces: ProviderHealth;
  osm: ProviderHealth;
}

export class ProviderHealthService {
  /**
   * Checks the health and readiness of external business discovery providers.
   * Priority: RapidAPI Maps Data (Primary) -> Google Places (Modular / Disabled by default) -> OSM (Fallback)
   */
  public checkHealth(): SystemProvidersHealth {
    // 1. RapidAPI Maps Data Health (Primary Discovery Provider)
    const rawRapidApiKey = process.env.RAPIDAPI_KEY;
    const rapidApiKey = rawRapidApiKey ? rawRapidApiKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    const isRapidApiEnabled = process.env.RAPIDAPI_ENABLED !== 'false';
    const isMock = process.env.RAPIDAPI_MOCK_MODE === 'true' || rapidApiKey === 'mock' || rapidApiKey === 'demo';
    const isRapidApiConfigured = Boolean(isMock || (rapidApiKey && rapidApiKey.length > 0));
    const isRapidApiCircuitOpen = rapidApiCircuitBreaker.getState() === 'OPEN';

    let rapidApiHealth: ProviderHealth;

    if (!isRapidApiEnabled) {
      rapidApiHealth = {
        enabled: false,
        configured: isRapidApiConfigured,
        healthy: false,
        reason: 'CONFIGURATION_ERROR',
        message: 'RapidAPI provider is explicitly disabled via RAPIDAPI_ENABLED=false.',
      };
    } else if (!isRapidApiConfigured) {
      rapidApiHealth = {
        enabled: true,
        configured: false,
        healthy: false,
        reason: 'MISSING_API_KEY',
        message: 'RAPIDAPI_KEY is not configured on the server.',
      };
    } else if (isRapidApiCircuitOpen) {
      rapidApiHealth = {
        enabled: true,
        configured: true,
        healthy: false,
        reason: 'TIMEOUT',
        message: 'RapidAPI circuit breaker is OPEN due to repeated failures or timeouts.',
      };
    } else {
      rapidApiHealth = {
        enabled: true,
        configured: true,
        healthy: true,
        message: isMock ? 'RapidAPI Maps Data is operating in safe local MOCK/DEMO mode.' : undefined,
      };
    }

    // 2. Google Places Health (Modular: Disabled by default, activated ONLY via GOOGLE_PLACES_ENABLED=true)
    const rawGoogleKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    const googleApiKey = rawGoogleKey ? rawGoogleKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    const isGoogleEnabled = process.env.GOOGLE_PLACES_ENABLED === 'true';
    const isGoogleConfigured = Boolean(googleApiKey && googleApiKey.length > 0);
    const isGoogleCircuitOpen = googlePlacesCircuitBreaker.getState() === 'OPEN';
    const budgetCheck = googleUsageTracker.canExecuteGoogleRequest();

    let googleHealth: ProviderHealth;

    if (!isGoogleEnabled) {
      googleHealth = {
        enabled: false,
        configured: isGoogleConfigured,
        healthy: false,
        reason: 'CONFIGURATION_ERROR',
        message: 'Google Places provider is disabled by default. Set GOOGLE_PLACES_ENABLED=true to activate.',
      };
    } else if (!isGoogleConfigured) {
      googleHealth = {
        enabled: true,
        configured: false,
        healthy: false,
        reason: 'MISSING_API_KEY',
        message: 'GOOGLE_PLACES_API_KEY is not configured on the server.',
      };
    } else if (isGoogleCircuitOpen) {
      googleHealth = {
        enabled: true,
        configured: true,
        healthy: false,
        reason: 'TIMEOUT',
        message: 'Google Places circuit breaker is OPEN due to repeated failures or timeouts.',
      };
    } else if (!budgetCheck.allowed) {
      googleHealth = {
        enabled: true,
        configured: true,
        healthy: false,
        reason: 'QUOTA_ERROR',
        message: budgetCheck.reason || 'Google Places usage limit reached.',
      };
    } else {
      googleHealth = {
        enabled: true,
        configured: true,
        healthy: true,
      };
    }

    // 3. OpenStreetMap Health (Secondary / Fallback Provider)
    const isOsmEnabled = process.env.OSM_ENABLED !== 'false';
    const isOsmCircuitOpen = osmCircuitBreaker.getState() === 'OPEN';

    let osmHealth: ProviderHealth;

    if (!isOsmEnabled) {
      osmHealth = {
        enabled: false,
        configured: true,
        healthy: false,
        reason: 'CONFIGURATION_ERROR',
        message: 'OpenStreetMap provider is disabled via OSM_ENABLED=false.',
      };
    } else if (isOsmCircuitOpen) {
      osmHealth = {
        enabled: true,
        configured: true,
        healthy: false,
        reason: 'TIMEOUT',
        message: 'OpenStreetMap circuit breaker is OPEN.',
      };
    } else {
      osmHealth = {
        enabled: true,
        configured: true,
        healthy: true,
      };
    }

    return {
      primaryProvider: (process.env.PRIMARY_DISCOVERY_PROVIDER || 'rapidapi').toLowerCase(),
      rapidapi: rapidApiHealth,
      googlePlaces: googleHealth,
      osm: osmHealth,
    };
  }

  public isRapidApiReady(): boolean {
    return this.checkHealth().rapidapi.healthy;
  }

  public isGooglePlacesReady(): boolean {
    return this.checkHealth().googlePlaces.healthy;
  }

  public isOsmReady(): boolean {
    return this.checkHealth().osm.healthy;
  }
}

export const providerHealthService = new ProviderHealthService();
