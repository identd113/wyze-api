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
