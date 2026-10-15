import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { DnsVerificationService } from '@/lib/senders/dnsVerificationService';

export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Authentication session required.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const domain = searchParams.get('domain');
    const selector = searchParams.get('selector') || undefined;

    if (!domain) {
      return NextResponse.json(
        { success: false, error: 'Domain parameter is required for DNS verification.' },
        { status: 400 }
      );
    }

    const verification = await DnsVerificationService.verifyDomain(domain, selector);

    return NextResponse.json({
      success: true,
      verification,
    });
  } catch (err: any) {
    console.error('[API /api/senders/dns GET] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'DNS verification failed.' },
      { status: 500 }
    );
  }
}
