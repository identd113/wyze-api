/**
 * Fixes from the full code audit: a failed login keeps its real message, stream secrets stay out of errors and logs,
 * a disk that cannot be written does not fail a login, and the device report's scrubber covers server addresses and IPv6.
 */
const test = require("node:test");
const assert = require("node:assert");
const axios = require("axios");

const WyzeAPI = require("../src/index");
const { sanitizeLogMessage } = require("../src/util/security");
const { scrub, scrubString } = require("../src/deviceReport");

const stub = (overrides = {}) => {
  const w = Object.create(WyzeAPI.prototype);
  w.apiKey = "k"; w.keyId = "i"; w.apiLogEnabled = false;
  const lines = [];
  w.log = { info: () => {}, error: (m) => lines.push(m), warning: () => {}, debug: () => {}, warn: () => {} };
  w.lines = lines;
  w._persistTokens = async () => {};
  Object.assign(w, overrides);
  return w;
};

test("a failed login whose reply cannot be turned into JSON still says why", async () => {
  // an axios response has circular references (response.request.res = response), which stringify refuses
  const circular = { ok: false, status: 200, data: { code: "1001", msg: "wrong password" } };
  circular.request = { response: circular };
  const w = stub({ _performLoginRequest: async () => circular });
  await assert.rejects(() => w.login(), (e) => e instanceof Error && !(e instanceof TypeError) && /Invalid credentials.*wrong password/.test(e.message));
});

test("a rate-limited login reply (a whole axios-like object with extras) is described, not thrown on", async () => {
  const reply = { ok: false, data: { code: "2001" }, error: { message: "Rate Limited - wait", code: 2001 } };
  reply.config = { agent: reply };
  const w = stub({ _performLoginRequest: async () => reply });
  await assert.rejects(() => w.login(), /Invalid credentials.*Rate Limited/);
});

test("tokens that cannot be saved to disk still count as a good login", async () => {
  const w = stub({ _persistTokens: async () => { throw new Error("EROFS: read-only file system"); } });
  await w._updateTokens({ access_token: "at", refresh_token: "rt" }); // must not throw
  assert.strictEqual(w.access_token, "at");
  assert.strictEqual(w.refresh_token, "rt");
  assert.ok(w.lines.some((l) => /Could not save the login to disk \(EROFS/.test(l)));
});

test("an unexpected get-streams answer does not put the signaling URL, auth token or TURN credentials in the error or the log", async () => {
  const secret = { signaling_url: "wss://kinesis.example/?X-Amz-Signature=SECRETSIG", auth_token: "SECRETTOKEN", ice_servers: [{ url: "turn:x", username: "SECRETUSER", credential: "SECRETCRED" }] };
  const answers = [
    { code: 1, data: [{ params: secret }, { params: secret }] }, // two entries
    { code: 1, data: [{ params: secret }] }, // no property
  ];
  const original = axios.post;
  const w = stub({ maybeLogin: async () => {}, _checkRateLimit: async () => {}, access_token: "at" });
  const debug = [];
  w.log = { ...w.log, debug: (m) => debug.push(m) };
  try {
    for (const answer of answers) {
      axios.post = async () => ({ data: answer, headers: {} });
      await assert.rejects(() => w.cameraGetStreamInfo("AA", "HL_X"), (e) => {
        assert.ok(!/SECRET/.test(e.message), `secret in error: ${e.message}`);
        return /Unexpected response from cameraGetStreamInfo/.test(e.message);
      });
    }
  } finally { axios.post = original; }
  assert.ok(debug.length > 0 && debug.every((m) => !/SECRET/.test(m)), "no secret in the debug log");
  assert.ok(w.lines.every((l) => !/SECRET/.test(l)), "no secret in the error log");
});

test("log redaction also covers the stream auth token, signaling URL and credential", () => {
  const line = sanitizeLogMessage('{"auth_token":"AAA111","signaling_url":"wss://h/?sig=BBB222","credential":"CCC333","ok":1}');
  assert.ok(!/AAA111|BBB222|CCC333/.test(line), line);
});

test("the device report keeps firmware versions but hides a server address, and hides IPv6 addresses everywhere", () => {
  const out = scrub({ server: "192.168.1.20", dns_server: "10.0.0.1", driver: "10.1.1.1", fw_ver: "4.51.3.6791", hwver: "1.2.3.4", note: "reach me at fe80::1c2b:3dff:fe4e:5f60 or 2001:db8::5", at: "12:30:45", mac: "AA:BB:CC:DD:EE:FF" });
  assert.strictEqual(out.server, "<ip>");
  assert.strictEqual(out.dns_server, "<ip>");
  assert.strictEqual(out.driver, "<ip>");
  assert.strictEqual(out.fw_ver, "4.51.3.6791");
  assert.strictEqual(out.hwver, "1.2.3.4");
  assert.ok(!/fe80|2001:db8/.test(out.note), out.note);
  assert.strictEqual(out.at, "12:30:45", "a time is not an address");
  assert.strictEqual(scrubString("a 192.168.0.9 b", [], true), "a 192.168.0.9 b", "a version-shaped value under a version key is kept");
  assert.strictEqual(scrubString("host fe80::1", [], true), "host <ip>", "but an IPv6 address never is");
});
