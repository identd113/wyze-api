/**
 * A Wyze camera serves one WebRTC viewer at a time. Sessions to a camera are
 * exclusive, a new one waits until the previous is fully closed, a snapshot
 * never preempts a live stream, and the peer connection is closed (and awaited)
 * before the signaling socket.
 */
const test = require("node:test");
const assert = require("node:assert");

const { _claimSession, _closePeer, _makeTimeout, closeAllSessions } = require("../src/devices/cameraStreamCapture");

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

test("two waiters woken by the same release never hold the camera at once", async () => {
  const releaseA = await _claimSession("cam-race", "capture", async () => {});
  let holders = 0;
  let maxHolders = 0;
  const waiter = async () => {
    const release = await _claimSession("cam-race", "capture", async () => {});
    holders += 1;
    maxHolders = Math.max(maxHolders, holders);
    await tick(20);
    holders -= 1;
    release();
  };
  const both = Promise.all([waiter(), waiter()]);
  await tick(10);
  releaseA();
  await both;
  assert.strictEqual(maxHolders, 1);
});

test("an aborted timeout rejects at once, a cleared one never fires, and neither is an unhandled rejection", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const aborted = _makeTimeout(10_000, "late");
    aborted.abort(new Error("stopped"));
    await assert.rejects(aborted.promise, /stopped/);

    const cleared = _makeTimeout(20, "should not fire");
    cleared.clear();
    let settled = false;
    cleared.promise.then(() => { settled = true; }, () => { settled = true; });
    await tick(60);
    assert.strictEqual(settled, false);

    const expired = _makeTimeout(10, "expired"); // nobody awaits it
    await tick(50);
    assert.deepStrictEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("closing a peer connection twice only closes it once", async () => {
  let closes = 0;
  const pc = { close: async () => { closes += 1; } };
  await _closePeer(pc, null);
  await _closePeer(pc, { close () {} });
  assert.strictEqual(closes, 1);
});
