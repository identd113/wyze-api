const crypto = require("crypto");

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Whitespace plus the invisible characters copy/paste likes to bring along:
// NBSP, zero-width space/joiners, word joiner, BOM, narrow NBSP.
const JUNK = /[\s\u00A0\u200B-\u200D\u2060\uFEFF\u202F]/g;
// Straight and curly quotes/backticks that wrap pasted values.
const QUOTES = /["'`\u2018\u2019\u201C\u201D]/g;

/**
 * Cleans a pasted TOTP secret: accepts a full `otpauth://` URI, strips
 * whitespace/invisible characters/quotes/dashes/trailing `=`, and uppercases.
 * Does not validate - see isValidTotpSecret.
 */
function normalizeTotpSecret(input) {
  if (input == null) return "";
  let s = String(input).trim();
  if (/^otpauth:/i.test(s)) {
    const m = s.match(/[?&]secret=([^&\s]+)/i);
    if (m) {
      try { s = decodeURIComponent(m[1]); } catch (_) { s = m[1]; }
    }
  }
  return s.replace(JUNK, "").replace(QUOTES, "").replace(/-/g, "").replace(/=+$/, "").toUpperCase();
}

function isValidTotpSecret(secret) {
  return /^[A-Z2-7]+$/.test(secret || "");
}

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

/**
 * Decodes a base32 TOTP secret (the "enter this key" text shown next to the
 * QR code). Spaces, dashes and case are ignored, as authenticator apps do.
 */
function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!clean) throw new Error("TOTP secret is empty");
  let bits = "";
  for (const ch of clean) {
    const v = BASE32.indexOf(ch);
    if (v < 0) throw new Error("TOTP secret is not valid base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits) - what authenticator apps use.
 * @param {string} secret base32 secret
 * @param {number} [now] epoch milliseconds
 */
function generateTotp(secret, now = Date.now(), { digits = 6, period = 30 } = {}) {
  const counter = Math.floor(now / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

/** Milliseconds until the current 30s window rolls over. */
function msUntilNextWindow(now = Date.now(), period = 30) {
  const ms = period * 1000;
  return ms - (now % ms);
}

module.exports = {
  base32Decode, generateTotp, msUntilNextWindow,
  normalizeTotpSecret, isValidTotpSecret, normalizeMfaCode, isValidMfaCode,
};
