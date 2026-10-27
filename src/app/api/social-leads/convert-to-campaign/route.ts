import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GroundedOutreachGenerator } from '@/lib/outreach/groundedOutreachGenerator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      socialLeadId,
      campaignId,
      companyName,
      companyDomain,
      contactName,
      contactEmail,
      customDraftSubject,
      customDraftBody,
      productContext,
    } = body;

    if (!socialLeadId || !campaignId) {
      return NextResponse.json(
        { success: false, error: 'Both socialLeadId and campaignId are required.' },
        { status: 400 }
      );
    }

    // 1. Fetch SocialLead
    const socialLead = await (prisma as any).socialLead.findUnique({
      where: { id: socialLeadId },
    });

    if (!socialLead) {
      return NextResponse.json(
        { success: false, error: 'Social lead not found.' },
        { status: 404 }
      );
    }

    // 2. Fetch Campaign
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return NextResponse.json(
        { success: false, error: 'Campaign not found.' },
        { status: 404 }
      );
    }

    const recipientEmail = (contactEmail || socialLead.enrichedEmail || '').trim().toLowerCase();

    // 3. Suppression & Opt-out Check
    if (recipientEmail) {
      const isSuppressed = await prisma.suppressionList.findFirst({
        where: {
          contact: recipientEmail,
        },
      });

      if (isSuppressed) {
        return NextResponse.json(
          {
            success: false,
            error: `Contact ${recipientEmail} is on the suppression/opt-out list (${isSuppressed.reason}). Outreach blocked.`,
          },
          { status: 400 }
        );
      }
    }

    // 4. Resolve or create Business entity
    const targetBusinessName = (
      companyName ||
      socialLead.company ||
      socialLead.author ||
      'Prospective Business'
    ).trim();

    let business = await prisma.business.findFirst({
      where: {
        OR: [
          { name: { equals: targetBusinessName, mode: 'insensitive' } },
          ...(companyDomain ? [{ websiteUrl: { contains: companyDomain, mode: 'insensitive' as const } }] : []),
        ],
      },
    });

    if (!business) {
      const websiteUrl = companyDomain
        ? companyDomain.startsWith('http') ? companyDomain : `https://${companyDomain}`
        : null;

      business = await prisma.business.create({
        data: {
          name: targetBusinessName,
          category: 'B2B Social Lead',
          industry: 'Technology',
          websiteUrl,
          email: recipientEmail || null,
          status: 'New',
          opportunityScore: socialLead.score || 75,
        },
      });
    }

    // 5. Resolve or create Contact entity
    let contact = null;
    if (recipientEmail) {
      contact = await prisma.contact.findFirst({
        where: {
          businessId: business.id,
          email: recipientEmail,
        },
      });

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            businessId: business.id,
            name: contactName || socialLead.author || 'Decision Maker',
            email: recipientEmail,
            contactType: 'EMAIL',
            source: socialLead.platform,
            sourceUrl: socialLead.url,
            sourceProvider: socialLead.enrichedProvider || 'social_intent',
            verificationStatus: socialLead.enrichedEmail ? 'VERIFIED' : 'UNVERIFIED',
            confidence: socialLead.score ? socialLead.score / 100 : 0.8,
          },
        });
      }
    }

    // 6. Grounded Outreach Draft Generation
    let subject = customDraftSubject;
    let emailBody = customDraftBody;
    let evidenceQuote = socialLead.title;

    if (!subject || !emailBody) {
      const draftResult = await GroundedOutreachGenerator.generateDraft({
        platform: socialLead.platform,
        originalPostUrl: socialLead.url,
        postTitle: socialLead.title,
        postText: socialLead.selftext || socialLead.title,
        authorName: contactName || socialLead.author || undefined,
        companyName: business.name,
        intentCategory: socialLead.intentCategory || 'buy_intent',
        productContext,
      });

      subject = subject || draftResult.subject;
      emailBody = emailBody || draftResult.body;
      evidenceQuote = draftResult.evidenceQuote;
    }

    // 7. Upsert CampaignLead in PENDING (human review required) status
    const personalizationMeta = JSON.stringify({
      socialLeadId: socialLead.id,
      originalPostUrl: socialLead.url,
      platform: socialLead.platform,
      intentCategory: socialLead.intentCategory,
      evidenceQuote,
      generatedAt: new Date().toISOString(),
      requiresHumanApproval: true,
    });

    const campaignLead = await prisma.campaignLead.upsert({
      where: {
        campaignId_leadId: {
          campaignId: campaign.id,
          leadId: business.id,
        },
      },
      update: {
        status: 'PENDING',
        customSubject: subject,
        customBody: emailBody,
        aiPersonalization: personalizationMeta,
      },
      create: {
        campaignId: campaign.id,
        leadId: business.id,
        status: 'PENDING',
        customSubject: subject,
        customBody: emailBody,
        aiPersonalization: personalizationMeta,
      },
    });

    // 8. Create Outreach record in PENDING status for the approval queue
    const outreach = await prisma.outreach.create({
      data: {
        businessId: business.id,
        campaignId: campaign.id,
        channel: 'EMAIL',
        recipient: recipientEmail || `${socialLead.author || 'prospect'}@lead.internal`,
        subject,
        message: emailBody,
        evidenceUsed: evidenceQuote,
        status: 'PENDING', // Guaranteed: will not be sent without explicit user approval
      },
    });

    // 9. Audit Log Entry
    await prisma.outreachAuditLog.create({
      data: {
        businessId: business.id,
        outreachId: outreach.id,
        action: 'LEAD_ENROLLED_FROM_SOCIAL_SIGNAL',
        channel: 'EMAIL',
        metadata: JSON.stringify({
          socialLeadId: socialLead.id,
          platform: socialLead.platform,
          campaignId: campaign.id,
          score: socialLead.score,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      businessId: business.id,
      campaignLeadId: campaignLead.id,
      outreachId: outreach.id,
      businessName: business.name,
      contactEmail: recipientEmail,
      draft: {
        subject,
        body: emailBody,
        evidenceQuote,
      },
      status: 'PENDING_APPROVAL',
      message: 'Lead enrolled into campaign. Outreach draft saved and awaiting human approval.',
    });
  } catch (error: any) {
    console.error('[Convert to Campaign Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to convert social lead to campaign' },
      { status: 500 }
    );
  }
}
