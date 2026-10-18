import { ZeroBounceVerificationProvider, DnsMxVerificationProvider } from '../providers/emailVerificationProvider2';
import { TwilioLookupProvider, LibPhoneNumberSyntaxProvider } from '../providers/phoneVerificationProvider';

const zeroBounceProvider = new ZeroBounceVerificationProvider();
const dnsVerifierProvider = new DnsMxVerificationProvider();

const twilioLookupProvider = new TwilioLookupProvider();
const phoneSyntaxProvider = new LibPhoneNumberSyntaxProvider();

/**
 * Verifies an email using the ZeroBounce adapter from LeadPilot.
 * Falls back to DNS/MX verification if ZeroBounce API key is not configured.
 * 
 * @param email - The email address to verify
 * @returns true if valid, false otherwise
 */
export async function verifyEmail(email?: string | null): Promise<boolean> {
  if (!email || typeof email !== 'string') return false;
  const cleaned = email.trim();
  if (!cleaned) return false;

  try {
    if (zeroBounceProvider.isConfigured()) {
      const result = await zeroBounceProvider.verifyEmail(cleaned);
      if (result.providerStatus === 'READY' || result.cached) {
        return Boolean(result.isValid);
      }
    }

    // Fall back to DNS/MX verification if ZeroBounce is not configured
    const dnsResult = await dnsVerifierProvider.verifyEmail(cleaned);
    return Boolean(dnsResult.isValid);
  } catch (error) {
    console.error('[Verification] Email verification failed:', error);
    return false;
  }
}

/**
 * Verifies a phone number using the Twilio Lookup adapter from LeadPilot.
 * Falls back to LibPhoneNumber syntax validation if Twilio is not configured.
 * 
 * @param phone - The phone number to verify
 * @param defaultCountry - Optional default country code (defaults to 'IN')
 * @returns true if valid, false otherwise
 */
export async function verifyPhone(phone?: string | null, defaultCountry: string = 'IN'): Promise<boolean> {
  if (!phone || typeof phone !== 'string') return false;
  const cleaned = phone.trim();
  if (!cleaned) return false;

  try {
    if (twilioLookupProvider.isConfigured()) {
      const result = await twilioLookupProvider.verifyPhone(cleaned, defaultCountry);
      if (result.providerStatus === 'READY' || result.cached) {
        return Boolean(result.isValid);
      }
    }

    // Fall back to phone syntax provider if Twilio is not configured
    const syntaxResult = await phoneSyntaxProvider.verifyPhone(cleaned, defaultCountry);
    return Boolean(syntaxResult.isValid);
  } catch (error) {
    console.error('[Verification] Phone verification failed:', error);
    return false;
  }
}
