import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { outreachId, action, customSubject, customMessage } = body;

    if (!outreachId) {
      return NextResponse.json(
        { success: false, error: 'outreachId is required.' },
        { status: 400 }
      );
    }

    const userId = await getAuthenticatedUserId();

    const outreach = await prisma.outreach.findUnique({
      where: { id: outreachId },
      include: {
        campaign: true,
        business: true,
      },
    });

    if (!outreach) {
      return NextResponse.json(
        { success: false, error: 'Outreach record not found.' },
        { status: 404 }
      );
    }

    if (action === 'REJECT') {
      const updated = await prisma.outreach.update({
        where: { id: outreachId },
        data: {
          status: 'REJECTED',
        },
      });

      if (outreach.campaignId) {
        await prisma.campaignLead.updateMany({
          where: {
            campaignId: outreach.campaignId,
            leadId: outreach.businessId,
          },
          data: {
            status: 'STOPPED',
            stopReason: 'MANUAL_REJECTION',
          },
        });
      }

      await prisma.outreachAuditLog.create({
        data: {
          userId,
          businessId: outreach.businessId,
          outreachId: outreach.id,
          action: 'HUMAN_OUTREACH_REJECTED',
          channel: outreach.channel,
          metadata: JSON.stringify({ rejectedAt: new Date().toISOString() }),
        },
      });

      return NextResponse.json({
        success: true,
        status: 'REJECTED',
        message: 'Outreach draft rejected and suppressed from sending.',
      });
    }

    if (action === 'APPROVE') {
      const updated = await prisma.outreach.update({
        where: { id: outreachId },
        data: {
          status: 'APPROVED',
          ...(customSubject ? { subject: customSubject } : {}),
          ...(customMessage ? { message: customMessage } : {}),
        },
      });

      if (outreach.campaignId) {
        await prisma.campaignLead.updateMany({
          where: {
            campaignId: outreach.campaignId,
            leadId: outreach.businessId,
          },
          data: {
            status: 'IN_PROGRESS',
            ...(customSubject ? { customSubject } : {}),
            ...(customMessage ? { customBody: customMessage } : {}),
          },
        });
      }

      await prisma.outreachAuditLog.create({
        data: {
          userId,
          businessId: outreach.businessId,
          outreachId: outreach.id,
          action: 'HUMAN_OUTREACH_APPROVED',
          channel: outreach.channel,
          metadata: JSON.stringify({ approvedAt: new Date().toISOString() }),
        },
      });

      return NextResponse.json({
        success: true,
        status: 'APPROVED',
        message: 'Outreach draft approved for sending by authorized sender.',
        outreach: updated,
      });
    }

    // Default: Just update draft text
    const updated = await prisma.outreach.update({
      where: { id: outreachId },
      data: {
        ...(customSubject ? { subject: customSubject } : {}),
        ...(customMessage ? { message: customMessage } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      status: outreach.status,
      message: 'Outreach draft updated.',
      outreach: updated,
    });
  } catch (error: any) {
    console.error('[Outreach Approve Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update outreach approval' },
      { status: 500 }
    );
  }
}
