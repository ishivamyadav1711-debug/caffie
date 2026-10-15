import { NextRequest, NextResponse } from 'next/server';
import { OutreachService } from '@/lib/outreach/outreachService';
import { OutreachEligibilityService } from '@/lib/outreach/outreachEligibility';
import { OutreachTemplateService } from '@/lib/outreach/outreachTemplates';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { OwnershipGuard } from '@/lib/auth/ownershipGuard';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { leadId, channel, previewOnly, campaignId, subject, body: customBody } = body;

    // Derive userId from authenticated session
    let userId = await getAuthenticatedUserId();
    if (!userId && process.env.NODE_ENV === 'test') {
      userId = body.userId;
    }

    if (!leadId || typeof leadId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Valid leadId parameter is required.' },
        { status: 400 }
      );
    }

    // Preview Mode: Generate message & verify eligibility without transmitting
    if (previewOnly) {
      const eligibility = await OutreachEligibilityService.checkEligibility(leadId);
      const generated = await OutreachTemplateService.generateMessage(leadId);

      if (!generated) {
        return NextResponse.json(
          { success: false, error: 'Lead not found or lacks data to generate outreach.' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        preview: true,
        eligibility,
        generated,
      });
    }

    // Validate campaign ownership if campaignId provided
    if (campaignId && userId) {
      const campaignCheck = await OwnershipGuard.validateCampaignOwnership(userId, campaignId);
      if (!campaignCheck.valid) {
        return NextResponse.json(
          { success: false, error: campaignCheck.errorMessage, errorCode: campaignCheck.errorCode },
          { status: 403 }
        );
      }
    }

    // Live Execution Mode: Pre-send validation, idempotency guard, real provider transmit, and DB persistence
    const result = await OutreachService.sendOutreach(
      leadId,
      channel,
      campaignId,
      userId,
      subject,
      customBody
    );

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.errorMessage || 'Outreach transmission failed.',
          errorCode: result.errorCode,
          outreach: result,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      outreach: result,
    });
  } catch (err: any) {
    console.error('Outreach API error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error processing outreach.' },
      { status: 500 }
    );
  }
}
