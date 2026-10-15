import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { CapacityConfigService } from '@/lib/senders/capacityConfig';

export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Authentication session required.' },
        { status: 401 }
      );
    }

    const config = CapacityConfigService.getConfig();
    return NextResponse.json({
      success: true,
      config,
    });
  } catch (err: any) {
    console.error('[API /api/senders/capacity GET] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch capacity config.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Authentication session required.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { maxPerSenderPerDay, maxPerDomainPerDay, maxTotalDailyOutreach, targetDailyCapacity } = body;

    const updated = CapacityConfigService.updateConfig(userId, {
      maxPerSenderPerDay: typeof maxPerSenderPerDay === 'number' ? maxPerSenderPerDay : undefined,
      maxPerDomainPerDay: typeof maxPerDomainPerDay === 'number' ? maxPerDomainPerDay : undefined,
      maxTotalDailyOutreach: typeof maxTotalDailyOutreach === 'number' ? maxTotalDailyOutreach : undefined,
      targetDailyCapacity: typeof targetDailyCapacity === 'number' ? targetDailyCapacity : undefined,
    });

    return NextResponse.json({
      success: true,
      config: updated,
    });
  } catch (err: any) {
    console.error('[API /api/senders/capacity POST] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to update capacity config.' },
      { status: 500 }
    );
  }
}
