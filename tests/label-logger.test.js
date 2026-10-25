const test = require("node:test");
const assert = require("node:assert");
const { labelLogger } = require("../src/devices/cameraStreamCapture");

test("labelLogger prefixes every level with the camera name", () => {
  const seen = [];
  const base = {
    debug: (m) => seen.push(["debug", m]),
    warn: (m) => seen.push(["warn", m]),
    error: (m) => seen.push(["error", m]),
  };
  const log = labelLogger(base, "Garage");
  log.debug("[stream] hello");
  log.warn("[capture] careful");
  log.error("boom");
  assert.deepStrictEqual(seen, [
    ["debug", "Garage: [stream] hello"],
    ["warn", "Garage: [capture] careful"],
    ["error", "Garage: boom"],
  ]);
});

test("labelLogger leaves levels the logger does not have undefined, and passes null through", () => {
  const log = labelLogger({ debug() {} }, "Garage");
  assert.strictEqual(typeof log.debug, "function");
  assert.strictEqual(log.warning, undefined);
  assert.strictEqual(labelLogger(null, "Garage"), null);
  const base = { debug() {} };
  assert.strictEqual(labelLogger(base, ""), base);
});
