import { NextRequest, NextResponse } from 'next/server';
import { UnsubscribeService } from '@/lib/outreach/unsubscribeService';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const directEmail = searchParams.get('email');

    let emailToUnsub: string | null = null;

    if (token) {
      const verified = UnsubscribeService.verifyToken(token);
      if (verified) {
        emailToUnsub = verified.email;
      }
    } else if (directEmail && directEmail.includes('@')) {
      emailToUnsub = directEmail.trim().toLowerCase();
    }

    if (!emailToUnsub) {
      return new NextResponse(
        `<!DOCTYPE html>
        <html>
          <head><title>Unsubscribe — Invalid Link</title></head>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc;">
            <div style="background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 480px; text-align: center;">
              <h2 style="color: #e11d48; margin-top: 0;">Invalid or Expired Link</h2>
              <p style="color: #64748b; font-size: 14px;">The unsubscribe link provided is invalid or has expired.</p>
            </div>
          </body>
        </html>`,
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    await UnsubscribeService.processUnsubscribe(emailToUnsub, 'One-Click Email Link');

    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Unsubscribed Successfully</title></head>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc;">
          <div style="background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 480px; text-align: center;">
            <div style="width: 48px; height: 48px; background: #d1fae5; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: #059669; font-size: 24px;">✓</div>
            <h2 style="color: #0f172a; margin-top: 0;">You Have Been Unsubscribed</h2>
            <p style="color: #64748b; font-size: 14px; line-height: 1.5;">
              <strong>${emailToUnsub}</strong> has been removed from all future email outreach campaigns. You will not receive further promotional emails from us.
            </p>
          </div>
        </body>
      </html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  } catch (err: any) {
    console.error('[API /api/outreach/unsubscribe GET] Error:', err);
    return new NextResponse('Internal server error during unsubscribe', { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    let emailToUnsub: string | null = null;

    if (token) {
      const verified = UnsubscribeService.verifyToken(token);
      if (verified) emailToUnsub = verified.email;
    }

    if (!emailToUnsub) {
      try {
        const body = await req.json().catch(() => ({}));
        if (body.email && typeof body.email === 'string') {
          emailToUnsub = body.email.trim().toLowerCase();
        }
      } catch {
        // Ignored if url-encoded
      }
    }

    if (!emailToUnsub) {
      return NextResponse.json({ success: false, error: 'Invalid token or email' }, { status: 400 });
    }

    await UnsubscribeService.processUnsubscribe(emailToUnsub, 'RFC 8058 One-Click Header');

    return NextResponse.json({
      success: true,
      unsubscribed: true,
      email: emailToUnsub,
    });
  } catch (err: any) {
    console.error('[API /api/outreach/unsubscribe POST] Error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
