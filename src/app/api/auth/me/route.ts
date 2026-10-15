/**
 * LeadPilot — Session Introspection Route
 *
 * GET /api/auth/me — Returns the authenticated user and their connected sender accounts.
 * Never exposes OAuth tokens to the frontend.
 */
import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/sessionService';

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      senderAccounts: user.senderAccounts, // Already filtered — no tokens exposed
    },
  });
}
