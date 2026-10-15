import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DnsVerificationService } from '@/lib/senders/dnsVerificationService';
import { AdaptiveCapacityEngine } from '@/lib/senders/adaptiveCapacityEngine';

export async function GET(req: NextRequest) {
  try {
    const domains = await prisma.domainHealth.findMany({
      where: {
        OR: [
          { lastEvaluation: null },
          { lastEvaluation: { lt: new Date(Date.now() - 6 * 60 * 60 * 1000) } }
        ]
      },
      take: 50
    });

    const results = [];

    for (const domain of domains) {
      try {
        const dnsResult = await DnsVerificationService.verifyDomain(domain.domain, domain.dkimSelector || undefined);

        let healthState = 'HEALTHY';
        if (dnsResult.spf.status !== 'VERIFIED' || dnsResult.dmarc.status !== 'VERIFIED') {
          healthState = 'CRITICAL';
        } else if (domain.dkimSelector && dnsResult.dkim.status !== 'VERIFIED') {
          healthState = 'WARNING';
        }

        await prisma.domainHealth.update({
          where: { id: domain.id },
          data: {
            spfStatus: dnsResult.spf.status,
            spfRecord: dnsResult.spf.record,
            dkimStatus: dnsResult.dkim.status,
            dkimRecord: dnsResult.dkim.record,
            dmarcStatus: dnsResult.dmarc.status,
            dmarcRecord: dnsResult.dmarc.record,
            dnsLastCheckedAt: new Date(),
            lastEvaluation: new Date(),
            healthState
          }
        });

        await prisma.domainHealthSnapshot.create({
          data: {
            domainId: domain.id,
            spfStatus: dnsResult.spf.status,
            dkimStatus: dnsResult.dkim.status,
            dmarcStatus: dnsResult.dmarc.status,
            source: 'DNS'
          }
        });

        if (healthState === 'CRITICAL' && domain.healthState !== 'CRITICAL') {
          if (domain.userId) {
            const senders = await prisma.senderAccount.findMany({
              where: { userId: domain.userId, email: { endsWith: `@${domain.domain}` } }
            });
            for (const sender of senders) {
              await AdaptiveCapacityEngine.calculateSenderCapacity(sender.id);
            }
          }
        }

        results.push({ domain: domain.domain, status: 'success' });
      } catch (err: any) {
        results.push({ domain: domain.domain, status: 'error', error: err.message });
      }
    }

    return NextResponse.json({ success: true, processed: results.length, results });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
