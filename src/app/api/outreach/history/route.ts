import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get('leadId');
    const filter = (searchParams.get('filter') || 'ALL').toUpperCase();
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200);

    const whereClause: any = {};
    if (leadId) whereClause.businessId = leadId;

    if (filter === 'SENT') {
      whereClause.status = 'SENT';
    } else if (filter === 'FAILED') {
      whereClause.status = 'FAILED';
    } else if (filter === 'BOUNCED') {
      whereClause.status = 'BOUNCED';
    } else if (filter === 'QUEUED') {
      whereClause.status = 'QUEUED';
    } else if (filter === 'SKIPPED') {
      whereClause.status = 'SKIPPED';
    } else if (filter === 'REPLIED') {
      whereClause.inboundReplies = { some: {} };
    } else if (filter === 'NO_REPLY') {
      whereClause.status = 'SENT';
      whereClause.inboundReplies = { none: {} };
    }

    const outreaches = await prisma.outreach.findMany({
      where: whereClause,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            category: true,
            city: true,
            state: true,
            phone: true,
            email: true,
            websiteUrl: true,
          },
        },
        senderAccount: {
          select: {
            id: true,
            email: true,
            displayName: true,
            provider: true,
            status: true,
          },
        },
        inboundReplies: {
          select: {
            id: true,
            classification: true,
            receivedAt: true,
            subject: true,
            fromEmail: true,
          },
          take: 1,
        },
      },
    });

    return NextResponse.json({
      success: true,
      count: outreaches.length,
      outreaches: outreaches.map((o) => {
        const hasReply = o.inboundReplies && o.inboundReplies.length > 0;
        let replyStatus: 'Replied' | 'No Reply' | 'N/A' = 'N/A';
        if (o.status === 'SENT') {
          replyStatus = hasReply ? 'Replied' : 'No Reply';
        }

        return {
          id: o.id,
          leadId: o.businessId,
          businessName: o.business?.name || 'Unknown Business',
          channel: o.channel,
          recipient: o.recipient,
          senderEmail: o.senderAccount?.email || 'System Default',
          senderDisplayName: o.senderAccount?.displayName,
          subject: o.subject,
          message: o.message,
          status: o.status,
          replyStatus,
          repliesCount: o.inboundReplies?.length || 0,
          latestReply: hasReply ? o.inboundReplies[0] : null,
          provider: o.provider,
          providerMessageId: o.providerMessageId,
          gmailMessageId: o.gmailMessageId,
          gmailThreadId: o.gmailThreadId,
          evidenceUsed: o.evidenceUsed ? JSON.parse(o.evidenceUsed) : [],
          errorCode: o.errorCode,
          errorMessage: o.errorMessage,
          sentAt: o.sentAt,
          deliveredAt: o.deliveredAt,
          createdAt: o.createdAt,
        };
      }),
    });
  } catch (err: any) {
    console.error('Outreach history API error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch outreach history.' },
      { status: 500 }
    );
  }
}
