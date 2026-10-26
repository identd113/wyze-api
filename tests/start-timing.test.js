const test = require("node:test");
const assert = require("node:assert");
const { rememberSprop, recallSprop, forgetSprop, formatStartTiming } = require("../src/devices/cameraStreamCapture");
const WyzeAPI = require("../src/index");

test("a camera's SPS/PPS are remembered, per camera, and can be forgotten", () => {
  rememberSprop("AA", "spsA,ppsA");
  rememberSprop("BB", "spsB,ppsB");
  assert.strictEqual(recallSprop("AA"), "spsA,ppsA");
  assert.strictEqual(recallSprop("BB"), "spsB,ppsB");
  forgetSprop("AA");
  assert.strictEqual(recallSprop("AA"), null);
  assert.strictEqual(recallSprop("nobody"), null);
  assert.strictEqual(recallSprop(null), null);
  rememberSprop(null, "x"); // no key: ignored
  rememberSprop("CC", ""); // nothing to remember: ignored
  assert.strictEqual(recallSprop("CC"), null);
  forgetSprop("BB");
});

test("remembered SPS/PPS expire after 30 minutes", () => {
  const realNow = Date.now;
  try {
    rememberSprop("EXP", "s,p");
    Date.now = () => realNow() + 29 * 60_000;
    assert.strictEqual(recallSprop("EXP"), "s,p");
    Date.now = () => realNow() + 31 * 60_000;
    assert.strictEqual(recallSprop("EXP"), null);
  } finally {
    Date.now = realNow;
  }
});

test("the timing line shows each step in milliseconds after the start", () => {
  const t = 1_000_000;
  const line = formatStartTiming(
    { startedAt: t, connectionInfoAt: t + 300, connectionInfoFrom: "fetched ahead", signalingOpenAt: t + 350, negotiatedAt: t + 700, parametersAt: t + 710, parametersFrom: "remembered", firstKeyframeAt: t + 900 },
    { ffmpegStartedAt: t + 760, releasedAt: t + 960, hadKeyframe: true }
  );
  assert.strictEqual(
    line,
    "timing: connection info 300 ms (fetched ahead), signaling open 350 ms, negotiated 700 ms, parameters 710 ms (remembered), first keyframe 900 ms, ffmpeg started 760 ms, first frame handed over 960 ms"
  );
});

test("a step that did not happen shows a dash, and a missed keyframe is said so", () => {
  const t = 5000;
  const line = formatStartTiming({ startedAt: t, connectionInfoAt: t + 10, signalingOpenAt: t + 20, negotiatedAt: t + 30, parametersAt: t + 40 }, { releasedAt: t + 500, hadKeyframe: false });
  assert.match(line, /first keyframe -,/);
  assert.match(line, /first frame handed over 500 ms \(asked the camera for a new keyframe\)$/);
});

test("connection details fetched ahead are used once, and only while fresh", async () => {
  const w = Object.create(WyzeAPI.prototype);
  let calls = 0;
  w.getCameraWebRTCConnectionInfo = async (mac, model, opts) => { calls += 1; assert.strictEqual(opts.noCache, true); return { signalingUrl: `wss://x/${calls}` }; };
  w.prefetchCameraConnection("AA", "M");
  const first = w._takePrefetchedConnection("AA", "M");
  assert.strictEqual((await first).signalingUrl, "wss://x/1");
  assert.strictEqual(w._takePrefetchedConnection("AA", "M"), null, "used once");
  assert.strictEqual(w._takePrefetchedConnection("ZZ", "M"), null, "per camera");
  w.prefetchCameraConnection("AA", "M");
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 31_000;
    assert.strictEqual(w._takePrefetchedConnection("AA", "M"), null, "stale after 30 s");
  } finally {
    Date.now = realNow;
  }
});

test("a failed prefetch is not an unhandled error", async () => {
  const w = Object.create(WyzeAPI.prototype);
  w.getCameraWebRTCConnectionInfo = async () => { throw new Error("cloud down"); };
  w.prefetchCameraConnection("AA", "M");
  const p = w._takePrefetchedConnection("AA", "M");
  await assert.rejects(() => p, /cloud down/);
});
