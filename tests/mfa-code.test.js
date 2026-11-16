/**
 * The one-time `mfaCode` login path, and the deprecated `totpSecret` option (accepted, warned about once, never used).
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");
const { normalizeMfaCode, isValidMfaCode } = require("../src/util/totp");

const stub = (overrides = {}) => {
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info: () => {}, error: () => {}, warn: () => {}, warning: () => {} };
  Object.assign(w, overrides);
  return w;
};

test("mfaCode sends the code as the verification code", async () => {
  const w = stub({ mfaCode: "123456" });
  let sent;
  w._performLoginRequest = async (d) => { sent = d; return { ok: true, data: { access_token: "at" } }; };
  await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });
  assert.strictEqual(sent.verification_code, "123456");
  assert.strictEqual(sent.verification_id, "a");
  assert.strictEqual(sent.mfa_type, "TotpVerificationCode");
});

test("a totpSecret is ignored: no code is generated from it, and the error says it is deprecated", async () => {
  const w = stub({ totpSecret: "JBSWY3DPEHPK3PXP" });
  w._performLoginRequest = async () => { throw new Error("must not be called"); };
  await assert.rejects(
    () => w._performMfaLogin({ totp_apps: [{ app_id: "a" }] }),
    (e) => /"mfaCode"/.test(e.message) && /deprecated/.test(e.message) && !e.message.includes("JBSWY3DPEHPK3PXP")
  );
});

test("a totpSecret does not override a given mfaCode", async () => {
  const w = stub({ totpSecret: "JBSWY3DPEHPK3PXP", mfaCode: "654321" });
  let sent;
  w._performLoginRequest = async (d) => { sent = d; return { ok: true, data: { access_token: "at" } }; };
  await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });
  assert.strictEqual(sent.verification_code, "654321");
});

test("normalizeMfaCode cleans copy/paste damage", () => {
  for (const raw of ["123456", " 123456 ", "123 456", "123-456", "\t123456\r\n", " 123456​", '"123456"', "“123456”", "﻿123456"]) {
    assert.strictEqual(normalizeMfaCode(raw), "123456", JSON.stringify(raw));
  }
  assert.strictEqual(normalizeMfaCode(12345), "012345"); // JSON number lost its leading zero
  assert.strictEqual(normalizeMfaCode(null), "");
  assert.strictEqual(isValidMfaCode("123456"), true);
  for (const bad of ["12345", "1234567", "12345a", "", undefined]) assert.strictEqual(isValidMfaCode(bad), false, String(bad));
});

test("constructor tidies a pasted mfaCode, and keeps a totpSecret exactly as given", () => {
  const make = (extra) => new WyzeAPI({
    username: "u@example.com", password: "p", keyId: "k", apiKey: "a",
    persistPath: require("os").tmpdir(), ...extra,
  });
  const w = make({ mfaCode: " 123 456\n", totpSecret: "jbsw y3dp" });
  assert.strictEqual(w.mfaCode, "123456");
  assert.strictEqual(w.totpSecret, "jbsw y3dp", "accepted as given, not cleaned or validated");
  const blank = make({ mfaCode: "  ", totpSecret: "" });
  assert.strictEqual(blank.mfaCode, undefined);
  assert.strictEqual(blank.totpSecret, undefined);
});

test("setting totpSecret logs a deprecation warning; leaving it out does not", () => {
  const messages = [];
  const { WyzeLogger } = require("../src/util/wyzeLogger");
  const realWarn = WyzeLogger.prototype.warn;
  WyzeLogger.prototype.warn = function (m) { messages.push(String(m)); };
  try {
    const base = { username: "u@example.com", password: "p", keyId: "k", apiKey: "a", persistPath: require("os").tmpdir() };
    new WyzeAPI(base);
    assert.deepStrictEqual(messages, []);
    new WyzeAPI({ ...base, totpSecret: "JBSWY3DPEHPK3PXP" });
    assert.strictEqual(messages.length, 1);
    assert.match(messages[0], /totpSecret.*deprecated/);
    assert.ok(!messages[0].includes("JBSWY3DPEHPK3PXP"), "the secret is never logged");
  } finally {
    WyzeLogger.prototype.warn = realWarn;
  }
});

test("login gives a clear error for an invalid mfaCode (and never echoes it)", async () => {
  const short = stub({ mfaCode: "12345" });
  short._performLoginRequest = async () => { throw new Error("must not be called"); };
  await assert.rejects(
    () => short._performMfaLogin({ totp_apps: [{ app_id: "a" }] }),
    (e) => /6-digit code/.test(e.message) && !e.message.includes("12345")
  );
});

test("a pasted code with spaces works end to end", async () => {
  const w = stub({ mfaCode: " 123 456 " });
  let sent;
  w._performLoginRequest = async (d) => { sent = d; return { ok: true, data: { access_token: "at" } }; };
  await w._performMfaLogin({ totp_apps: [{ app_id: "a" }] });
  assert.strictEqual(sent.verification_code, "123456");
});
