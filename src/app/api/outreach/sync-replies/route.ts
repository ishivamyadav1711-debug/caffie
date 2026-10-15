import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { GmailReplySyncService } from '@/lib/replies/gmailReplySyncService';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Authenticated session required.' },
        { status: 401 }
      );
    }

    const result = await GmailReplySyncService.syncRepliesForUser(userId);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('[API /api/outreach/sync-replies] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to sync Gmail replies.' },
      { status: 500 }
    );
  }
}
