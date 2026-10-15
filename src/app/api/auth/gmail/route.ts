/**
 * LeadPilot — Gmail OAuth Authorization Route
 *
 * REQUIRES an authenticated session.
 * Initiates the Gmail-specific OAuth flow to grant send/read permissions.
 * The user identity is derived from the server-side session, NOT from a cookie.
 *
 * Gmail scopes requested:
 * - https://www.googleapis.com/auth/gmail.send
 * - https://www.googleapis.com/auth/gmail.readonly
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'email', // To verify that the Gmail account matches
].join(' ');

export async function GET(req: NextRequest) {
  // Must be authenticated first
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json(
      { error: 'You must be logged in before authorizing Gmail.' },
      { status: 401 }
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (!clientId || !clientSecret || !rawAppUrl) {
    return NextResponse.json(
      {
        error:
          'Google Gmail OAuth is not configured on the server. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and application URL must be configured in environment variables.',
      },
      { status: 500 }
    );
  }

  const appUrl = rawAppUrl.replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/auth/gmail/callback`;

  // Generate cryptographically secure state
  const state = randomBytes(32).toString('hex');

  // Store state in HttpOnly cookie (user identity comes from session, not this cookie)
  const cookieStore = await cookies();
  cookieStore.set('lp_gmail_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
