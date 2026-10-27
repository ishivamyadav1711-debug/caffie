import { NextRequest, NextResponse } from 'next/server';
import { MultiSourceSearchEngine } from '@/lib/social/multiSourceSearchEngine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyword = (body.keyword || 'looking for CRM').trim();
    const limit = body.limit || 10;

    console.log(`[Social Scrape API] Querying multi-source social intent service for keyword: "${keyword}"...`);

    const result = await MultiSourceSearchEngine.search({
      keyword,
      limitPerSource: limit,
      includeHistorical: true,
    });

    return NextResponse.json({
      success: true,
      keyword: result.query,
      expandedQueries: result.expandedQueries,
      expansionMethod: result.expansionMethod,
      sourceStatuses: result.sourceStatuses,
      totalFound: result.totalFound,
      liveCount: result.liveCount,
      historicalCount: result.historicalCount,
      count: result.totalFound,
      leads: result.leads,
      emptyReason: result.emptyReason,
    });
  } catch (error: any) {
    console.error('[Social Scrape Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Scraping failed' },
      { status: 500 }
    );
  }
}
