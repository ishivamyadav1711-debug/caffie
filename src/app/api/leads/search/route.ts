import { NextRequest, NextResponse } from 'next/server';
import { validateLocation } from '@/data/geographyData';
import { pipelineOrchestrator } from '@/lib/orchestrator/pipelineOrchestrator';
import { searchService } from '@/services/SearchService';
import { jobManager } from '@/jobs/JobManager';
import { SearchRequestPayload } from '@/types';
import { waitUntil } from '@vercel/functions';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Malformed JSON payload in request body.',
          code: 'INVALID_JSON',
          leads: [],
        },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const isSync = url.searchParams.get('sync') === 'false' || body.sync === false ? false : true;
    const requestedEngine = url.searchParams.get('engine') || body.engine;

    const {
      country = 'India',
      state,
      city,
      industry,
      contactFilter = 'All Contacts',
      websiteFilter = 'Any Website',
      limit = 100,
      minRating,
      minReviews,
      excludePerfectRating,
      requirePositiveReviewEvidence,
      reviewSort = 'default',
      highNetWorthFilter,
      financialFilterMode,
    } = body;

    // 1. Strict Geographic Validation (India, USA, Canada)
    const locValidation = validateLocation(country, state, city);
    if (!locValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: locValidation.error || 'Invalid geographic location specification.',
          code: 'INVALID_LOCATION',
          leads: [],
        },
        { status: 400 }
      );
    }

    // 1.1 Verify Country is in ALLOWED_DISCOVERY_COUNTRIES
    const allowedCountriesList = (process.env.ALLOWED_DISCOVERY_COUNTRIES || 'IN,US,CA')
      .split(',')
      .map((c) => c.trim().toUpperCase());
    if (!locValidation.countryCode || !allowedCountriesList.includes(locValidation.countryCode)) {
      return NextResponse.json(
        {
          success: false,
          error: `Country "${country}" is not supported. Supported discovery countries are: ${allowedCountriesList.join(', ')}.`,
          code: 'UNSUPPORTED_COUNTRY',
          leads: [],
        },
        { status: 400 }
      );
    }

    if (!industry || typeof industry !== 'string' || industry.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Industry is required.',
          code: 'MISSING_INDUSTRY',
          leads: [],
        },
        { status: 400 }
      );
    }

    // Enforce server-side lead limit ceiling (default 20, selectable 5-20, safe default 10)
    const maxLeadsConfig = parseInt(process.env.MAX_LEADS_PER_RUN || '20', 10);
    const requestedLimit = Math.min(Math.max(Number(limit) || 10, 1), maxLeadsConfig);
    const searchPayload: SearchRequestPayload = {
      country: locValidation.country,
      state: locValidation.matchedState,
      city: locValidation.matchedCity || (city ? String(city).trim() : undefined),
      industry: industry.trim(),
      contactFilter,
      websiteFilter,
      limit: requestedLimit,

      minRating: typeof minRating === 'number' ? minRating : undefined,
      minReviews: typeof minReviews === 'number' ? minReviews : undefined,
      excludePerfectRating: Boolean(excludePerfectRating),
      requirePositiveReviewEvidence: Boolean(requirePositiveReviewEvidence),
      reviewSort,
      highNetWorthFilter: Boolean(highNetWorthFilter),
      financialFilterMode: financialFilterMode === 'BROAD_FINANCIAL_SCALE' ? 'BROAD_FINANCIAL_SCALE' : 'STRICT_NET_WORTH',
    };

    // If caller explicitly requests pipeline orchestrator engine
    if (requestedEngine === 'pipeline') {
      try {
        const result = await pipelineOrchestrator.executePipeline(searchPayload as any);
        return NextResponse.json({
          success: true,
          leads: result.leads,
          results: result.leads,
          summary: result.summary,
          totalDiscovered: result.totalDiscovered,
          totalMatched: result.totalMatched,
          jobId: result.jobId,
          pipelineRunId: result.pipelineRunId,
          sourceStatus: result.sourceStatus || 'COMPLETE',
          providers: result.providers,
          attribution: 'LeadPilot Pipeline • Real Verified Data',
        });
      } catch (pipelineErr: any) {
        console.warn('[PipelineOrchestrator Fallback to SearchService]:', pipelineErr.message);
      }
    }

    // Default: Dispatch via searchService (supports both asynchronous polling and synchronous execution)
    const result = await searchService.startSearch(searchPayload as any, isSync);

    if (!isSync) {
      const inFlightPromise = jobManager.getInFlightPromise(searchPayload as any);
      if (inFlightPromise) {
        waitUntil(inFlightPromise);
      }
    }

    return NextResponse.json(result, {
      status: result.success === false ? 400 : 200,
    });
  } catch (error: any) {
    console.error('[Search API Fatal Error]:', error);
    let msg = error.message || 'An error occurred while executing discovery pipeline.';
    if (msg.toLowerCase().includes('prisma') || msg.toLowerCase().includes('postgres') || msg.includes('DATABASE_URL')) {
      msg = 'Database service is temporarily unavailable or misconfigured. Search completed with safe in-memory fallback.';
    } else if (msg.includes('timeout')) {
      msg = 'Discovery service timed out. Please try a narrower city search or check network.';
    }

    return NextResponse.json(
      {
        success: false,
        error: msg,
        code: 'SEARCH_FAILED',
        leads: [],
        results: [],
      },
      { status: 500 }
    );
  }
}

