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
  const redirectUri = `${appUrl}/api/auth/postmaster/callback`;

  if (error) return NextResponse.redirect(`${appUrl}/dashboard?postmaster_error=${encodeURIComponent(error)}`);
  if (!code || !state) return NextResponse.redirect(`${appUrl}/dashboard?postmaster_error=invalid_callback`);

  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.redirect(`${appUrl}/login?error=session_expired`);

  const cookieStore = await cookies();
  const storedState = cookieStore.get('lp_postmaster_state')?.value;
  if (!storedState || !verifyOAuthState(state, storedState)) {
    return NextResponse.redirect(`${appUrl}/dashboard?postmaster_error=state_mismatch`);
  }
  cookieStore.delete('lp_postmaster_state');

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return NextResponse.redirect(`${appUrl}/dashboard?postmaster_error=missing_creds`);

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

    if (!tokenResponse.ok) return NextResponse.redirect(`${appUrl}/dashboard?postmaster_error=token_exchange_failed`);
    
    const tokenData = await tokenResponse.json();

    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userInfoResponse.ok) return NextResponse.redirect(`${appUrl}/dashboard?postmaster_error=userinfo_failed`);
    
    const userInfo = await userInfoResponse.json();
    const googleSub = userInfo.sub;

    const encryptedAccessToken = encrypt(tokenData.access_token);
    const encryptedRefreshToken = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : undefined;
    const tokenExpiry = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;

    // Save as Account for Postmaster
    await prisma.account.upsert({
      where: { provider_providerAccountId: { provider: 'google_postmaster', providerAccountId: googleSub } },
      update: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken ?? undefined,
        tokenExpiry,
        scope: tokenData.scope,
        userId // Ensure it belongs to the current user
      },
      create: {
        userId,
        type: 'oauth',
        provider: 'google_postmaster',
        providerAccountId: googleSub,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken ?? null,
        tokenExpiry,
        scope: tokenData.scope
      }
    });

    // Mark all this user's DomainHealth records as postmasterConnected
    await prisma.domainHealth.updateMany({
      where: { userId },
      data: { postmasterConnected: true }
    });

    return NextResponse.redirect(`${appUrl}/dashboard?postmaster_connected=true`);
  } catch (err: any) {
    return NextResponse.redirect(`${appUrl}/dashboard?postmaster_error=internal`);
  }
}
