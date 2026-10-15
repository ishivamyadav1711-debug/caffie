/**
 * LeadPilot — Google OAuth Login Route
 *
 * Initiates the Google OAuth2 authorization code flow for login.
 * Uses cryptographically secure state bound to a temporary cookie.
 *
 * Scopes requested: openid, email, profile (login only, not Gmail sending).
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHmac } from 'node:crypto';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'GOOGLE_CLIENT_ID is not configured' },
      { status: 500 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_APP_URL is not configured' },
      { status: 500 }
    );
  }

  // Generate cryptographically secure state
  const state = randomBytes(32).toString('hex');

  // Store state in HttpOnly cookie for CSRF verification
  const cookieStore = await cookies();
  cookieStore.set('lp_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account consent',
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
