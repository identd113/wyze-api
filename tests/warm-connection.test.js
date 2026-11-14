/**
 * A connection opened ahead of time ("warm") is handed to the live stream that wants it,
 * and pictures can be made from its latest keyframe.
 */
const test = require("node:test");
const assert = require("node:assert");
const { KeyframeTracker } = require("../src/devices/keyframeTracker");
const WyzeAPI = require("../src/index");

// ---- keyframe tracker ------------------------------------------------------------

test("a keyframe is kept once the next frame starts, and only the newest complete one", () => {
  const k = new KeyframeTracker();
  k.push(Buffer.from("a1"), 100, true);
  k.push(Buffer.from("a2"), 100, false);
  assert.strictEqual(k.latest, null, "not complete until a different frame follows");
  k.push(Buffer.from("p"), 200, false);
  assert.deepStrictEqual(k.latest.packets.map(String), ["a1", "a2"]);
  k.push(Buffer.from("b1"), 300, true);
  k.push(Buffer.from("b2"), 300, false);
  k.push(Buffer.from("p"), 400, false);
  assert.deepStrictEqual(k.latest.packets.map(String), ["b1", "b2"], "replaced by the newer keyframe");
  assert.strictEqual(k.latest.ts, 300);
});

test("frames that are not keyframes are ignored, even before the first keyframe", () => {
  const k = new KeyframeTracker();
  k.push(Buffer.from("p1"), 10, false);
  k.push(Buffer.from("p2"), 20, false);
  assert.strictEqual(k.latest, null);
  assert.strictEqual(k.building, null);
});

test("a keyframe too big to keep is not kept, and the previous one stays", () => {
  const k = new KeyframeTracker({ maxPackets: 2 });
  k.push(Buffer.from("a"), 1, true);
  k.push(Buffer.from("p"), 2, false);
  assert.ok(k.latest);
  k.push(Buffer.from("b1"), 3, true);
  k.push(Buffer.from("b2"), 3, false);
  k.push(Buffer.from("b3"), 3, false); // over the limit
  k.push(Buffer.from("p"), 4, false);
  assert.deepStrictEqual(k.latest.packets.map(String), ["a"]);
});

// ---- the hand-over ---------------------------------------------------------------

function fakeHandle(extra = {}) {
  const calls = { attach: [], stop: 0, snapshot: 0 };
  const handle = {
    calls,
    isAlive: () => true,
    attach: (o) => calls.attach.push(o),
    stop: async () => { calls.stop += 1; },
    snapshot: async () => { calls.snapshot += 1; return { buffer: Buffer.from("jpg"), ageMs: 5 }; },
    ...extra,
  };
  return handle;
}
const withWarm = (handle, mac = "AA") => {
  const w = Object.create(WyzeAPI.prototype);
  const entry = { mac, ready: true, handle, timer: setTimeout(() => {}, 100000), promise: Promise.resolve(handle) };
  entry.timer.unref();
  w._warm = new Map([[mac, entry]]);
  return { w, entry };
};

test("a live stream takes the open connection instead of making a new one", async () => {
  const handle = fakeHandle();
  const { w } = withWarm(handle);
  let asked = 0;
  w.getCameraWebRTCConnectionInfo = async () => { asked += 1; throw new Error("should not be asked"); };
  const got = await w.cameraStartRtpForwarding("AA", "M", 5000, { localAudioRtpPort: 5002, onVideoIdle: () => {}, videoIdleMs: 10000 });
  assert.strictEqual(got, handle);
  assert.strictEqual(asked, 0);
  assert.strictEqual(handle.calls.attach.length, 1);
  assert.strictEqual(handle.calls.attach[0].localRtpPort, 5000);
  assert.strictEqual(handle.calls.attach[0].localAudioRtpPort, 5002);
  assert.strictEqual(w._warm.has("AA"), false, "it is the stream's now, not the warm pool's");
});

test("a connection that is still being made is waited for, not duplicated", async () => {
  const handle = fakeHandle();
  const w = Object.create(WyzeAPI.prototype);
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  w._warm = new Map([["AA", { mac: "AA", ready: false, handle: null, timer: null, promise }]]);
  const starting = w.cameraStartRtpForwarding("AA", "M", 5000, {});
  setTimeout(() => resolve(handle), 10);
  assert.strictEqual(await starting, handle);
  assert.strictEqual(handle.calls.attach.length, 1);
});

test("if the open connection failed or is gone, a stream makes its own", async () => {
  const w = Object.create(WyzeAPI.prototype);
  w._warm = new Map([["AA", { mac: "AA", ready: false, handle: null, timer: null, promise: Promise.reject(new Error("camera never answered")) }]]);
  w.getCameraWebRTCConnectionInfo = async () => { throw new Error("made a new one"); };
  await assert.rejects(() => w.cameraStartRtpForwarding("AA", "M", 5000, {}), /made a new one/);
  const dead = fakeHandle({ isAlive: () => false });
  const { w: w2 } = withWarm(dead);
  w2.getCameraWebRTCConnectionInfo = async () => { throw new Error("made a new one"); };
  await assert.rejects(() => w2.cameraStartRtpForwarding("AA", "M", 5000, {}), /made a new one/);
  assert.strictEqual(dead.calls.attach.length, 0);
});

test("state, picture and close of an open connection", async () => {
  const handle = fakeHandle();
  const { w } = withWarm(handle);
  assert.strictEqual(w.cameraWarmState("AA"), "ready");
  assert.strictEqual(w.cameraWarmState("ZZ"), null);
  const shot = await w.cameraWarmSnapshot("AA");
  assert.strictEqual(shot.buffer.toString(), "jpg");
  assert.strictEqual(await w.cameraWarmSnapshot("ZZ"), null);
  await w.cameraWarmDown("AA");
  assert.strictEqual(handle.calls.stop, 1);
  assert.strictEqual(w.cameraWarmState("AA"), null);
  await w.cameraWarmDown("AA"); // already gone: nothing happens
  assert.strictEqual(handle.calls.stop, 1);
});

test("a connection that is still being made reports 'connecting' and has no picture yet", async () => {
  const w = Object.create(WyzeAPI.prototype);
  w._warm = new Map([["AA", { mac: "AA", ready: false, handle: null, timer: null, promise: new Promise(() => {}) }]]);
  assert.strictEqual(w.cameraWarmState("AA"), "connecting");
  assert.strictEqual(await w.cameraWarmSnapshot("AA"), null);
});

// ---- found in review -----------------------------------------------------------------

test("a keyframe made only of parameter sets, under a timestamp of its own, is not kept", () => {
  const k = new KeyframeTracker();
  k.push(Buffer.from("idr-a"), 100, true, true);
  k.push(Buffer.from("p"), 200, false, false);
  assert.deepStrictEqual(k.latest.packets.map(String), ["idr-a"]);
  k.push(Buffer.from("sps"), 300, true, false); // an SPS/PPS run with no IDR slice in it
  k.push(Buffer.from("idr-b-1"), 310, true, true); // the IDR under its own timestamp
  k.push(Buffer.from("idr-b-2"), 310, false, true);
  k.push(Buffer.from("p"), 320, false, false);
  assert.deepStrictEqual(k.latest.packets.map(String), ["idr-b-1", "idr-b-2"], "the IDR frame replaced it, not the parameter sets");
  k.push(Buffer.from("sps2"), 400, true, false);
  k.push(Buffer.from("p"), 410, false, false);
  assert.deepStrictEqual(k.latest.packets.map(String), ["idr-b-1", "idr-b-2"], "a parameter-set-only run never replaces a real keyframe");
});

test("an open connection that was closed from outside is forgotten, not renewed for ever", async () => {
  const handle = fakeHandle({ isAlive: () => false });
  const { w } = withWarm(handle);
  assert.strictEqual(w.cameraWarmState("AA"), null);
  assert.strictEqual(w._warm.has("AA"), false);
  const again = withWarm(fakeHandle({ isAlive: () => false }));
  assert.strictEqual(await again.w.cameraWarmSnapshot("AA"), null);
  assert.strictEqual(again.w._warm.has("AA"), false);
});

test("rtpContainsIdr finds an IDR slice whether or not it starts the fragment run", () => {
  const cap = require("../src/devices/cameraStreamCapture");
  const fu = (type, start) => Buffer.from([0x7c, (start ? 0x80 : 0) | type, 1]);
  assert.strictEqual(cap.rtpContainsIdr(Buffer.from([0x65, 1])), true);
  assert.strictEqual(cap.rtpContainsIdr(fu(5, false)), true, "a later fragment of an IDR");
  assert.strictEqual(cap.rtpContainsIdr(fu(1, true)), false);
  assert.strictEqual(cap.rtpContainsIdr(Buffer.from([0x67, 1])), false, "an SPS is not an IDR");
  assert.strictEqual(cap.rtpContainsIdr(null), false);
});

// ---- a keyframe with a packet missing is never kept ------------------------------------

test("a keyframe with a packet missing inside it is not kept, and the previous one stays", () => {
  const k = new KeyframeTracker();
  const push = (name, ts, starts, idr, seq) => k.push(Buffer.from(name), ts, starts, idr, 0, seq);
  push("a1", 100, true, true, 10);
  push("a2", 100, false, true, 11);
  push("p", 200, false, false, 12);
  assert.deepStrictEqual(k.latest.packets.map(String), ["a1", "a2"]);
  push("b1", 300, true, true, 20);
  push("b3", 300, false, true, 22); // 21 never arrived
  push("p", 400, false, false, 23);
  assert.deepStrictEqual(k.latest.packets.map(String), ["a1", "a2"], "the damaged keyframe is dropped");
});

test("a keyframe whose last packet is missing is not kept", () => {
  const k = new KeyframeTracker();
  k.push(Buffer.from("b1"), 300, true, true, 0, 20);
  k.push(Buffer.from("b2"), 300, false, true, 0, 21);
  // 22 (the last packet of the frame) was lost: the next frame starts at 23
  k.push(Buffer.from("p"), 400, false, false, 0, 23);
  assert.strictEqual(k.latest, null);
});

test("sequence numbers wrap at 65535 without being taken for a gap", () => {
  const k = new KeyframeTracker();
  k.push(Buffer.from("a1"), 100, true, true, 0, 65534);
  k.push(Buffer.from("a2"), 100, false, true, 0, 65535);
  k.push(Buffer.from("a3"), 100, false, true, 0, 0);
  k.push(Buffer.from("p"), 200, false, false, 0, 1);
  assert.deepStrictEqual(k.latest.packets.map(String), ["a1", "a2", "a3"]);
});

test("a frame that starts mid-way (its first packet lost) is never started", () => {
  const k = new KeyframeTracker();
  k.push(Buffer.from("mid"), 100, false, true, 0, 11); // a fragment from the middle of an IDR slice
  k.push(Buffer.from("end"), 100, false, true, 0, 12);
  k.push(Buffer.from("p"), 200, false, false, 0, 13);
  assert.strictEqual(k.latest, null);
});
