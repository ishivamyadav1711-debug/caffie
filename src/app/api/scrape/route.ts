import { NextRequest, NextResponse } from 'next/server';
import { MultiSourceSearchEngine } from '@/lib/social/multiSourceSearchEngine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyword = (body.keyword || 'looking for CRM').trim();

    console.log(`[Scrape Route] Initiating multi-source search for keyword: "${keyword}"...`);

    const result = await MultiSourceSearchEngine.search({
      keyword,
      limitPerSource: 10,
      includeHistorical: true,
    });

    return NextResponse.json({
      success: true,
      keyword: result.query,
      expandedQueries: result.expandedQueries,
      expansionMethod: result.expansionMethod,
      llmProviderUsed: result.llmProviderUsed,
      sourceStatuses: result.sourceStatuses,
      totalFound: result.totalFound,
      liveCount: result.liveCount,
      historicalCount: result.historicalCount,
      leads: result.leads,
      emptyReason: result.emptyReason,
      // Backward compatibility aliases
      count: result.totalFound,
    });
  } catch (err: any) {
    console.error('[Scrape API Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Scraping and scoring failed' },
      { status: 500 }
    );
  }
}
