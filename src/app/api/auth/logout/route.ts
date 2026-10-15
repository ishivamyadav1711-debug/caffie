/**
 * LeadPilot — Logout Route
 *
 * POST /api/auth/logout — Destroys the session and clears the cookie.
 */
import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth/sessionService';

export async function POST() {
  await destroySession();
  return NextResponse.json({ success: true });
}
