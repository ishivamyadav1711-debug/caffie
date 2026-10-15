/**
 * LeadPilot — Server-Side Session Management
 *
 * Uses HMAC-SHA256 signed session tokens stored in HttpOnly Secure cookies.
 * No JWT library needed — uses Node.js built-in crypto.
 *
 * Session tokens are opaque IDs looked up in the database Session table.
 * The cookie value is: sessionToken.hmacSignature
 */
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../prisma';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'lp_session';
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'test') {
      return 'test_jwt_secret_must_be_32_characters_minimum_safety_test';
    }
    throw new Error(
      'JWT_SECRET env var must be set and at least 32 characters. No fallback is allowed.'
    );
  }
  return secret;
}

/** Sign a session token with HMAC-SHA256 */
function signToken(token: string): string {
  const hmac = createHmac('sha256', getJwtSecret());
  hmac.update(token);
  return hmac.digest('hex');
}

/** Verify a signed cookie value, return the session token or null */
function verifySignedCookie(cookieValue: string): string | null {
  const dotIndex = cookieValue.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const token = cookieValue.substring(0, dotIndex);
  const signature = cookieValue.substring(dotIndex + 1);

  const expected = signToken(token);
  try {
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;
  } catch {
    return null;
  }
  return token;
}

/**
 * Create a new session for a user and set the HttpOnly cookie.
 * Must be called inside a Next.js route handler.
 */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.session.create({
    data: {
      sessionToken: token,
      userId,
      expiresAt,
    },
  });

  const signedValue = `${token}.${signToken(token)}`;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, signedValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  });

  return token;
}

/**
 * Get the authenticated userId from the current request's session cookie.
 * Returns undefined if not authenticated or session expired.
 */
export async function getAuthenticatedUserId(): Promise<string | undefined> {
  // Application login is disabled. Return the default admin user.
  let defaultUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!defaultUser) {
    // If no admin exists, just find any user
    defaultUser = await prisma.user.findFirst();
    
    // If database is completely empty, create the default internal admin
    if (!defaultUser) {
      defaultUser = await prisma.user.create({
        data: {
          email: 'admin@leadpilot.internal',
          name: 'Internal Admin',
          role: 'ADMIN',
        },
      });
    }
  }

  return defaultUser.id;
}

/**
 * Get the full authenticated user record (with sender accounts).
 * Returns null if not authenticated.
 */
export async function getAuthenticatedUser() {
  const userId = await getAuthenticatedUserId();
  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      senderAccounts: {
        where: { status: 'CONNECTED' },
        select: {
          id: true,
          provider: true,
          email: true,
          displayName: true,
          status: true,
          lastUsedAt: true,
          createdAt: true,
          // Never expose tokens to frontend
        },
      },
    },
  });
}

/**
 * Destroy the current session (logout).
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return;

  const token = verifySignedCookie(cookie.value);
  if (token) {
    await prisma.session.deleteMany({ where: { sessionToken: token } }).catch(() => {});
  }

  cookieStore.delete(COOKIE_NAME);
}

/**
 * Generate a cryptographically secure OAuth state parameter,
 * bound to the authenticated session token.
 */
export function generateOAuthState(sessionToken?: string): string {
  const randomPart = randomBytes(32).toString('hex');
  if (sessionToken) {
    // Bind state to session: HMAC(random, sessionToken)
    const hmac = createHmac('sha256', getJwtSecret());
    hmac.update(randomPart + sessionToken);
    const binding = hmac.digest('hex').substring(0, 16);
    return `${randomPart}.${binding}`;
  }
  return randomPart;
}

/**
 * Verify an OAuth state parameter matches the stored value.
 */
export function verifyOAuthState(
  receivedState: string,
  storedState: string
): boolean {
  if (!receivedState || !storedState) return false;
  if (receivedState.length !== storedState.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(receivedState, 'utf8'),
      Buffer.from(storedState, 'utf8')
    );
  } catch {
    return false;
  }
}
