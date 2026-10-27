import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { intentClassificationService } from '@/lib/social/intentClassificationService';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';

// Sliding-window rate limiting for classification
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_CLASSIFY_REQUESTS_PER_WINDOW = 20;
const classifyRequestTimestamps = new Map<string, number[]>();

function checkRateLimit(callerId: string): boolean {
  const now = Date.now();
  const history = (classifyRequestTimestamps.get(callerId) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (history.length >= MAX_CLASSIFY_REQUESTS_PER_WINDOW) {
    return false;
  }
  history.push(now);
  classifyRequestTimestamps.set(callerId, history);
  return true;
}

async function isAuthorized(req: NextRequest): Promise<boolean> {
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
        // Fall through
      }
    }
  }

  // Session check (only if lp_session cookie is present)
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

export async function POST(req: NextRequest) {
  try {
    const authorized = await isAuthorized(req);
    if (!authorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required to run intent classification.' },
        { status: 401 }
      );
    }

    const callerId =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';

    if (!checkRateLimit(callerId)) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded: Maximum 20 classification requests permitted per minute.' },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const maxAgeDays =
      typeof body.maxAgeDays === 'number' && body.maxAgeDays > 0 ? body.maxAgeDays : undefined;

    // Mode 1: Dry-run / ephemeral preview without storing to DB
    if (body.previewText !== undefined || body.previewTitle !== undefined) {
      const title = String(body.previewTitle || '').trim();
      const contentText = String(body.previewText || '').trim();

      if (title.length + contentText.length < 3) {
        return NextResponse.json(
          { success: false, error: 'Preview content must contain at least 3 characters.' },
          { status: 400 }
        );
      }

      const result = await intentClassificationService.classifySignal(
        {
          title,
          contentText,
          sourcePlatform: 'preview',
          publicationTimestamp: body.previewTimestamp || null,
          metadata: body.previewMetadata || null,
        },
        {
          forceDeterministic: body.forceDeterministic,
          maxAgeDays,
        }
      );

      return NextResponse.json({ success: true, preview: true, result });
    }

    // Mode 2: Single signal classification by ID
    if (body.signalId) {
      const signalId = String(body.signalId).trim();
      const res = await intentClassificationService.classifyAndStoreSignal(signalId, {
        forceDeterministic: body.forceDeterministic,
        maxAgeDays,
      });

      if (!res.success) {
        return NextResponse.json(
          { success: false, error: res.error },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, classification: res.classification });
    }

    // Mode 3: Batch classification of unclassified signals
    if (body.batch) {
      const limit = body.limit ? parseInt(String(body.limit), 10) : 20;
      const reclassifyAll = Boolean(body.reclassifyAll);
      const forceDeterministic = Boolean(body.forceDeterministic);

      const report = await intentClassificationService.batchClassifySignals({
        limit,
        reclassifyAll,
        forceDeterministic,
        maxAgeDays,
      });

      return NextResponse.json({ success: true, batchReport: report });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid request: must specify signalId, batch: true, or previewText.' },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Failed to process classification request.' },
      { status: 500 }
    );
  }
}
