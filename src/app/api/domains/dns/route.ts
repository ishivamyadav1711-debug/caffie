import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { DnsVerificationService } from '@/lib/senders/dnsVerificationService';
import { AdaptiveCapacityEngine } from '@/lib/senders/adaptiveCapacityEngine';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { domainId, dkimSelector } = await req.json();
    if (!domainId) return NextResponse.json({ success: false, error: 'Domain ID is required' }, { status: 400 });

    const domainRec = await prisma.domainHealth.findUnique({ where: { id: domainId, userId } });
    if (!domainRec) return NextResponse.json({ success: false, error: 'Domain not found' }, { status: 404 });

    const dnsResult = await DnsVerificationService.verifyDomain(domainRec.domain, dkimSelector);

    // Determine overall health state from DNS
    let healthState = 'HEALTHY';
    if (dnsResult.spf.status !== 'VERIFIED' || dnsResult.dmarc.status !== 'VERIFIED') {
      healthState = 'CRITICAL';
    } else if (dkimSelector && dnsResult.dkim.status !== 'VERIFIED') {
      healthState = 'WARNING';
    }

    const updated = await prisma.domainHealth.update({
      where: { id: domainId },
      data: {
        spfStatus: dnsResult.spf.status,
        spfRecord: dnsResult.spf.record,
        dkimStatus: dnsResult.dkim.status,
        dkimSelector: dkimSelector || domainRec.dkimSelector,
        dkimRecord: dnsResult.dkim.record,
        dmarcStatus: dnsResult.dmarc.status,
        dmarcRecord: dnsResult.dmarc.record,
        dnsLastCheckedAt: new Date(),
        healthState
      }
    });

    await prisma.domainHealthSnapshot.create({
      data: {
        domainId,
        spfStatus: dnsResult.spf.status,
        dkimStatus: dnsResult.dkim.status,
        dmarcStatus: dnsResult.dmarc.status,
        source: 'DNS'
      }
    });

    // Re-evaluate sender capacities if domain became CRITICAL
    if (healthState === 'CRITICAL' && domainRec.healthState !== 'CRITICAL') {
      const senders = await prisma.senderAccount.findMany({ where: { userId, email: { endsWith: `@${domainRec.domain}` } } });
      for (const sender of senders) {
        await AdaptiveCapacityEngine.calculateSenderCapacity(sender.id);
      }
    }

    return NextResponse.json({ success: true, domain: updated, verification: dnsResult });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
