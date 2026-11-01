/**
 * 2.x stays a drop-in replacement for 1.x (1.1.15, branch main).
 *
 * `fixtures/api-1.1.15.json` pins what 1.1.15 offered: its public method names and parameter order, its module
 * exports, and what its pure methods (no network, clock or randomness) returned for sample inputs. These tests fail
 * if a 2.x change drops or reorders any of that.
 *
 * Differences from 1.x are on purpose, and each one is listed in KNOWN_DIFFERENCES below. To add another, put it
 * there with the reason, and note it in the changelog under "Migrating from 1.x".
 */
const test = require("node:test");
const assert = require("node:assert");
const WyzeAPI = require("../src/index");
const pinned = require("./fixtures/api-1.1.15.json");

// Public methods that 1.x had and 2.x does not, and parameters 2.x no longer takes. Keep this list short.
const KNOWN_DIFFERENCES = {
  removedMethods: {
    authenticateAndFetchData: "A Roku-auth helper that only logged a token. It went with the aws-sdk dependency.",
  },
  droppedParameters: {
    localBulbCommand: "1.x took a seventh parameter, actionKey, and never used it.",
  },
};

function methodsOf(proto) {
  const found = new Map();
  for (let p = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const name of Object.getOwnPropertyNames(p)) {
      const descriptor = Object.getOwnPropertyDescriptor(p, name);
      if (name !== "constructor" && typeof descriptor.value === "function" && !found.has(name)) found.set(name, descriptor.value);
    }
  }
  return found;
}

// The parameter names of a function, in order, from its source (default values and `...` stripped).
function parametersOf(fn) {
  const match = fn.toString().match(/^(?:async\s*)?(?:function\s*\*?\s*)?\w*\s*\(([^)]*)\)/);
  return (match ? match[1] : "").split(",").map((s) => s.trim().split("=")[0].trim()).filter(Boolean);
}

const methods = methodsOf(WyzeAPI.prototype);

test("every public method 1.x had is still there, with its parameters in the same order", () => {
  const problems = [];
  for (const [name, params] of Object.entries(pinned.methods)) {
    if (KNOWN_DIFFERENCES.removedMethods[name]) continue;
    const fn = methods.get(name);
    if (!fn) {
      problems.push(`${name} is missing`);
      continue;
    }
    const now = parametersOf(fn);
    const allowed = KNOWN_DIFFERENCES.droppedParameters[name] ? params.length - 1 : params.length;
    if (now.length < allowed) problems.push(`${name} takes ${now.length} parameters (${now.join(", ")}); 1.x took ${params.length} (${params.join(", ")})`);
  }
  assert.deepStrictEqual(problems, []);
});

test("the known differences are still real, so the list does not go stale", () => {
  for (const name of Object.keys(KNOWN_DIFFERENCES.removedMethods)) assert.ok(!methods.has(name), `${name} is back: remove it from KNOWN_DIFFERENCES`);
  for (const [name] of Object.entries(KNOWN_DIFFERENCES.droppedParameters)) {
    assert.ok(parametersOf(methods.get(name)).length < pinned.methods[name].length, `${name} takes all its 1.x parameters again: remove it from KNOWN_DIFFERENCES`);
  }
});

test("every export 1.x had is still exported", () => {
  const now = new Set(Object.keys(WyzeAPI));
  assert.deepStrictEqual(pinned.exports.filter((name) => !now.has(name)), []);
});

test("the constructor takes every option 1.x took", () => {
  const options = {
    username: "u", password: "p", keyId: "k", apiKey: "a", mfaCode: "123456", persistPath: require("node:os").tmpdir(),
    refreshTokenTimerEnabled: false, lowBatteryPercentage: 25, apiLogEnabled: false,
    authBaseUrl: "https://example.test/", apiBaseUrl: "https://example.test/", authApiKey: "x", phoneId: "x", appName: "x",
    appVer: "x", appVersion: "x", userAgent: "x", sc: "x", sv: "x", fordAppKey: "x", fordAppSecret: "x",
    oliveSigningSecret: "x", oliveAppId: "x", appInfo: "x", logLevel: "silent",
  };
  const client = new WyzeAPI(options);
  try {
    assert.strictEqual(client.lowBatteryPercentage, 25);
    for (const field of ["access_token", "refresh_token", "persistPath", "lastLoginAttempt", "loginAttemptDebounceMilliseconds"]) {
      assert.ok(field in client, `${field} is no longer set on the client`);
    }
  } finally {
    client.destroy?.();
  }
});

test("pure methods return what 1.x returned", () => {
  // Built with the defaults, as the pins were taken: a few methods read settings such as lowBatteryPercentage.
  const client = new WyzeAPI({ username: "u", password: "p", persistPath: require("node:os").tmpdir(), logLevel: "silent" });
  const problems = [];
  for (const [name, pins] of Object.entries(pinned.behavior)) {
    for (const { args, result } of pins) {
      let got;
      try {
        got = client[name](...args);
      } catch (error) {
        got = `THROWS ${error.message}`;
      }
      if (JSON.stringify(got) !== JSON.stringify(result)) problems.push(`${name}(${JSON.stringify(args)}) = ${JSON.stringify(got)}, 1.x gave ${JSON.stringify(result)}`);
    }
  }
  client.destroy?.();
  assert.deepStrictEqual(problems, []);
});

test("checkColorTemp and checkBrightnessValue are fixed in 2.x, on purpose", () => {
  const client = Object.create(WyzeAPI.prototype);
  // 1.x returned 500 for any colour temperature below 500, and passed brightness through whatever it was.
  assert.strictEqual(client.checkColorTemp(300), 300);
  assert.strictEqual(client.checkColorTemp(100), 140);
  assert.strictEqual(client.checkColorTemp(900), 500);
  assert.strictEqual(client.checkBrightnessValue(0), 1);
  assert.strictEqual(client.checkBrightnessValue(150), 100);
});
