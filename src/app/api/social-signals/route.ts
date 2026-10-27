import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { socialIngestionService } from '@/lib/social/socialIngestionService';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { SocialPlatform } from '@/lib/social/types';

const ALLOWED_PLATFORMS: SocialPlatform[] = ['reddit', 'hackernews', 'rss'];
const MAX_READ_LIMIT = 100;
const DEFAULT_READ_LIMIT = 20;
const MAX_INGEST_LIMIT = 50;
const DEFAULT_INGEST_LIMIT = 10;

// In-memory sliding window rate limiter
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_POST_REQUESTS_PER_WINDOW = 10; // Max 10 collection triggers per window
const postRequestTimestamps = new Map<string, number[]>();

function checkRateLimit(callerId: string): boolean {
  const now = Date.now();
  const history = (postRequestTimestamps.get(callerId) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (history.length >= MAX_POST_REQUESTS_PER_WINDOW) {
    return false;
  }
  history.push(now);
  postRequestTimestamps.set(callerId, history);
  return true;
}

/**
 * Validates request authorization via Bearer API secret or authenticated session cookie.
 * Never prints or leaks secrets in responses or logs.
 */
async function isAuthorized(req: NextRequest): Promise<boolean> {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const configuredSecret = process.env.INTERNAL_API_SECRET || process.env.LEADPILOT_API_KEY;

    if (configuredSecret && configuredSecret.length >= 16 && token) {
      try {
        const tokenBuf = Buffer.from(token);
        const secretBuf = Buffer.from(configuredSecret);
        if (tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf)) {
          return true;
        }
      } catch {
        // Fall through to session check on buffer error
      }
    }
  }

  // 2. Cookie-based active session (only if lp_session cookie is actually present)
  const sessionCookie = req.cookies.get('lp_session')?.value;
  if (sessionCookie) {
    try {
      const userId = await getAuthenticatedUserId();
      if (userId) return true;
    } catch {
      // Unauthenticated
    }
  }

  return false;
}

export async function GET(req: NextRequest) {
  try {
    // 1. Authorization enforcement
    const authorized = await isAuthorized(req);
    if (!authorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required to view social signals.' },
        { status: 401 }
      );
    }

    // 2. Query parameter validation
    const { searchParams } = new URL(req.url);
    const platformParam = searchParams.get('platform');
    const limitParam = searchParams.get('limit');
    const sinceParam = searchParams.get('since');

    let platform: SocialPlatform | undefined = undefined;
    if (platformParam) {
      if (!ALLOWED_PLATFORMS.includes(platformParam as SocialPlatform)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid platform parameter '${platformParam}'. Allowed values: ${ALLOWED_PLATFORMS.join(', ')}`,
          },
          { status: 400 }
        );
      }
      platform = platformParam as SocialPlatform;
    }

    let limit = DEFAULT_READ_LIMIT;
    if (limitParam !== null) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > MAX_READ_LIMIT) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid limit parameter. Must be an integer between 1 and ${MAX_READ_LIMIT}`,
          },
          { status: 400 }
        );
      }
      limit = parsed;
    }

    let since: string | undefined = undefined;
    if (sinceParam) {
      const parsedDate = Date.parse(sinceParam);
      if (isNaN(parsedDate)) {
        return NextResponse.json(
          { success: false, error: 'Invalid since parameter. Must be a valid ISO-8601 date string.' },
          { status: 400 }
        );
      }
      since = new Date(parsedDate).toISOString();
    }

    const signals = await socialIngestionService.getStoredSignals({ platform, limit, since });

    return NextResponse.json({
      success: true,
      count: signals.length,
      signals,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve social signals.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authorization enforcement
    const authorized = await isAuthorized(req);
    if (!authorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required to ingest social signals.' },
        { status: 401 }
      );
    }

    // 2. Rate limiting check
    const callerId =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';

    if (!checkRateLimit(callerId)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded: Maximum 10 collection requests permitted per minute.',
        },
        { status: 429 }
      );
    }

    // 3. Request body parsing and validation
    const body = await req.json().catch(() => ({}));
    const rawQuery = body.query !== undefined ? String(body.query).trim() : 'looking for agency OR need website OR need crm';

    if (rawQuery.length < 2 || rawQuery.length > 200) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameter. Must be a non-empty string between 2 and 200 characters.',
        },
        { status: 400 }
      );
    }

    let limit = DEFAULT_INGEST_LIMIT;
    if (body.limit !== undefined) {
      const parsedLimit = parseInt(String(body.limit), 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_INGEST_LIMIT) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid limit parameter. Must be an integer between 1 and ${MAX_INGEST_LIMIT}`,
          },
          { status: 400 }
        );
      }
      limit = parsedLimit;
    }

    let platforms: SocialPlatform[] | undefined = undefined;
    if (body.platforms !== undefined) {
      if (!Array.isArray(body.platforms)) {
        return NextResponse.json(
          { success: false, error: 'Invalid platforms parameter. Must be an array of platform strings.' },
          { status: 400 }
        );
      }

      for (const p of body.platforms) {
        if (!ALLOWED_PLATFORMS.includes(p)) {
          return NextResponse.json(
            {
              success: false,
              error: `Invalid platform '${p}'. Allowed values: ${ALLOWED_PLATFORMS.join(', ')}`,
            },
            { status: 400 }
          );
        }
      }
      platforms = body.platforms as SocialPlatform[];
    }

    // 4. Ingestion execution
    const report = await socialIngestionService.ingestSignals({
      query: rawQuery,
      limit,
      platforms,
      saveToDatabase: true,
    });

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Failed to execute social signal ingestion.' },
      { status: 500 }
    );
  }
}
