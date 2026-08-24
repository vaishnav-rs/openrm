/**
 * International phone number display formatting. Phone numbers in this app
 * originate as WhatsApp JIDs (see parsePhoneFromJid in
 * src/agent/orchestrator.ts) and end up stored in Contact.phone as bare
 * E.164 digits with no leading "+" -- e.g. "447911123456" or "15551234567".
 * The raw digit string alone doesn't tell you where the country code ends
 * and the national number begins (country codes are 1-3 digits, variable
 * length), so naively slicing/assuming a fixed prefix (e.g. assuming the
 * first digit is always "1" for a US number) silently mangles every
 * non-US/Canada number. libphonenumber-js (Google's libphonenumber, ported
 * to JS) is the standard, well-maintained way to parse this correctly.
 *
 * formatPhone never throws and never crashes a render: parsing a short test
 * number, a malformed string, or anything libphonenumber-js can't make
 * sense of falls back to just showing the raw digits as-is.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js";

export function formatPhone(raw: string): string {
  const digits = raw.trim();
  if (!digits) return raw;
  try {
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    if (parsed && parsed.isValid()) {
      return parsed.formatInternational();
    }
  } catch {
    // Fall through to the raw-digits fallback below.
  }
  return raw;
}
