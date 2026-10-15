import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { SenderPoolService } from '@/lib/senders/senderPoolService';
import { OwnershipGuard } from '@/lib/auth/ownershipGuard';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Authentication session required.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'disconnect';

    // Verify ownership
    const check = await OwnershipGuard.validateSenderOwnership(userId, id);
    if (!check.valid) {
      return NextResponse.json(
        { success: false, error: check.errorMessage || 'Sender ownership check failed.' },
        { status: 403 }
      );
    }

    if (action === 'disconnect') {
      await SenderPoolService.disconnectSender(userId, id);
      return NextResponse.json({ success: true, message: 'Sender disconnected.' });
    } else if (action === 'reconnect') {
      const res = await SenderPoolService.reconnectSender(userId, id);
      return NextResponse.json({ success: true, needsOAuth: res.needsOAuth });
    } else {
      return NextResponse.json(
        { success: false, error: `Invalid action: ${action}` },
        { status: 400 }
      );
    }
  } catch (err: any) {
    console.error('[API /api/senders/[id]] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to update sender account.' },
      { status: 500 }
    );
  }
}
