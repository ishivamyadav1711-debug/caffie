import { NextRequest, NextResponse } from 'next/server';
import { rapidApiDiscoveryProvider } from '@/providers/RapidApiDiscoveryProvider';

export async function GET(req: NextRequest) {
  const isConfigured = rapidApiDiscoveryProvider.isConfigured();
  const rawKey = process.env.RAPIDAPI_KEY || '';
  const maskedKey = rawKey.length > 8 ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` : (rawKey ? '****' : null);

  const url = new URL(req.url);
  const runLiveTest = url.searchParams.get('live') === 'true';

  const isMock = process.env.RAPIDAPI_MOCK_MODE === 'true' || rawKey === 'mock' || rawKey === 'demo';

  if (!runLiveTest) {
    return NextResponse.json({
      provider: 'rapidapi',
      configured: isConfigured,
      mockMode: isMock,
      apiKeyMasked: maskedKey,
      host: process.env.RAPIDAPI_HOST || 'maps-data.p.rapidapi.com',
      endpointPath: process.env.RAPIDAPI_ENDPOINT_PATH || '/searchmaps.php',
      enabled: process.env.RAPIDAPI_ENABLED !== 'false',
      maxLeadsPerRun: parseInt(process.env.MAX_LEADS_PER_RUN || '20', 10),
      allowedCountries: process.env.ALLOWED_DISCOVERY_COUNTRIES || 'IN,US,CA',
      message: isMock
        ? 'RapidAPI Maps Data provider is running in safe MOCK/DEMO mode (zero external credits consumed). Pass ?live=true to run a live connectivity test.'
        : isConfigured
        ? 'RapidAPI Maps Data provider is configured with API key. Pass ?live=true to run a live connectivity test.'
        : 'RAPIDAPI_KEY is not configured on the server. Set RAPIDAPI_KEY in .env.local.',
    });
  }

  const rawApiKey = process.env.RAPIDAPI_KEY;
  const apiKey = rawApiKey ? rawApiKey.trim().replace(/^["']|["']$/g, '').trim() : '';

  if (!apiKey || apiKey.length === 0 || apiKey === 'mock' || apiKey === 'demo') {
    return NextResponse.json(
      {
        provider: 'rapidapi',
        configured: false,
        error: 'RAPIDAPI_KEY is missing or empty in server environment. Please set RAPIDAPI_KEY in .env.local.',
      },
      { status: 400 }
    );
  }

  const testParams = {
    industry: url.searchParams.get('industry') || 'Dentists',
    state: url.searchParams.get('state') || 'Texas',
    city: url.searchParams.get('city') || 'Austin',
    country: url.searchParams.get('country') || 'USA',
    limit: Math.min(parseInt(url.searchParams.get('limit') || '2', 10), 5),
  };

  const result = await rapidApiDiscoveryProvider.executeLiveConnectivityCheck(testParams);

  return NextResponse.json({
    provider: 'rapidapi',
    mode: 'LIVE_CONNECTIVITY_DIAGNOSTIC',
    configured: true,
    testQuery: testParams,
    success: result.success,
    httpStatus: result.httpStatus,
    providerStatus: result.providerStatus,
    rawRecordsCount: result.rawRecordsCount,
    latencyMs: result.latencyMs,
    endpoint: result.endpoint,
    sampleVenues: result.sampleVenues,
    error: result.error || null,
  });
}
