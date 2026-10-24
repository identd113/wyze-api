/**
 * TOTP generation (RFC 6238 vectors) and the totpSecret login path.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");
const { generateTotp, base32Decode, msUntilNextWindow } = require("../src/util/totp");

// RFC 6238 Appendix B, SHA1, secret "12345678901234567890" (6-digit truncation of the 8-digit vectors).
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("generateTotp matches the RFC 6238 SHA1 test vectors", () => {
  assert.strictEqual(generateTotp(SECRET, 59 * 1000), "287082");
  assert.strictEqual(generateTotp(SECRET, 1111111109 * 1000), "081804");
  assert.strictEqual(generateTotp(SECRET, 1234567890 * 1000), "005924");
  assert.strictEqual(generateTotp(SECRET, 2000000000 * 1000), "279037");
});

test("base32Decode ignores case, spaces and dashes and rejects bad input", () => {
  assert.deepStrictEqual(base32Decode("gezd gnbv-GY3T"), base32Decode("GEZDGNBVGY3T"));
  assert.throws(() => base32Decode("not!base32"), /not valid base32/);
  assert.throws(() => base32Decode("   "), /empty/);
});

test("msUntilNextWindow counts down to the 30s boundary", () => {
  assert.strictEqual(msUntilNextWindow(0), 30000);
  assert.strictEqual(msUntilNextWindow(29000), 1000);
});

const stub = (overrides = {}) => {
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info: () => {}, error: () => {}, warn: () => {}, warning: () => {} };
  w.totpSecret = SECRET;
  w.sleeps = [];
  w._totpSleep = async (ms) => { w.sleeps.push(ms); };
  Object.assign(w, overrides);
  return w;
};

test("totpSecret path sends a freshly generated code", async () => {
  const t = 1111111109 * 1000 - 20000; // early in a window, plenty of time left
  const w = stub({ _totpNow: () => t });
  let sent;
  w._performLoginRequest = async (data) => { sent = data; return { ok: true, data: { access_token: "at" } }; };

  const r = await w._performMfaLogin({ totp_apps: [{ app_id: "app-1" }] });

  assert.strictEqual(r.data.access_token, "at");
  assert.strictEqual(sent.verification_id, "app-1");
  assert.strictEqual(sent.verification_code, generateTotp(SECRET, t));
  assert.deepStrictEqual(w.sleeps, []);
});

test("totpSecret path waits for the next window when the code is about to expire", async () => {
  let t = 60000 - 1000; // 1s left in the window
  const w = stub({ _totpNow: () => t });
  w._totpSleep = async (ms) => { w.sleeps.push(ms); t += ms; };
  let sent;
  w._performLoginRequest = async (data) => { sent = data; return { ok: true, data: { access_token: "at" } }; };

  await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });

  assert.strictEqual(w.sleeps.length, 1);
  assert.strictEqual(sent.verification_code, generateTotp(SECRET, t));
});

test("totpSecret path does not reuse the previous login's window", async () => {
  let t = 1000000 * 30000 + 5000;
  const w = stub({ _totpNow: () => t });
  w._totpSleep = async (ms) => { w.sleeps.push(ms); t += ms; };
  const codes = [];
  w._performLoginRequest = async (d) => { codes.push(d.verification_code); return { ok: true, data: { access_token: "at" } }; };

  await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });
  await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });

  assert.strictEqual(w.sleeps.length, 1);
  assert.notStrictEqual(codes[0], codes[1]);
});

test("totpSecret path retries once with the next window's code, then gives up with a clock hint", async () => {
  let t = 1000000 * 30000 + 5000;
  const warnings = [];
  const w = stub({ _totpNow: () => t });
  w.log.warn = (m) => warnings.push(m);
  w._totpSleep = async (ms) => { t += ms; };
  let calls = 0;
  w._performLoginRequest = async () => { calls += 1; return { ok: true, data: {} }; };

  const r = await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });

  assert.strictEqual(calls, 2);
  assert.ok(!r.data.access_token);
  assert.match(warnings[0], /clock/);
});

test("totpSecret takes precedence over mfaCode", async () => {
  const t = 1111111109 * 1000 - 20000;
  const w = stub({ _totpNow: () => t, mfaCode: "000000" });
  let sent;
  w._performLoginRequest = async (d) => { sent = d; return { ok: true, data: { access_token: "at" } }; };
  await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });
  assert.notStrictEqual(sent.verification_code, "000000");
});

test("mfaCode alone still works unchanged", async () => {
  const w = stub({ totpSecret: undefined, mfaCode: "123456" });
  let sent;
  w._performLoginRequest = async (d) => { sent = d; return { ok: true, data: { access_token: "at" } }; };
  await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });
  assert.strictEqual(sent.verification_code, "123456");
});

const { normalizeTotpSecret, isValidTotpSecret, normalizeMfaCode, isValidMfaCode } = require("../src/util/totp");

test("normalizeMfaCode cleans copy/paste damage", () => {
  for (const raw of ["123456", " 123456 ", "123 456", "123-456", "\t123456\r\n", " 123456​", '"123456"', "“123456”", "﻿123456"]) {
    assert.strictEqual(normalizeMfaCode(raw), "123456", JSON.stringify(raw));
  }
  assert.strictEqual(normalizeMfaCode(12345), "012345"); // JSON number lost its leading zero
  assert.strictEqual(normalizeMfaCode(null), "");
  assert.strictEqual(isValidMfaCode("123456"), true);
  for (const bad of ["12345", "1234567", "12345a", "", undefined]) assert.strictEqual(isValidMfaCode(bad), false, String(bad));
});

test("normalizeTotpSecret cleans copy/paste damage and accepts an otpauth:// URI", () => {
  const expected = "JBSWY3DPEHPK3PXP";
  for (const raw of [
    "JBSWY3DPEHPK3PXP", "  jbswy3dpehpk3pxp\n", "JBSW Y3DP EHPK 3PXP", "jbsw-y3dp-ehpk-3pxp",
    '"JBSWY3DPEHPK3PXP"', "JBSWY3DPEHPK3PXP====", "​JBSWY3DPEHPK3PXP ",
    "otpauth://totp/Wyze:me%40example.com?secret=jbsw%20y3dp%20ehpk%203pxp&issuer=Wyze",
  ]) {
    assert.strictEqual(normalizeTotpSecret(raw), expected, JSON.stringify(raw));
  }
  assert.strictEqual(isValidTotpSecret(expected), true);
  for (const bad of ["", "not!base32", "JBSWY3DP1", undefined]) assert.strictEqual(isValidTotpSecret(bad), false, String(bad));
});

test("constructor tidies pasted mfaCode and totpSecret", () => {
  const w = new WyzeAPI({
    username: "u@example.com", password: "p", keyId: "k", apiKey: "a",
    persistPath: require("os").tmpdir(),
    mfaCode: " 123 456\n", totpSecret: "  jbsw y3dp ehpk 3pxp \n",
  });
  assert.strictEqual(w.mfaCode, "123456");
  assert.strictEqual(w.totpSecret, "JBSWY3DPEHPK3PXP");
  const blank = new WyzeAPI({ username: "u@example.com", password: "p", keyId: "k", apiKey: "a", persistPath: require("os").tmpdir(), mfaCode: "  ", totpSecret: "" });
  assert.strictEqual(blank.mfaCode, undefined);
  assert.strictEqual(blank.totpSecret, undefined);
});

test("login gives a clear error for an invalid totpSecret or mfaCode (and never echoes them)", async () => {
  const mfa = { totp_apps: [{ app_id: "a" }] };
  const bad = stub({ totpSecret: "not!base32" });
  bad._performLoginRequest = async () => { throw new Error("must not be called"); };
  await assert.rejects(() => bad._performMfaLogin(mfa), /"totpSecret" is not valid.*base32/);

  const short = stub({ totpSecret: undefined, mfaCode: "12345" });
  short._performLoginRequest = async () => { throw new Error("must not be called"); };
  await assert.rejects(
    () => short._performMfaLogin(mfa),
    (e) => /6-digit code/.test(e.message) && !e.message.includes("12345")
  );
});

test("a pasted code with spaces works end to end", async () => {
  const w = stub({ totpSecret: undefined, mfaCode: " 123 456 " });
  let sent;
  w._performLoginRequest = async (d) => { sent = d; return { ok: true, data: { access_token: "at" } }; };
  await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });
  assert.strictEqual(sent.verification_code, "123456");
});
