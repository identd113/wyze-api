"use strict";

/**
 * Wyze requests carry a timestamp (`ts`) or a nonce, and most are signed over them. A request that is sent again after a
 * rate-limit wait (see rateLimit.js) must carry new ones and be signed again, or Wyze may refuse it as expired.
 */

/**
 * A copy of `payload` with `nonce` and `ts` set to now, each in the type it had (a nonce is sent as text by some
 * endpoints and as a number by others). Other keys, including nested ones such as `plan_execute_ts`, are left alone.
 */
function freshStamp(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const out = { ...payload };
  if ("nonce" in out) out.nonce = typeof out.nonce === "number" ? now : String(now);
  if ("ts" in out) out.ts = now;
  return out;
}

module.exports = { freshStamp };
