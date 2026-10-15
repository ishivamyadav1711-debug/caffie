import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // No application login required.
  // Allow all requests to proceed.
  return NextResponse.next();
}

export const config = {
  // Optional: keep matchers empty or retain if future middleware needs them
  matcher: [],
};
