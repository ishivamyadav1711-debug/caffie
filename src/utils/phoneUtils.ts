/**
 * Phone Number Utilities: Normalizes phone numbers to standard national & E.164 formats.
 * Supports India (+91), USA & Canada (+1). Never guesses or fabricates phone numbers.
 */
export function normalizePhone(rawPhone?: string | null, countryHint?: string): string | undefined {
  if (!rawPhone || typeof rawPhone !== 'string') return undefined;
  const trimmed = rawPhone.trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === 'not available' ||
    trimmed.toLowerCase() === 'none' ||
    trimmed.toLowerCase() === 'null' ||
    trimmed.toLowerCase() === 'undefined'
  ) {
    return undefined;
  }

  // Extract all digits
  const digits = trimmed.replace(/\D/g, '');

  // Reject clearly invalid sequences
  if (digits.length < 7 || digits.length > 15 || /^0+$/.test(digits) || /^1+$/.test(digits)) {
    return undefined;
  }

  const cHint = (countryHint || '').toLowerCase().trim();
  const isNorthAmerica =
    cHint === 'us' ||
    cHint === 'usa' ||
    cHint === 'united states' ||
    cHint === 'ca' ||
    cHint === 'canada' ||
    trimmed.startsWith('+1');

  // 0. North American Numbering Plan (USA & Canada: +1 + 10 digits)
  if (isNorthAmerica || (digits.length === 11 && digits.startsWith('1') && !trimmed.startsWith('+91'))) {
    const naDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (naDigits.length === 10) {
      return `+1 ${naDigits.slice(0, 3)} ${naDigits.slice(3, 6)} ${naDigits.slice(6)}`;
    }
  }

  // 1. Mobile number with +91 or 91 country code (12 digits total)
  if (digits.length === 12 && digits.startsWith('91')) {
    const mobileDigits = digits.slice(2);
    if (/^[6-9]\d{9}$/.test(mobileDigits)) {
      return `+91 ${mobileDigits.slice(0, 5)} ${mobileDigits.slice(5)}`;
    }
    return `+91 ${digits.slice(2)}`;
  }

  // 2. Mobile number with leading 0 (11 digits total: 09810123456)
  if (digits.length === 11 && digits.startsWith('0')) {
    const mobileDigits = digits.slice(1);
    if (/^[6-9]\d{9}$/.test(mobileDigits)) {
      return `+91 ${mobileDigits.slice(0, 5)} ${mobileDigits.slice(5)}`;
    }
    // Landline with STD code (e.g. 011 or 0120)
    return `+91 ${digits.slice(1)}`;
  }

  // 3. Standard 10-digit Indian mobile number (e.g. 9810123456)
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits) && !isNorthAmerica) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }

  // 4. Other valid Indian length (e.g. landline with STD code 10 digits or 8 digits)
  if (!isNorthAmerica) {
    if (digits.length === 10) {
      return `+91 ${digits.slice(0, 4)} ${digits.slice(4)}`;
    }
    if (digits.length >= 8) {
      return `+91 ${digits}`;
    }
  } else if (digits.length === 10) {
    return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }

  return undefined;
}

export function extractPhonesFromText(text: string): string[] {
  if (!text) return [];
  // Standard phone patterns matching Indian and international formats
  const phoneRegex = /(?:\+?91[\s.-]?)?(?:\(?0\d{2,4}\)?[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}|(?:\+?91[\s.-]?)?[0-9]{3,4}[\s.-]?[0-9]{6,8}/g;
  const matches = text.match(phoneRegex) || [];
  const validSet = new Set<string>();

  for (const m of matches) {
    const norm = normalizePhone(m);
    if (norm) {
      validSet.add(norm);
    }
  }

  return Array.from(validSet);
}
