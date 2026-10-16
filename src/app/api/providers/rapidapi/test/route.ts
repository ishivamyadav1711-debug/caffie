import { NextRequest, NextResponse } from 'next/server';
import { rapidApiDiscoveryProvider } from '@/providers/RapidApiDiscoveryProvider';

export async function GET(req: NextRequest) {
  const isConfigured = rapidApiDiscoveryProvider.isConfigured();
  const rawKey = process.env.RAPIDAPI_KEY || '';
  const maskedKey = rawKey.length > 8 ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` : (rawKey ? '****' : null);

  const url = new URL(req.url);
  const runLiveTest = url.searchParams.get('live') === 'true';

  if (!runLiveTest) {
    return NextResponse.json({
      provider: 'rapidapi',
      configured: isConfigured,
      apiKeyMasked: maskedKey,
      host: process.env.RAPIDAPI_HOST || 'maps-data.p.rapidapi.com',
      endpointPath: process.env.RAPIDAPI_ENDPOINT_PATH || '/searchmaps.php',
      enabled: process.env.RAPIDAPI_ENABLED !== 'false',
      maxLeadsPerRun: parseInt(process.env.MAX_LEADS_PER_RUN || '20', 10),
      allowedCountries: process.env.ALLOWED_DISCOVERY_COUNTRIES || 'IN,US,CA',
      message: isConfigured
        ? 'RapidAPI Maps Data provider is configured. Pass ?live=true to run a live test query.'
        : 'RAPIDAPI_KEY is not configured on the server.',
    });
  }

  if (!isConfigured) {
    return NextResponse.json(
      {
        provider: 'rapidapi',
        configured: false,
        error: 'RAPIDAPI_KEY is missing or provider is disabled via RAPIDAPI_ENABLED=false.',
      },
      { status: 400 }
    );
  }

  const testParams = {
    industry: url.searchParams.get('industry') || 'Dentists',
    state: url.searchParams.get('state') || 'Texas',
    city: url.searchParams.get('city') || 'Austin',
    country: url.searchParams.get('country') || 'USA',
    limit: 5,
  };

  const result = await rapidApiDiscoveryProvider.discoverBusinesses(testParams);

  return NextResponse.json({
    provider: 'rapidapi',
    configured: true,
    testQuery: testParams,
    status: result.status,
    rawCount: result.rawCount,
    statusReason: result.statusReason,
    durationMs: result.durationMs,
    sampleBusinesses: result.businesses.slice(0, 2).map((b) => ({
      name: b.name,
      address: b.address,
      phone: b.phone,
      website: b.website,
      rating: b.rating,
      userRatingCount: b.userRatingCount,
    })),
  });
}
