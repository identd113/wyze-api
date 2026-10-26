/**
 * A capture whose ffmpeg lost a race for its local UDP port is tried once more; other
 * failures are not retried.
 */
const test = require("node:test");
const assert = require("node:assert");
const cameraStreamCapture = require("../src/devices/cameraStreamCapture");
const WyzeAPI = require("../src/index");

function setup(outcomes) {
  const w = Object.create(WyzeAPI.prototype);
  let fetched = 0;
  w.getCameraWebRTCConnectionInfo = async () => { fetched += 1; return { signalingUrl: `wss://x/${fetched}`, iceServers: [] }; };
  const real = cameraStreamCapture.captureStreamFrame;
  const urls = [];
  cameraStreamCapture.captureStreamFrame = async ({ signalingUrl }) => {
    urls.push(signalingUrl);
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { w, urls, restore: () => { cameraStreamCapture.captureStreamFrame = real; } };
}

test("a bind failure is retried once, with fresh connection details", async () => {
  const { w, urls, restore } = setup([
    new Error("ffmpeg exited (1) without producing a frame: [udp @ 0x1] bind failed: Address already in use"),
    Buffer.from("jpg"),
  ]);
  try {
    const buffer = await w.cameraCaptureSnapshot("AA", "M", { noCache: true });
    assert.strictEqual(buffer.toString(), "jpg");
    assert.deepStrictEqual(urls, ["wss://x/1", "wss://x/2"]);
  } finally { restore(); }
});

test("a second bind failure is reported, not retried again", async () => {
  const bind = () => new Error("ffmpeg exited (1) without producing a frame: bind failed: Address already in use");
  const { w, urls, restore } = setup([bind(), bind(), Buffer.from("never")]);
  try {
    await assert.rejects(() => w.cameraCaptureSnapshot("AA", "M", { noCache: true }), /Address already in use/);
    assert.strictEqual(urls.length, 2);
  } finally { restore(); }
});

test("other failures are not retried", async () => {
  const { w, urls, restore } = setup([new Error("capture timed out after 20000ms"), Buffer.from("never")]);
  try {
    await assert.rejects(() => w.cameraCaptureSnapshot("AA", "M", { noCache: true }), /timed out/);
    assert.strictEqual(urls.length, 1);
  } finally { restore(); }
});
