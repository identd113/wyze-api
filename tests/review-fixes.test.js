/**
 * Fixes from the 2026-11-16 code review: the lock crypt secret is redacted, a refresh refused with an access-token
 * error fails instead of waiting on itself, small X-RateLimit-Reset values are seconds from now (and a bad header
 * never becomes NaN or an endless sleep), and the device report reads Wyze's real property-list answer.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");
const { sanitizeLogMessage } = require("../src/util/security");
const rl = require("../src/util/rateLimit");
const { flattenProperties } = require("../src/deviceReport");

const stub = (overrides = {}) => {
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  Object.assign(w, overrides);
  return w;
};
const within = (promise, ms = 1000) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("hung")), ms))]);

// ---- the lock crypt secret ----

test("the lock crypt secret is masked in a debug log line, whatever the key spelling", () => {
  for (const line of [
    `API response Ford GET /openapi/v1/crypt_secret: ${JSON.stringify({ code: "1", data: { secret: "AbCdEf1234567890xyz" } })}`,
    `{"crypt_secret":"AbCdEf1234567890xyz"}`,
    `secret=AbCdEf1234567890xyz`,
  ]) {
    const out = sanitizeLogMessage(line);
    assert.ok(!out.includes("AbCdEf1234567890xyz"), out);
  }
});

// ---- a refresh that is refused ----

test("an access-token error on the refresh call itself fails that refresh and does not call the refresh again", () => {
  const w = stub();
  w._handleAccessTokenError = () => { throw new Error("must not be called for the refresh call"); };
  assert.throws(
    () => w._handleApiResponse({ data: { code: 2001, msg: "AccessTokenError" } }, "app/user/refresh_token", {}),
    /refused the refresh token \(2001\)/
  );
});

test("any other call that gets an access-token error still goes through the token-refresh handler", () => {
  const w = stub();
  let called = false;
  w._handleAccessTokenError = () => { called = true; return { ok: true }; };
  w._handleApiResponse({ data: { code: 2001, msg: "AccessTokenError" } }, "app/v2/device/get_property_list", {});
  assert.ok(called);
});

test("a refresh that is refused falls back to a fresh login and settles (it used to wait on itself)", async () => {
  const w = stub({ username: "u", password: "p", keyId: "k", apiKey: "a", refresh_token: "old", access_token: "" });
  w.sleepSeconds = async () => {};
  w.getRequestData = () => ({});
  w._performRequest = async (url, data) => w._handleApiResponse({ data: { code: 2001, msg: "AccessTokenError" } }, url, data);
  let loggedIn = false;
  w.login = async () => { loggedIn = true; };
  await within(w.refreshToken());
  assert.ok(loggedIn, "the fresh login ran");
  assert.strictEqual(w._refreshTokenPromise, null, "no refresh is left pending");
});

// ---- rate-limit header parsing ----

test("a small X-RateLimit-Reset is seconds from now; a Unix time is still a Unix time", () => {
  const NOW = 1_700_000_000_000;
  assert.strictEqual(rl.waitFromHeaders({ "x-ratelimit-reset": "30" }, NOW), 30000);
  assert.strictEqual(rl.waitFromHeaders({ "x-ratelimit-reset": "0" }, NOW), 0);
  assert.strictEqual(rl.waitFromHeaders({ "x-ratelimit-reset": String(NOW / 1000 + 12) }, NOW), 12000);
  assert.strictEqual(rl.waitFromHeaders({ "x-ratelimit-reset": String(NOW + 4000) }, NOW), 4000);
  assert.strictEqual(rl.waitFromHeaders({ "x-ratelimit-reset-by": "5" }, NOW), 5000);
});

test("_checkRateLimit does not sleep on a missing or malformed reset, and caps a long one", async () => {
  const sleeps = [];
  const warnings = [];
  const make = () => stub({ sleepMilliSecounds: async (ms) => { sleeps.push(ms); } });
  const w = make();
  w.log.warn = (m) => warnings.push(m);

  await w._checkRateLimit({ "x-ratelimit-remaining": "3" });
  await w._checkRateLimit({ "x-ratelimit-remaining": "3", "x-ratelimit-reset-by": "not a date" });
  assert.deepStrictEqual(sleeps, [], "no NaN sleep");
  assert.ok(warnings.every((m) => !m.includes("NaN")) && warnings.length === 2);

  await w._checkRateLimit({ "x-ratelimit-remaining": "3", "x-ratelimit-reset": "20" });
  assert.deepStrictEqual(sleeps, [20000]);

  await w._checkRateLimit({ "x-ratelimit-remaining": "3", "retry-after": "86400" });
  assert.strictEqual(sleeps[1], rl.MAX_WAIT_MS, "a day-long reset is capped");

  await w._checkRateLimit({ "x-ratelimit-remaining": "200", "x-ratelimit-reset": "5" });
  assert.strictEqual(sleeps.length, 2, "plenty left: no sleep");
});

// ---- the device report's property list ----

test("flattenProperties reads Wyze's real answer: an envelope with rows that carry `value`", () => {
  const real = { code: "1", msg: "SUCCESS", data: { property_list: [{ pid: "P3", value: "1", ts: 1 }, { pid: "P1056", value: "2", ts: 2 }] } };
  assert.deepStrictEqual(flattenProperties(real, []), { P3: "1", P1056: "2" });
});

test("flattenProperties still reads a bare property_list, `pvalue` rows and a plain list, and scrubs the values", () => {
  assert.deepStrictEqual(flattenProperties({ property_list: [{ pid: "P1", pvalue: "10.0.0.9" }] }, []), { P1: "<ip>" });
  assert.deepStrictEqual(flattenProperties([{ pid: "P2", pvalue: "2" }], []), { P2: "2" });
  assert.strictEqual(flattenProperties(undefined, []), undefined);
});

test("a low-remaining sleep holds the host for other requests; a refused refresh is not retried", async () => {
  const sleeps = [];
  const w = stub({ sleepMilliSecounds: async (ms) => { sleeps.push(ms); } });
  w.log.warn = () => {};
  await w._checkRateLimit({ "x-ratelimit-remaining": "2", "x-ratelimit-reset": "7" }, { baseURL: "https://hold.wyzecam.test", url: "app/x" });
  assert.deepStrictEqual(sleeps, [7000]);
  assert.ok(rl._gates.get("hold.wyzecam.test") > Date.now() + 5000, "the host is held");

  let calls = 0;
  const x = stub({
    username: "u", password: "p", keyId: "k", apiKey: "a", refresh_token: "r",
    getRequestData: () => ({}),
    _performRequest: async () => { calls += 1; throw Object.assign(new Error("refused"), { refreshRefused: true }); },
    sleepSeconds: async () => { throw new Error("must not sleep before a retry"); },
    login: async () => { calls += 100; },
  });
  await x._doRefreshToken();
  assert.strictEqual(calls, 101, "one refresh try, then the fresh login");
});
