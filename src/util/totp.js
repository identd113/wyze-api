// Helpers for the one-time `mfaCode` option. (The `totpSecret` option, which generated a code from the authenticator
// secret, is deprecated and ignored; its code was removed.)

// Whitespace plus the invisible characters copy/paste likes to bring along:
// NBSP, zero-width space/joiners, word joiner, BOM, narrow NBSP.
const JUNK = /[\s\u00A0\u200B-\u200D\u2060\uFEFF\u202F]/g;
// Straight and curly quotes/backticks that wrap pasted values.
const QUOTES = /["'`\u2018\u2019\u201C\u201D]/g;

/**
 * Cleans a typed/pasted 6-digit code: strips whitespace, invisible characters,
 * quotes and dashes ("123 456", " 123456\n", "123-456"). A JSON number is
 * zero-padded back to 6 digits. Does not validate - see isValidMfaCode.
 */
function normalizeMfaCode(input) {
  if (input == null) return "";
  if (typeof input === "number") return String(Math.trunc(input)).padStart(6, "0");
  return String(input).replace(JUNK, "").replace(QUOTES, "").replace(/-/g, "");
}

function isValidMfaCode(code) {
  return /^\d{6}$/.test(code || "");
}

module.exports = { normalizeMfaCode, isValidMfaCode };
