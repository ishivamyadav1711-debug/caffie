import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { SenderPoolService } from '@/lib/senders/senderPoolService';

export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Authentication session required.' },
        { status: 401 }
      );
    }

    const pool = await SenderPoolService.getSenderPool(userId);
    return NextResponse.json({
      success: true,
      pool,
    });
  } catch (err: any) {
    console.error('[API /api/senders] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch sender pool.' },
      { status: 500 }
    );
  }
}
