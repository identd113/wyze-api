/**
 * Several callers can find the access token missing at once (parallel requests at start-up). They must share one
 * login: a second login started while the first runs races it, repeats a one-shot 2FA code, and, when nothing
 * awaited it, turned a failed login into an unhandled rejection.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");

const client = (login) => {
  const w = Object.create(WyzeAPI.prototype);
  w.access_token = "";
  w.lastLoginAttempt = 0;
  w.loginAttemptDebounceMilliseconds = 1000;
  w.log = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  w._loadPersistedTokens = async () => {};
  w.sleepSeconds = async () => {}; // the debounce wait, without waiting
  w.login = login(w);
  return w;
};

test("callers that arrive while a login is running share it, and all get the token", async () => {
  let logins = 0;
  let finish;
  const w = client((self) => () => {
    logins += 1;
    return new Promise((resolve) => { finish = () => { self.access_token = "token"; resolve(); }; });
  });
  const first = w.maybeLogin();
  const second = w.maybeLogin();
  const third = w.maybeLogin();
  await new Promise((resolve) => setImmediate(resolve));
  finish();
  await Promise.all([first, second, third]);
  assert.strictEqual(logins, 1, "one login, not one per caller");
  assert.strictEqual(w.access_token, "token");
});

test("a failed login rejects every waiting caller and leaves nothing unhandled", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    let logins = 0;
    const w = client(() => async () => { logins += 1; throw new Error("bad credentials"); });
    const results = await Promise.allSettled([w.maybeLogin(), w.maybeLogin()]);
    assert.deepStrictEqual(results.map((r) => r.status), ["rejected", "rejected"]);
    assert.match(results[0].reason.message, /bad credentials/);
    assert.strictEqual(logins, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("after a login finishes the next caller can log in again", async () => {
  let logins = 0;
  const w = client((self) => async () => { logins += 1; self.access_token = `t${logins}`; });
  await w.maybeLogin();
  w.access_token = ""; // the token was rejected
  w.lastLoginAttempt = 0; // past the debounce
  await w.maybeLogin();
  assert.strictEqual(logins, 2);
});

test("with a token already present, maybeLogin does not log in", async () => {
  let logins = 0;
  const w = client(() => async () => { logins += 1; });
  w.access_token = "have";
  await w.maybeLogin();
  assert.strictEqual(logins, 0);
});
