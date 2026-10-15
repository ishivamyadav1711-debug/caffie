import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';

const POSTMASTER_SCOPES = [
  'https://www.googleapis.com/auth/postmaster.traffic.readonly',
  'email',
].join(' ');

export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  
  if (!clientId || !clientSecret || !rawAppUrl) {
    return NextResponse.json({ error: 'OAuth not configured' }, { status: 500 });
  }

  const appUrl = rawAppUrl.replace(/\/+$/, '');
  const redirectUri = `${appUrl}/api/auth/postmaster/callback`;

  const state = randomBytes(32).toString('hex');
  const cookieStore = await cookies();
  cookieStore.set('lp_postmaster_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: POSTMASTER_SCOPES,
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
