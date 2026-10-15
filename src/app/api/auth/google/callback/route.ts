/**
 * LeadPilot — Google OAuth Callback Route
 *
 * Handles the OAuth2 authorization code exchange after Google login.
 * Creates/updates User + Account records.
 * Encrypts tokens with AES-256-GCM before storage.
 * Creates a server-side session and sets the HttpOnly cookie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/auth/crypto';
import { createSession, verifyOAuthState } from '@/lib/auth/sessionService';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  if (error) {
    return NextResponse.redirect(`${appUrl}/login?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/login?error=invalid_callback`);
  }

  // Verify CSRF state
  const cookieStore = await cookies();
  const storedState = cookieStore.get('lp_oauth_state')?.value;
  if (!storedState || !verifyOAuthState(state, storedState)) {
    return NextResponse.redirect(`${appUrl}/login?error=state_mismatch`);
  }

  // Clean up state cookie
  cookieStore.delete('lp_oauth_state');

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${appUrl}/api/auth/google/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errData = await tokenResponse.json().catch(() => ({}));
      console.error('Google token exchange failed:', errData);
      return NextResponse.redirect(`${appUrl}/login?error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();

    // Get user info from Google
    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoResponse.ok) {
      return NextResponse.redirect(`${appUrl}/login?error=userinfo_failed`);
    }

    const userInfo = await userInfoResponse.json();
    const email = userInfo.email?.toLowerCase();
    const name = userInfo.name || '';
    const image = userInfo.picture || null;
    const googleSub = userInfo.sub; // Google unique user ID

    if (!email) {
      return NextResponse.redirect(`${appUrl}/login?error=no_email`);
    }

    // Upsert User
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name: name || undefined,
        image: image || undefined,
      },
      create: {
        email,
        name,
        image,
      },
    });

    // Encrypt tokens before storage
    const encryptedAccessToken = tokenData.access_token
      ? encrypt(tokenData.access_token)
      : null;
    const encryptedRefreshToken = tokenData.refresh_token
      ? encrypt(tokenData.refresh_token)
      : null;

    // Upsert Account (Google login credentials)
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: googleSub,
        },
      },
      update: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiry: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
        scope: tokenData.scope || null,
        idToken: tokenData.id_token ? encrypt(tokenData.id_token) : null,
      },
      create: {
        userId: user.id,
        type: 'oauth',
        provider: 'google',
        providerAccountId: googleSub,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiry: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
        scope: tokenData.scope || null,
        idToken: tokenData.id_token ? encrypt(tokenData.id_token) : null,
      },
    });

    // Create server-side session (sets HttpOnly cookie)
    await createSession(user.id);

    return NextResponse.redirect(`${appUrl}/dashboard`);
  } catch (err: any) {
    console.error('Google OAuth callback error:', err);
    return NextResponse.redirect(`${appUrl}/login?error=internal`);
  }
}
