/**
 * Regression tests for BUG-persisted-token-loop.md: a dead refresh token must
 * not be reloaded from disk forever. When refreshToken() fails,
 * _handleAccessTokenError must clear the in-memory refresh_token and delete
 * the persisted token file so the next maybeLogin() falls through to a real
 * login instead of re-hydrating the same broken pair.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const WyzeAPI = require("../src/index");

const stub = (overrides = {}) => {
  const w = Object.create(WyzeAPI.prototype);
  w.username = "test@example.com";
  w.apiLogEnabled = false;
  w.log = { info: () => {}, error: () => {}, warning: () => {} };
  Object.assign(w, overrides);
  return w;
};

test("_clearPersistedTokens clears in-memory tokens and deletes the token file", async () => {
  const persistPath = await fs.mkdtemp(path.join(os.tmpdir(), "wyze-api-test-"));
  const w = stub({
    persistPath,
    access_token: "dead-at",
    refresh_token: "dead-rt",
  });

  const tokenPath = w._tokenPersistPath();
  await fs.writeFile(tokenPath, JSON.stringify({ access_token: "dead-at", refresh_token: "dead-rt" }));

  await w._clearPersistedTokens();

  assert.strictEqual(w.access_token, "");
  assert.strictEqual(w.refresh_token, "");
  await assert.rejects(() => fs.access(tokenPath), /ENOENT/);
});

test("_clearPersistedTokens is a no-op when no token file exists on disk", async () => {
  const persistPath = await fs.mkdtemp(path.join(os.tmpdir(), "wyze-api-test-"));
  const w = stub({ persistPath, access_token: "at", refresh_token: "rt" });

  await w._clearPersistedTokens();

  assert.strictEqual(w.access_token, "");
  assert.strictEqual(w.refresh_token, "");
});

test("_handleAccessTokenError wipes the persisted pair when the refresh token is also dead", async () => {
  const persistPath = await fs.mkdtemp(path.join(os.tmpdir(), "wyze-api-test-"));
  const w = stub({
    persistPath,
    access_token: "dead-at",
    refresh_token: "dead-rt",
  });

  const tokenPath = w._tokenPersistPath();
  await fs.writeFile(tokenPath, JSON.stringify({ access_token: "dead-at", refresh_token: "dead-rt" }));

  w.refreshToken = async () => {
    throw new Error("Wyze API Error (2002) - refresh token is error");
  };

  await assert.rejects(
    () => w._handleAccessTokenError({}, "access token is error", 2001, "url", {}),
    /Refresh Token could not be used to get a new access token/
  );

  assert.strictEqual(w.access_token, "");
  assert.strictEqual(w.refresh_token, "");
  await assert.rejects(() => fs.access(tokenPath), /ENOENT/);
});

test("maybeLogin falls through to a real login after a dead refresh token was cleared", async () => {
  const persistPath = await fs.mkdtemp(path.join(os.tmpdir(), "wyze-api-test-"));
  const w = stub({
    persistPath,
    access_token: "",
    refresh_token: "",
    apiKey: "test-api-key",
    keyId: "test-key-id",
    debounceInSeconds: 0,
    debounceExpiresAt: 0,
  });

  // Simulate the file having already been wiped by a prior
  // _handleAccessTokenError call - nothing left to (wrongly) reload.
  w.logDebounceInfo = () => {};
  w.isDebounceCleared = () => true;
  w.resetDebounceIfNeeded = () => {};

  let loginCalled = false;
  w.tryLogin = async () => {
    loginCalled = true;
    w.access_token = "fresh-at";
    w.refresh_token = "fresh-rt";
  };

  await w.maybeLogin();

  assert.strictEqual(loginCalled, true);
  assert.strictEqual(w.access_token, "fresh-at");
});

test("refreshToken() dedupes concurrent callers into a single in-flight refresh", async () => {
  const w = stub({ refresh_token: "rt" });
  let performRequestCalls = 0;
  w.getRequestData = () => ({});
  w._performRequest = async () => {
    performRequestCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, data: { data: { access_token: "at-1", refresh_token: "rt-1" } } };
  };
  w._persistTokens = async () => {};

  const [a, b] = await Promise.all([w.refreshToken(), w.refreshToken()]);

  assert.strictEqual(performRequestCalls, 1);
  assert.strictEqual(w.access_token, "at-1");
  assert.strictEqual(w.refresh_token, "rt-1");

  // A subsequent call after the in-flight one settles starts a fresh refresh.
  await w.refreshToken();
  assert.strictEqual(performRequestCalls, 2);
});

test("concurrent access-token errors that both fail refresh only clear tokens once, safely", async () => {
  const persistPath = await fs.mkdtemp(path.join(os.tmpdir(), "wyze-api-test-"));
  const w = stub({
    persistPath,
    access_token: "dead-at",
    refresh_token: "dead-rt",
  });
  let refreshAttempts = 0;
  w.getRequestData = () => ({});
  w.sleepSeconds = async () => {};
  w._performRequest = async () => {
    refreshAttempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: false, data: {} };
  };

  const results = await Promise.allSettled([
    w._handleAccessTokenError({}, "access token is error", 2001, "url", {}),
    w._handleAccessTokenError({}, "access token is error", 2001, "url", {}),
  ]);

  // refreshToken() internally retries once on failure (maxRetries=2); dedup
  // means both concurrent callers share that single underlying attempt count.
  assert.strictEqual(refreshAttempts, 2);
  assert.ok(results.every((r) => r.status === "rejected"));
  assert.strictEqual(w.access_token, "");
  assert.strictEqual(w.refresh_token, "");
});


test("_persistTokens writes the token file owner-only (0600)", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX file modes");
  const persistPath = await fs.mkdtemp(path.join(os.tmpdir(), "wyze-api-test-"));
  const w = stub({ persistPath, access_token: "at", refresh_token: "rt" });
  w.log.debug = () => {};
  await w._persistTokens();
  const st = await fs.stat(w._tokenPersistPath());
  assert.strictEqual(st.mode & 0o777, 0o600);
});
