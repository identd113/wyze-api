/**
 * A Wyze camera serves one WebRTC viewer at a time. Sessions to a camera are
 * exclusive, a new one waits until the previous is fully closed, a snapshot
 * never preempts a live stream, and the peer connection is closed (and awaited)
 * before the signaling socket.
 */
const test = require("node:test");
const assert = require("node:assert");

const { _claimSession, _closePeer, closeAllSessions } = require("../src/devices/cameraStreamCapture");

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("a second session to the same camera waits until the first has released", async () => {
  const releaseA = await _claimSession("cam-1", "capture", async () => {});
  let gotB = false;
  const b = _claimSession("cam-1", "capture", async () => {}).then((r) => { gotB = true; return r; });
  await tick(50);
  assert.strictEqual(gotB, false, "must wait for the first session");
  releaseA();
  (await b)();
  assert.strictEqual(gotB, true);
});

test("sessions to different cameras don't block each other", async () => {
  const a = await _claimSession("cam-a", "stream", async () => {});
  const b = await _claimSession("cam-b", "stream", async () => {});
  a(); b();
});

test("a snapshot capture never preempts a live stream", async () => {
  let closed = false;
  const release = await _claimSession("cam-2", "stream", async () => { closed = true; });
  await assert.rejects(() => _claimSession("cam-2", "capture", async () => {}), /live stream/);
  assert.strictEqual(closed, false);
  release();
});

test("a stream closes whatever is open and waits for it to finish closing", async () => {
  const events = [];
  let releaseOld;
  releaseOld = await _claimSession("cam-3", "capture", async () => {
    events.push("closing old");
    await tick(30);
    events.push("old closed");
    releaseOld();
  });
  const releaseNew = await _claimSession("cam-3", "stream", async () => {});
  events.push("new claimed");
  assert.deepStrictEqual(events, ["closing old", "old closed", "new claimed"]);
  releaseNew();
});

test("the peer connection is closed and awaited before the signaling socket", async () => {
  const events = [];
  const pc = { close: async () => { events.push("pc closing"); await tick(20); events.push("pc closed"); } };
  const ws = { close: () => events.push("ws closed") };
  await _closePeer(pc, ws);
  assert.deepStrictEqual(events, ["pc closing", "pc closed", "ws closed"]);
});

test("a peer connection that never closes cannot hang the session forever", async () => {
  const pc = { close: () => new Promise(() => {}) };
  let wsClosed = false;
  const started = Date.now();
  await _closePeer(pc, { close: () => { wsClosed = true; } });
  assert.ok(wsClosed);
  assert.ok(Date.now() - started < 5000);
});

test("closeAllSessions closes every open session", async () => {
  const closed = [];
  let r1, r2;
  r1 = await _claimSession("cam-x", "stream", async () => { closed.push("x"); r1(); });
  r2 = await _claimSession("cam-y", "stream", async () => { closed.push("y"); r2(); });
  await closeAllSessions();
  assert.deepStrictEqual(closed.sort(), ["x", "y"]);
});
