/**
 * A request that carries a timestamp, a nonce or a signature made before a rate-limit wait must be made again after it:
 * the wait can be two minutes, and Wyze may refuse a stale one. The class of mistake is anywhere a request is signed
 * or timestamped, so a sweep over the source checks every such call.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const rl = require("../src/util/rateLimit");
const { freshStamp } = require("../src/util/requestStamp");

const isWyze = (h) => h === "api.wyzecam.com";

test.beforeEach(() => rl._gates.clear());

test("freshStamp sets nonce and ts to now in the type each had, and touches nothing else", () => {
  const out = freshStamp({ nonce: "1", ts: 5, plan_execute_ts: 9, nested: { nonce: "keep" }, name: "x" }, 777);
  assert.deepStrictEqual(out, { nonce: "777", ts: 777, plan_execute_ts: 9, nested: { nonce: "keep" }, name: "x" });
  assert.strictEqual(freshStamp({ nonce: 1 }, 777).nonce, 777, "a number stays a number");
  assert.strictEqual(freshStamp({ a: 1 }, 777).nonce, undefined, "no nonce is added where there was none");
  assert.strictEqual(freshStamp(null), null);
  assert.deepStrictEqual(freshStamp([1]), [1]);
});

test("a request sent again after a 429 wait is built again: new body, new signature, new token", async () => {
  const sent = [];
  let clock = 1000;
  const handlers = rl.createRateLimitHandlers({
    isWyzeHost: isWyze,
    send: async (config) => { sent.push(JSON.parse(JSON.stringify(config))); return { ok: true }; },
    sleep: async (ms) => { clock += ms; }, // the wait moves the clock
    now: () => clock,
  });
  const build = () => ({ data: { nonce: String(clock), sig: `sig-${clock}` }, headers: { authorization: `token-${clock}` } });
  const config = rl.rebuildable(build, { url: "https://api.wyzecam.com/x", method: "post" });
  assert.strictEqual(config.data.nonce, "1000");

  await handlers.onError({ config, response: { status: 429, headers: { "retry-after": "60" } } });

  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(sent[0].data, { nonce: "61000", sig: "sig-61000" }, "signed again after the wait");
  assert.strictEqual(sent[0].headers.authorization, "token-61000");
  assert.strictEqual(sent[0].url, "https://api.wyzecam.com/x", "the rest of the request is kept");
});

test("a request with no rebuild hook is still sent again as it was", async () => {
  const sent = [];
  const handlers = rl.createRateLimitHandlers({
    isWyzeHost: isWyze,
    send: async (config) => { sent.push(config); return { ok: true }; },
    sleep: async () => {},
    now: () => 0,
  });
  const config = { url: "https://api.wyzecam.com/x", data: { a: 1 }, headers: { h: "1" } };
  await handlers.onError({ config, response: { status: 429, headers: { "retry-after": "1" } } });
  assert.deepStrictEqual(sent[0].data, { a: 1 });
});

// ---- the sweep ----

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

// Calls that sign or stamp something but are not Wyze requests that a rate limit holds and sends again: a request to
// a bulb on the local network (src/index.js, localBulbCommand).
const NOT_A_WYZE_HOST = ["src/index.js:localBulbCommand"];

test("every request that is signed or carries a nonce can be rebuilt after a rate-limit wait", () => {
  const root = path.join(__dirname, "..");
  const callPattern = /axios(?:\.(?:post|get|request|delete|patch|put))?\(/g;
  const stampPattern = /nonce|signature|Signature|timestamp|fordCreatePayload|\bts\b/;
  const offenders = [];
  let checked = 0;
  for (const file of sourceFiles(path.join(root, "src"))) {
    const rel = path.relative(root, file);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(callPattern)) {
      if (/require\(|^\s*\*|\/\//.test(text.slice(text.lastIndexOf("\n", match.index) + 1, match.index))) continue;
      checked += 1;
      const before = text.slice(Math.max(0, match.index - 1800), match.index);
      const after = text.slice(match.index, match.index + 900);
      const call = after.split(/\n {4}\} catch|\n {6}\} catch|\n {2}\},\n/)[0];
      const functionStart = before.lastIndexOf("\n  async ");
      const body = before.slice(functionStart === -1 ? 0 : functionStart) + call;
      if (!stampPattern.test(body)) continue;
      if (/__wyzeRebuild/.test(body)) continue;
      if (NOT_A_WYZE_HOST.some((k) => k.startsWith(`${rel}:`) && body.includes(k.split(":")[1]))) continue;
      offenders.push(`${rel}: ${call.split("\n")[0].trim()}`);
    }
  }
  assert.ok(checked >= 10, `the sweep only found ${checked} request calls; the pattern is wrong`);
  assert.deepStrictEqual(offenders, []);
});
