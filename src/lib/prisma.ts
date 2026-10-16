import { PrismaClient } from '@prisma/client';

/**
 * Sanitizes a database connection URL by removing any accidental leading/trailing
 * quotation marks, escaped quotes, or whitespace.
 * Also verifies that the protocol starts with postgresql:// or postgres://.
 */
export function sanitizeDatabaseUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let cleaned = rawUrl.trim();

  // Strip repeated leading/trailing single or double quotes, and escaped quotes (e.g. \" or "")
  cleaned = cleaned.replace(/^(?:\\?["'])+|(?:\\?["'])+$/g, '').trim();

  // If there are still surrounding quotes, strip them
  while ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

/**
 * Returns true if the URL string has a valid PostgreSQL protocol.
 */
export function isValidPostgresUrl(url?: string): boolean {
  if (!url) return false;
  return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

/**
 * Returns a sanitized, safe representation of the database URL for logging (never prints password).
 */
export function getSanitizedLogUrl(url?: string): string {
  if (!url) return '[MISSING]';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`;
  } catch {
    return '[MALFORMED_URL]';
  }
}

const globalForPrisma = global as unknown as {
  prismaInstance?: PrismaClient;
};

export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prismaInstance) {
    // Sanitize process.env.DATABASE_URL and process.env.DIRECT_URL
    const sanitizedDbUrl = sanitizeDatabaseUrl(process.env.DATABASE_URL);
    const sanitizedDirectUrl = sanitizeDatabaseUrl(process.env.DIRECT_URL);

    if (sanitizedDbUrl && process.env.DATABASE_URL !== sanitizedDbUrl) {
      process.env.DATABASE_URL = sanitizedDbUrl;
    }
    if (sanitizedDirectUrl && process.env.DIRECT_URL !== sanitizedDirectUrl) {
      process.env.DIRECT_URL = sanitizedDirectUrl;
    }

    if (!isValidPostgresUrl(sanitizedDbUrl)) {
      console.warn(
        `[Prisma Warning] DATABASE_URL is missing or malformed (${getSanitizedLogUrl(sanitizedDbUrl)}). Database persistence operations will be safely guarded.`
      );
    }

    const options: any = {
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    };

    if (sanitizedDbUrl && isValidPostgresUrl(sanitizedDbUrl)) {
      options.datasources = {
        db: {
          url: sanitizedDbUrl,
        },
      };
    }

    globalForPrisma.prismaInstance = new PrismaClient(options);
  }
  return globalForPrisma.prismaInstance;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
