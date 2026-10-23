const crypto = require("crypto");

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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

module.exports = { base32Decode, generateTotp, msUntilNextWindow };
