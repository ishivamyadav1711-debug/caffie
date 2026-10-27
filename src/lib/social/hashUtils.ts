import crypto from 'crypto';

/**
 * Normalizes text content for deterministic comparison and hashing.
 * Collapses consecutive whitespace, removes carriage returns/tabs/null bytes, and trims.
 */
export function normalizeContent(text?: string | null): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\0/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates a deterministic SHA-256 hash for a social signal.
 * Ensures identical posts across runs produce the exact same unique hash.
 */
export function createContentHash(
  platform: string,
  recordId: string,
  contentText: string
): string {
  const normPlatform = (platform || '').toLowerCase().trim();
  const normId = (recordId || '').trim();
  const normText = normalizeContent(contentText);

  const payload = `${normPlatform}:${normId}:${normText}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Normalizes date input (seconds, milliseconds, ISO string) into strict ISO 8601 UTC string.
 * Returns null if invalid or unparseable.
 */
export function normalizeUtcDate(input?: string | number | Date | null): string | null {
  if (input === undefined || input === null || input === '') return null;

  try {
    let date: Date;

    if (input instanceof Date) {
      date = input;
    } else if (typeof input === 'number') {
      // If seconds (10 digits), multiply by 1000
      const ms = input < 1e11 ? input * 1000 : input;
      date = new Date(ms);
    } else if (typeof input === 'string') {
      const parsedNum = Number(input);
      if (!isNaN(parsedNum) && input.length >= 10 && input.length <= 13) {
        const ms = parsedNum < 1e11 ? parsedNum * 1000 : parsedNum;
        date = new Date(ms);
      } else {
        date = new Date(input);
      }
    } else {
      return null;
    }

    if (isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  } catch {
    return null;
  }
}

/**
 * Sanitizes user-facing string fields (title, author, url) against injection or malformed data.
 */
export function sanitizeString(val?: string | null, maxLength: number = 1000): string {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/\0/g, '').trim().slice(0, maxLength);
}

