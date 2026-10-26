/**
 * login() / MFA challenge handling.
 * Network-touching paths are exercised by stubbing `_performLoginRequest`.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");

const stub = (overrides = {}) => {
  const w = Object.create(WyzeAPI.prototype);
  w.apiKey = "test-api-key";
  w.keyId = "test-key-id";
  w.apiLogEnabled = false;
  w.log = { info: () => {}, error: () => {}, warning: () => {} };
  w._persistTokens = async () => {};
  Object.assign(w, overrides);
  return w;
};

test("login throws when apiKey is missing", async () => {
  const w = stub({ apiKey: null });
  await assert.rejects(() => w.login(), /ApiKey Required/);
});

test("login throws when keyId is missing", async () => {
  const w = stub({ keyId: null });
  await assert.rejects(() => w.login(), /KeyId Required/);
});

test("login succeeds directly when no MFA is required", async () => {
  const w = stub();
  w._performLoginRequest = async () => ({
    ok: true,
    data: { access_token: "at", refresh_token: "rt" },
  });

  await w.login();

  assert.strictEqual(w.access_token, "at");
  assert.strictEqual(w.refresh_token, "rt");
});

test("login throws Invalid credentials when result is not ok and no mfa_details", async () => {
  const w = stub();
  w._performLoginRequest = async () => ({ ok: false, data: {} });

  await assert.rejects(() => w.login(), /Invalid credentials/);
});

test("login completes an MFA challenge and stores tokens from the follow-up response", async () => {
  const w = stub({ mfaCode: "123456" });
  const calls = [];
  w._performLoginRequest = async (data = {}) => {
    calls.push(data);
    if (calls.length === 1) {
      return {
        ok: true,
        data: {
          mfa_details: {
            totp_apps: [{ app_id: "totp-app-1" }],
          },
        },
      };
    }
    return {
      ok: true,
      data: { access_token: "at-after-mfa", refresh_token: "rt-after-mfa" },
    };
  };

  await w.login();

  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1], {
    mfa_type: "TotpVerificationCode",
    verification_id: "totp-app-1",
    verification_code: "123456",
  });
  assert.strictEqual(w.access_token, "at-after-mfa");
  assert.strictEqual(w.refresh_token, "rt-after-mfa");
});

test("_performMfaLogin throws when no mfaCode is configured", async () => {
  const w = stub();
  await assert.rejects(
    () => w._performMfaLogin({ totp_apps: [{ app_id: "totp-app-1" }] }),
    /Please provide the "totpSecret"/
  );
});

test("_performMfaLogin throws on an unsupported MFA method", async () => {
  const w = stub({ mfaCode: "123456" });
  await assert.rejects(
    () => w._performMfaLogin({ sms_apps: [{ id: "sms-1" }] }),
    /Unsupported MFA method/
  );
});

test("login surfaces the mfaCode-required error via the top-level Invalid credentials wrapper", async () => {
  const w = stub();
  w._performLoginRequest = async () => ({
    ok: true,
    data: {
      mfa_details: {
        totp_apps: [{ app_id: "totp-app-1" }],
      },
    },
  });

  await assert.rejects(() => w.login(), /Please provide the "totpSecret"/);
});

test("a rejected login does not put tokens or the email into the error message", async () => {
  const w = stub();
  w._performLoginRequest = async () => ({
    ok: false,
    data: {
      code: "1001",
      access_token: "AAAA.BBBB.example-access-token",
      email: "person@example.com",
    },
  });

  await assert.rejects(
    () => w.login(),
    (err) => {
      assert.match(err.message, /Invalid credentials/);
      assert.doesNotMatch(err.message, /example-access-token/);
      assert.doesNotMatch(err.message, /person@example\.com/);
      return true;
    }
  );
});
