/**
 * A camera serves one connection at a time, and cameraWarmUp's connection claims the same slot as a live stream, so
 * warming a camera that is streaming used to close the stream. It now does nothing and resolves false.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");
const { _claimSession } = require("../src/devices/cameraStreamCapture");

const MAC = "AABBCCDDEEFF";
const client = (onConnectionInfo) => {
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info() {}, error() {}, warn() {}, debug() {} };
  w.getCameraWebRTCConnectionInfo = async () => { onConnectionInfo(); throw new Error("stop: the test needs no real connection"); };
  return w;
};

test("cameraWarmUp does not touch a camera that has a live stream open", async () => {
  let closed = false;
  let asked = false;
  const release = await _claimSession(MAC, "stream", async () => { closed = true; });
  try {
    const w = client(() => { asked = true; });
    assert.strictEqual(await w.cameraWarmUp(MAC, "HL_DB2"), false);
    assert.strictEqual(asked, false, "no connection was set up");
    assert.strictEqual(closed, false, "the live stream was not closed");
    assert.strictEqual(w.cameraWarmState(MAC), null);
  } finally {
    release();
  }
});

test("with the camera free, cameraWarmUp goes ahead", async () => {
  let asked = false;
  const w = client(() => { asked = true; });
  assert.strictEqual(await w.cameraWarmUp(MAC, "HL_DB2"), false); // false because the stub fails, after trying
  assert.strictEqual(asked, true);
});
