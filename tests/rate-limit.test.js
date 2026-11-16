/**
 * A 429 from Wyze is waited out and the request sent again: the wait comes from Retry-After, else X-RateLimit-Reset,
 * else a short doubling wait. A wait that is too long is not served. Other hosts are left alone.
 */
const test = require("node:test");
const assert = require("node:assert");
const rl = require("../src/util/rateLimit");

const NOW = 1_700_000_000_000;
const isWyze = (h) => h === "api.wyzecam.com";
const reject429 = (headers, extra = {}) => ({
  config: { url: "https://api.wyzecam.com/app/v2/x", method: "post" },
  response: { status: 429, headers },
  ...extra,
});

function harness() {
  const slept = [];
  const sent = [];
  const handlers = rl.createRateLimitHandlers({
    isWyzeHost: isWyze,
    send: async (config) => { sent.push({ ...config }); return { ok: true }; },
    sleep: async (ms) => { slept.push(ms); },
    now: () => NOW,
  });
  return { handlers, slept, sent };
}

test.beforeEach(() => rl._gates.clear());

test("Retry-After in seconds, and as an HTTP date", () => {
  assert.strictEqual(rl.waitFromHeaders({ "retry-after": "7" }, NOW), 7000);
  assert.strictEqual(rl.waitFromHeaders({ "retry-after": new Date(NOW + 3000).toUTCString() }, NOW), 3000);
  assert.strictEqual(rl.waitFromHeaders({ "retry-after": new Date(NOW - 5000).toUTCString() }, NOW), 0, "a date in the past is no wait");
});

test("X-RateLimit-Reset as Unix seconds, Unix milliseconds and a date; Retry-After wins", () => {
  assert.strictEqual(rl.waitFromHeaders({ "x-ratelimit-reset": String(NOW / 1000 + 12) }, NOW), 12000);
  assert.strictEqual(rl.waitFromHeaders({ "x-ratelimit-reset": String(NOW + 4000) }, NOW), 4000);
  assert.strictEqual(rl.waitFromHeaders({ "x-ratelimit-reset-by": new Date(NOW + 2000).toISOString() }, NOW), 2000);
  assert.strictEqual(rl.waitFromHeaders({ "retry-after": "1", "x-ratelimit-reset": String(NOW / 1000 + 60) }, NOW), 1000);
  assert.strictEqual(rl.waitFromHeaders({}, NOW), null);
  assert.strictEqual(rl.waitFromHeaders({ "retry-after": "soon" }, NOW), null, "text that is not a time says nothing");
});

test("a 429 waits as long as Retry-After says, then sends the same request again", async () => {
  const { handlers, slept, sent } = harness();
  const result = await handlers.onError(reject429({ "retry-after": "3" }));
  assert.deepStrictEqual(slept, [3000]);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].url, "https://api.wyzecam.com/app/v2/x");
  assert.strictEqual(sent[0].__wyzeRateRetries, 1);
  assert.deepStrictEqual(result, { ok: true });
});

test("a 429 that says nothing waits 5 seconds, then 10", async () => {
  const { handlers, slept } = harness();
  const config = { url: "https://api.wyzecam.com/x" };
  await handlers.onError({ config, response: { status: 429, headers: {} } });
  await handlers.onError({ config, response: { status: 429, headers: {} } });
  assert.deepStrictEqual(slept, [rl.FALLBACK_WAIT_MS, rl.FALLBACK_WAIT_MS * 2]);
});

test("after MAX_RETRIES the error is thrown with the wait Wyze asked for", async () => {
  const { handlers, sent } = harness();
  const err = reject429({ "retry-after": "2" });
  err.config.__wyzeRateRetries = rl.MAX_RETRIES;
  await assert.rejects(handlers.onError(err), (e) => e === err && e.retryAfterMs === 2000);
  assert.strictEqual(sent.length, 0);
});

test("a wait longer than MAX_WAIT_MS is not served", async () => {
  const { handlers, slept, sent } = harness();
  const err = reject429({ "retry-after": String(rl.MAX_WAIT_MS / 1000 + 1) });
  await assert.rejects(handlers.onError(err), (e) => e.retryAfterMs === rl.MAX_WAIT_MS + 1000);
  assert.deepStrictEqual(slept, []);
  assert.strictEqual(sent.length, 0);
});

test("a 503 is retried only when it says how long to wait; other errors pass straight through", async () => {
  const { handlers, slept } = harness();
  await handlers.onError({ config: { url: "https://api.wyzecam.com/x" }, response: { status: 503, headers: { "retry-after": "1" } } });
  assert.deepStrictEqual(slept, [1000]);
  const bare503 = { config: { url: "https://api.wyzecam.com/x" }, response: { status: 503, headers: {} } };
  await assert.rejects(harness().handlers.onError(bare503), (e) => e === bare503);
  const notFound = { config: { url: "https://api.wyzecam.com/x" }, response: { status: 404, headers: {} } };
  await assert.rejects(harness().handlers.onError(notFound), (e) => e === notFound);
  const noResponse = new Error("socket hang up");
  await assert.rejects(harness().handlers.onError(noResponse), (e) => e === noResponse);
});

test("a 429 from a host that is not Wyze's is left alone", async () => {
  const { handlers, slept, sent } = harness();
  const err = { config: { url: "https://example.com/x" }, response: { status: 429, headers: { "retry-after": "1" } } };
  await assert.rejects(handlers.onError(err), (e) => e === err);
  assert.deepStrictEqual(slept, []);
  assert.strictEqual(sent.length, 0);
});

test("while one request waits, a new request to the same host is held for the rest of the wait", async () => {
  const { handlers, slept } = harness();
  await handlers.onError(reject429({ "retry-after": "10" }));
  slept.length = 0;
  await handlers.beforeRequest({ url: "https://api.wyzecam.com/other" });
  assert.deepStrictEqual(slept, [10000]);
  slept.length = 0;
  await handlers.beforeRequest({ url: "https://example.com/other" });
  assert.deepStrictEqual(slept, [], "another host is not held");
});

test("the rate-limit headers of every answer are remembered per host and path", () => {
  const { handlers } = harness();
  handlers.onResponse({
    config: { url: "https://api.wyzecam.com/app/v2/a" }, status: 200,
    headers: { "x-ratelimit-limit": "1000", "x-ratelimit-remaining": "990", "x-ratelimit-reset": "1700000000" },
  });
  handlers.onResponse({ config: { url: "https://api.wyzecam.com/app/v2/b" }, status: 200, headers: { "content-type": "x" } });
  const seen = rl.getRateLimitObservations();
  assert.strictEqual(seen["api.wyzecam.com /app/v2/a"].limit, "1000");
  assert.strictEqual(seen["api.wyzecam.com /app/v2/a"].remaining, "990");
  assert.ok(!("api.wyzecam.com /app/v2/b" in seen), "an answer with no rate-limit headers is not recorded");
});

test("the handlers are installed on axios once, for Wyze hosts only", () => {
  const axios = require("axios");
  require("../src/index");
  const before = axios.interceptors.response.handlers.length;
  require("../src/util/rateLimit").installRateLimitRetry(axios, () => true);
  assert.strictEqual(axios.interceptors.response.handlers.length, before, "a second install adds nothing");
});
