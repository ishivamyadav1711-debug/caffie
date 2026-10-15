import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';

export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const domains = await prisma.domainHealth.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, domains });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { domain } = await req.json();
    if (!domain) return NextResponse.json({ success: false, error: 'Domain is required' }, { status: 400 });

    const cleanDomain = domain.trim().toLowerCase();

    // Upsert to ensure no duplicate for this user
    const newDomain = await prisma.domainHealth.upsert({
      where: {
        domain: cleanDomain
      },
      update: {},
      create: {
        userId,
        domain: cleanDomain,
        spfStatus: 'UNKNOWN',
        dkimStatus: 'UNKNOWN',
        dmarcStatus: 'UNKNOWN',
        healthState: 'HEALTHY'
      }
    });

    return NextResponse.json({ success: true, domain: newDomain });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const domainId = searchParams.get('id');
    
    if (!domainId) return NextResponse.json({ success: false, error: 'Domain ID required' }, { status: 400 });

    await prisma.domainHealth.delete({
      where: { id: domainId, userId }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
