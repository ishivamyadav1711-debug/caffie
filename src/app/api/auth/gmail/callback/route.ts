/**
 * LeadPilot — Gmail OAuth Callback Route
 *
 * Handles the OAuth2 callback after the user authorizes Gmail access.
 *
 * CRITICAL SECURITY:
 * - User identity is derived from the AUTHENTICATED SERVER SESSION,
 *   NOT from any cookie containing userId.
 * - The authorized Gmail email MUST match the authenticated user's login email.
 *   If they differ, returns SENDER_IDENTITY_MISMATCH and does not create a SenderAccount.
 * - All OAuth tokens are encrypted with AES-256-GCM before database storage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/auth/crypto';
import { getAuthenticatedUserId, verifyOAuthState } from '@/lib/auth/sessionService';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  const appUrl = rawAppUrl.replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/auth/gmail/callback`;

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/dashboard?gmail_error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/dashboard?gmail_error=invalid_callback`);
  }

  // CRITICAL: Derive user identity from authenticated session, NOT from a cookie
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.redirect(`${appUrl}/login?error=session_expired`);
  }

  // Verify CSRF state
  const cookieStore = await cookies();
  const storedState = cookieStore.get('lp_gmail_state')?.value;
  if (!storedState || !verifyOAuthState(state, storedState)) {
    return NextResponse.redirect(
      `${appUrl}/dashboard?gmail_error=state_mismatch`
    );
  }

  // Clean up state cookie
  cookieStore.delete('lp_gmail_state');

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        `${appUrl}/dashboard?gmail_error=oauth_credentials_missing`
      );
    }

    // Exchange authorization code for Gmail tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errData = await tokenResponse.json().catch(() => ({}));
      console.error('Gmail token exchange failed:', errData);
      return NextResponse.redirect(
        `${appUrl}/dashboard?gmail_error=token_exchange_failed`
      );
    }

    const tokenData = await tokenResponse.json();

    // Get the Gmail email from the access token's userinfo
    const userInfoResponse = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );

    if (!userInfoResponse.ok) {
      return NextResponse.redirect(
        `${appUrl}/dashboard?gmail_error=gmail_userinfo_failed`
      );
    }

    const gmailInfo = await userInfoResponse.json();
    const gmailEmail = gmailInfo.email?.toLowerCase();
    const googleSub = gmailInfo.sub;

    if (!gmailEmail) {
      return NextResponse.redirect(
        `${appUrl}/dashboard?gmail_error=no_gmail_email`
      );
    }

    // Verify that the authenticated user exists in the database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.redirect(`${appUrl}/login?error=user_not_found`);
    }

    // Authenticated user is authorized to connect company mailboxes.
    // SenderAccount will be linked to this user's account pool.

    // Encrypt tokens before storage
    const encryptedAccessToken = encrypt(tokenData.access_token);
    const encryptedRefreshToken = tokenData.refresh_token
      ? encrypt(tokenData.refresh_token)
      : undefined;

    const tokenExpiry = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    const gmailScopes =
      'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

    // Upsert SenderAccount with encrypted tokens
    await prisma.senderAccount.upsert({
      where: {
        userId_email_provider: {
          userId,
          email: gmailEmail,
          provider: 'gmail',
        },
      },
      update: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken ?? undefined,
        tokenExpiry,
        providerAccountId: googleSub,
        status: 'CONNECTED',
        lastError: null,
        scopes: gmailScopes,
      },
      create: {
        userId,
        provider: 'gmail',
        email: gmailEmail,
        displayName: gmailInfo.name || gmailEmail,
        providerAccountId: googleSub,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken ?? null,
        tokenExpiry,
        scopes: gmailScopes,
        status: 'CONNECTED',
      },
    });

    return NextResponse.redirect(
      `${appUrl}/dashboard?gmail_connected=true&email=${encodeURIComponent(gmailEmail)}`
    );
  } catch (err: any) {
    console.error('Gmail OAuth callback error:', err);
    return NextResponse.redirect(
      `${appUrl}/dashboard?gmail_error=internal`
    );
  }
}
