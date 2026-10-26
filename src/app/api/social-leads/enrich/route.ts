import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enrichContact } from '@/lib/enrichment';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { leadId, author, company } = body;

    if (!leadId) {
      return NextResponse.json({ success: false, error: 'leadId is required' }, { status: 400 });
    }

    const lead = await (prisma as any).socialLead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      return NextResponse.json({ success: false, error: 'Social lead not found' }, { status: 404 });
    }

    const targetAuthor = (author || lead.author || 'Contact').trim();
    const targetCompany = (company || lead.company || '').trim();

    // Parse author name into first and last name
    const cleanName = targetAuthor.replace(/^[@u\/]/, '').trim();
    const nameParts = cleanName.split(/[\s_.]+/);
    const firstName = nameParts[0] || 'Member';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

    console.log(`[SocialLead Enrich] Triggering enrichment for ${firstName} ${lastName || ''} (Company: ${targetCompany || firstName})...`);

    const enrichmentResult = await enrichContact({
      first_name: firstName,
      last_name: lastName,
      company_name: targetCompany || firstName,
    });

    const enrichedEmail = enrichmentResult.workEmail?.value || null;
    const enrichedPhone = enrichmentResult.phone?.value || null;

    // Update in database if found
    if (enrichedEmail || enrichedPhone) {
      await (prisma as any).socialLead.update({
        where: { id: leadId },
        data: {
          enrichedEmail: enrichedEmail || undefined,
          enrichedProvider: enrichmentResult.workEmail?.provider || undefined,
          enrichedPhone: enrichedPhone || undefined,
          company: targetCompany || undefined,
        },
      });
    }

    return NextResponse.json({
      success: true,
      leadId,
      enrichedEmail,
      enrichedPhone,
      provider: enrichmentResult.workEmail?.provider || null,
      confidence: enrichmentResult.workEmail?.confidence || 0,
    });
  } catch (error: any) {
    console.error('[SocialLead Enrich Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Enrichment failed' },
      { status: 500 }
    );
  }
}
