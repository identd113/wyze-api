/**
 * WyzeAPI constructor validation — username is required even for apiKey/keyId
 * auth, since it's used to namespace the persisted token cache file
 * (see _tokenPersistPath). Missing it used to surface as a cryptic
 * "TypeError: Value must be string" from the uuid-by-string dependency on
 * the first maybeLogin() call instead of failing fast at construction.
 */
const test = require("node:test");
const assert = require("node:assert");
const WyzeAPI = require("../src/index");

test("constructor throws a clear error when username is missing", () => {
  assert.throws(
    () => new WyzeAPI({ password: "pw", persistPath: "/tmp" }),
    /requires a non-empty 'username'/
  );
});

test("constructor throws when username is empty string", () => {
  assert.throws(
    () => new WyzeAPI({ username: "", password: "pw", persistPath: "/tmp" }),
    /requires a non-empty 'username'/
  );
});

test("constructor throws when username is not a string", () => {
  assert.throws(
    () => new WyzeAPI({ username: 12345, password: "pw", persistPath: "/tmp" }),
    /requires a non-empty 'username'/
  );
});

test("constructor succeeds when username is a non-empty string", () => {
  const w = new WyzeAPI({
    username: "user@example.com",
    password: "pw",
    persistPath: "/tmp",
  });
  assert.strictEqual(w.username, "user@example.com");
});
