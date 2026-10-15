import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { BulkOutreachService } from '@/lib/outreach/bulkOutreachService';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Authenticated session required.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { leadIds } = body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Array of leadIds is required.' },
        { status: 400 }
      );
    }

    const result = await BulkOutreachService.prepareBulkOutreach(userId, leadIds);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[API /api/outreach/bulk-prepare] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to prepare bulk outreach.' },
      { status: 500 }
    );
  }
}
