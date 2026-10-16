import { NextResponse } from 'next/server';
import { providerHealthService } from '@/lib/providers/ProviderHealthService';

export async function GET() {
  const health = providerHealthService.checkHealth();

  // RapidAPI Maps Data (Primary Discovery Provider)
  const rapidApiConfigured = Boolean(health.rapidapi.configured && health.rapidapi.enabled);
  let rapidApiStatus: 'READY' | 'NOT_CONFIGURED' | 'DISABLED' | 'AUTH_ERROR' | 'QUOTA_EXCEEDED' | 'TIMEOUT' | 'NETWORK_ERROR' = 'READY';

  if (!health.rapidapi.enabled) {
    rapidApiStatus = 'DISABLED';
  } else if (!health.rapidapi.configured) {
    rapidApiStatus = 'NOT_CONFIGURED';
  } else if (!health.rapidapi.healthy) {
    const reason = health.rapidapi.reason || '';
    if (reason.includes('QUOTA')) rapidApiStatus = 'QUOTA_EXCEEDED';
    else if (reason.includes('TIMEOUT')) rapidApiStatus = 'TIMEOUT';
    else if (reason.includes('AUTH') || reason.includes('KEY')) rapidApiStatus = 'AUTH_ERROR';
    else rapidApiStatus = 'NETWORK_ERROR';
  }

  const isRapidApiReachable = rapidApiConfigured && rapidApiStatus === 'READY';
  const rapidApiErrorMessage =
    rapidApiStatus === 'READY' ? null : health.rapidapi.message || health.rapidapi.reason || 'Provider not ready';

  // Google Places (Modular: Disabled by default, activated ONLY via GOOGLE_PLACES_ENABLED=true)
  const googleConfigured = Boolean(health.googlePlaces.configured && health.googlePlaces.enabled);
  let googleStatus: 'READY' | 'NOT_CONFIGURED' | 'DISABLED' | 'AUTH_ERROR' | 'QUOTA_EXCEEDED' | 'TIMEOUT' | 'NETWORK_ERROR' = 'READY';

  if (!health.googlePlaces.enabled) {
    googleStatus = 'DISABLED';
  } else if (!health.googlePlaces.configured) {
    googleStatus = 'NOT_CONFIGURED';
  } else if (!health.googlePlaces.healthy) {
    const reason = health.googlePlaces.reason || '';
    if (reason.includes('QUOTA')) googleStatus = 'QUOTA_EXCEEDED';
    else if (reason.includes('TIMEOUT')) googleStatus = 'TIMEOUT';
    else if (reason.includes('AUTH') || reason.includes('KEY')) googleStatus = 'AUTH_ERROR';
    else googleStatus = 'NETWORK_ERROR';
  }

  const isGoogleReachable = googleConfigured && googleStatus === 'READY';
  const googleErrorMessage =
    googleStatus === 'READY' ? null : health.googlePlaces.message || health.googlePlaces.reason || 'Provider not ready';

  // OpenStreetMap (Secondary / Fallback Provider)
  const osmConfigured = Boolean(health.osm.configured && health.osm.enabled);
  const osmStatus: 'READY' | 'NOT_CONFIGURED' | 'DISABLED' | 'NETWORK_ERROR' = !health.osm.enabled
    ? 'DISABLED'
    : health.osm.healthy
    ? 'READY'
    : 'NETWORK_ERROR';

  return NextResponse.json({
    primaryProvider: (process.env.PRIMARY_DISCOVERY_PROVIDER || 'rapidapi').toLowerCase(),
    maxLeadsPerRun: parseInt(process.env.MAX_LEADS_PER_RUN || '20', 10),
    allowedCountries: process.env.ALLOWED_DISCOVERY_COUNTRIES || 'IN,US,CA',
    rapidapi: {
      configured: rapidApiConfigured,
      reachable: isRapidApiReachable,
      status: rapidApiStatus,
      lastCheckedAt: new Date().toISOString(),
      error: rapidApiErrorMessage,
    },
    googlePlaces: {
      configured: googleConfigured,
      reachable: isGoogleReachable,
      status: googleStatus,
      lastCheckedAt: new Date().toISOString(),
      error: googleErrorMessage,
    },
    osm: {
      configured: osmConfigured,
      status: osmStatus,
    },
  });
}
