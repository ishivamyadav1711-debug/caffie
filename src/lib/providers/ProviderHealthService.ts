import { googlePlacesCircuitBreaker, osmCircuitBreaker } from '../resilience/CircuitBreaker';
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
  googlePlaces: ProviderHealth;
  osm: ProviderHealth;
}

export class ProviderHealthService {
  /**
   * Checks the health and readiness of external business discovery providers.
   */
  public checkHealth(): SystemProvidersHealth {
    const rawGoogleKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    const googleApiKey = rawGoogleKey ? rawGoogleKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    const isGoogleEnabled = process.env.GOOGLE_PLACES_ENABLED !== 'false';
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
        message: 'Google Places provider is explicitly disabled via GOOGLE_PLACES_ENABLED=false.',
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

    // OpenStreetMap Health
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
      googlePlaces: googleHealth,
      osm: osmHealth,
    };
  }

  /**
   * Helper to check if Google Places is ready to be used as Primary.
   */
  public isGooglePlacesReady(): boolean {
    return this.checkHealth().googlePlaces.healthy;
  }

  /**
   * Helper to check if OSM is ready to be used as Fallback.
   */
  public isOsmReady(): boolean {
    return this.checkHealth().osm.healthy;
  }
}

export const providerHealthService = new ProviderHealthService();
