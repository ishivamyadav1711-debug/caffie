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
    const { approvedItems } = body;

    if (!Array.isArray(approvedItems) || approvedItems.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Array of approvedItems is required for execution.' },
        { status: 400 }
      );
    }

    const result = await BulkOutreachService.executeControlledSend(userId, approvedItems);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[API /api/outreach/bulk-send] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to execute bulk outreach.' },
      { status: 500 }
    );
  }
}
