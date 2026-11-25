/**
 * WyzeAPI and the account email. The email is needed even for apiKey/keyId auth, since it namespaces the persisted
 * token cache file (see _tokenPersistPath). 1.x let the constructor succeed and failed on the first login with a cryptic
 * "TypeError: Value must be string" from uuid-by-string, so 2.x stays a drop-in by building the client without it and
 * saying clearly, on the first login, what is missing.
 */
const test = require("node:test");
const assert = require("node:assert");
const WyzeAPI = require("../src/index");

for (const [what, username] of [["missing", undefined], ["an empty string", ""], ["not a string", 12345]]) {
  test(`the constructor accepts a username that is ${what}, as 1.x did`, () => {
    assert.doesNotThrow(() => new WyzeAPI({ username, password: "pw", persistPath: "/tmp" }));
  });

  test(`the first login says clearly what is missing when the username is ${what}`, async () => {
    const w = new WyzeAPI({ username, password: "pw", persistPath: "/tmp" });
    await assert.rejects(() => w.maybeLogin(), /requires a non-empty 'username'/);
  });

  test(`a request made with a username that is ${what} fails the same clear way, before anything is sent`, async () => {
    const w = new WyzeAPI({ username, password: "pw", persistPath: "/tmp" });
    await assert.rejects(() => w.request("app/v2/home_page/get_object_list"), /requires a non-empty 'username'/);
  });
}

test("constructor succeeds when username is a non-empty string", () => {
  const w = new WyzeAPI({
    username: "user@example.com",
    password: "pw",
    persistPath: "/tmp",
  });
  assert.strictEqual(w.username, "user@example.com");
});
