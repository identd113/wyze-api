/**
 * A request to Wyze with no answer must end. Applies to Wyze hosts only, and never overrides a caller's own timeout.
 */
const test = require("node:test");
const assert = require("node:assert");
const axios = require("axios");

require("../src/index"); // installs the interceptor
const { WYZE_REQUEST_TIMEOUT_MS } = require("../src/util/security");

async function throughInterceptors(config) {
  let current = config;
  for (const handler of axios.interceptors.request.handlers.filter(Boolean)) current = await handler.fulfilled(current);
  return current;
}

test("a request to a Wyze host gets the default timeout, and still no redirects", async () => {
  const config = await throughInterceptors({ url: "https://api.wyzecam.com/app/v2/home_page/get_object_list", headers: {} });
  assert.strictEqual(config.timeout, WYZE_REQUEST_TIMEOUT_MS);
  assert.strictEqual(config.maxRedirects, 0);
});

test("a timeout the caller set is kept", async () => {
  const config = await throughInterceptors({ url: "https://api.wyzecam.com/x", timeout: 5000, headers: {} });
  assert.strictEqual(config.timeout, 5000);
});

test("a base URL plus a relative path counts as the Wyze host", async () => {
  const config = await throughInterceptors({ baseURL: "https://auth-prod.api.wyze.com", url: "api/user/login", headers: {} });
  assert.strictEqual(config.timeout, WYZE_REQUEST_TIMEOUT_MS);
});

test("a request to another host is left alone", async () => {
  const config = await throughInterceptors({ url: "https://example.com/thumb.jpg", headers: {} });
  assert.strictEqual(config.timeout, undefined);
  assert.strictEqual(config.maxRedirects, undefined);
});
