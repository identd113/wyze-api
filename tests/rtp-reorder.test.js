const test = require("node:test");
const assert = require("node:assert");
const { RtpReorderBuffer, seqDelta } = require("../src/devices/rtpReorderBuffer");

const pkt = (seq, ts, fill = 1, len = 160) => ({
  header: { sequenceNumber: seq, timestamp: ts, payloadType: 96, ssrc: 7 },
  payload: Buffer.alloc(len, fill),
});
const makePacket = (template, seq, ts, payload) => ({
  header: { ...template.header, sequenceNumber: seq, timestamp: ts },
  payload,
  synthetic: true,
});

function make(opts = {}) {
  const out = [];
  const buf = new RtpReorderBuffer({ send: (p) => out.push(p), makePacket, ...opts });
  return { buf, out, seqs: () => out.map((p) => p.header.sequenceNumber) };
}

test("in-order packets pass straight through with no delay", () => {
  const { buf, seqs } = make();
  buf.push(pkt(10, 0), 0);
  buf.push(pkt(11, 160), 20);
  buf.push(pkt(12, 320), 40);
  assert.deepStrictEqual(seqs(), [10, 11, 12]);
  assert.strictEqual(buf.waiting, false);
});

test("an out-of-order packet is held, then both are released in order", () => {
  const { buf, seqs } = make();
  buf.push(pkt(1, 0), 0);
  buf.push(pkt(3, 320), 40); // 2 is late
  assert.deepStrictEqual(seqs(), [1]);
  assert.strictEqual(buf.waiting, true);
  buf.push(pkt(2, 160), 50);
  assert.deepStrictEqual(seqs(), [1, 2, 3]);
  assert.strictEqual(buf.stats.reordered, 1);
  assert.strictEqual(buf.stats.concealed, 0);
});

test("a packet that never arrives is replaced by silence after maxWaitMs", () => {
  const { buf, out, seqs } = make({ maxWaitMs: 80 });
  buf.push(pkt(1, 0), 0);
  buf.push(pkt(3, 320), 40);
  buf.tick(100); // 60 ms waited, still holding
  assert.deepStrictEqual(seqs(), [1]);
  buf.tick(125); // 85 ms waited
  assert.deepStrictEqual(seqs(), [1, 2, 3]);
  const filler = out[1];
  assert.strictEqual(filler.synthetic, true);
  assert.strictEqual(filler.header.timestamp, 160);
  assert.ok(filler.payload.every((b) => b === 0xff), "mu-law silence");
  assert.strictEqual(filler.payload.length, 160);
  assert.strictEqual(buf.stats.concealed, 1);
});

test("a packet that arrives after its slot was filled is dropped", () => {
  const { buf, seqs } = make({ maxWaitMs: 50 });
  buf.push(pkt(1, 0), 0);
  buf.push(pkt(3, 320), 10);
  buf.tick(70);
  assert.deepStrictEqual(seqs(), [1, 2, 3]);
  buf.push(pkt(2, 160), 80);
  assert.deepStrictEqual(seqs(), [1, 2, 3]);
  assert.strictEqual(buf.stats.late, 1);
});

test("several missing packets in a row are each filled with consecutive timestamps", () => {
  const { buf, out } = make({ maxWaitMs: 40 });
  buf.push(pkt(1, 0), 0);
  buf.push(pkt(5, 640), 5);
  buf.tick(60);
  assert.deepStrictEqual(out.map((p) => p.header.sequenceNumber), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(out.map((p) => p.header.timestamp), [0, 160, 320, 480, 640]);
  assert.strictEqual(buf.stats.concealed, 3);
});

test("a very long gap is jumped over instead of filled with silence", () => {
  const { buf, seqs } = make({ maxWaitMs: 40, maxConceal: 5 });
  buf.push(pkt(1, 0), 0);
  buf.push(pkt(50, 7840), 5);
  buf.tick(60);
  assert.deepStrictEqual(seqs(), [1, 50]);
  assert.strictEqual(buf.stats.jumped, 1);
  assert.strictEqual(buf.stats.concealed, 0);
});

test("sequence numbers wrap around 65535 -> 0", () => {
  const { buf, seqs } = make();
  buf.push(pkt(65534, 0), 0);
  buf.push(pkt(0, 320), 5); // 65535 is late
  buf.push(pkt(65535, 160), 10);
  assert.deepStrictEqual(seqs(), [65534, 65535, 0]);
  assert.strictEqual(seqDelta(2, 65534), 4);
  assert.strictEqual(seqDelta(65534, 2), -4);
});

test("timestamps wrap for concealed packets", () => {
  const { buf, out } = make({ maxWaitMs: 10 });
  buf.push(pkt(1, 4294967200), 0);
  buf.push(pkt(3, 4294967200 + 320 - 4294967296), 1);
  buf.tick(30);
  assert.strictEqual(out[1].header.timestamp, (4294967200 + 160) % 4294967296);
});

test("duplicates are ignored and flush releases what is held in order", () => {
  const { buf, seqs } = make({ maxWaitMs: 1000 });
  buf.push(pkt(1, 0), 0);
  buf.push(pkt(4, 480), 1);
  buf.push(pkt(3, 320), 2);
  buf.push(pkt(3, 320), 3);
  assert.strictEqual(buf.stats.duplicate, 1);
  buf.flush();
  assert.deepStrictEqual(seqs(), [1, 3, 4]);
});

test("too many held packets forces the gap to be resolved", () => {
  const { buf, seqs } = make({ maxWaitMs: 100000, maxHeld: 3 });
  buf.push(pkt(1, 0), 0);
  buf.push(pkt(3, 320), 1);
  buf.push(pkt(4, 480), 2);
  buf.push(pkt(5, 640), 3); // third held packet hits the cap
  assert.deepStrictEqual(seqs(), [1, 2, 3, 4, 5]);
});
