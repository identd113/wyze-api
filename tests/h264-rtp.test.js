const test = require("node:test");
const assert = require("node:assert");
const cap = require("../src/devices/cameraStreamCapture");
const { VideoHold } = require("../src/devices/videoHold");

const rtp = (payload, { seq = 100, ts = 9000, ssrc = 0x01020304, pt = 96, marker = 0, extension = false, padding = 0 } = {}) => {
  const head = Buffer.alloc(12);
  head[0] = 0x80 | (extension ? 0x10 : 0) | (padding ? 0x20 : 0);
  head[1] = (marker ? 0x80 : 0) | pt;
  head.writeUInt16BE(seq, 2);
  head.writeUInt32BE(ts, 4);
  head.writeUInt32BE(ssrc, 8);
  const parts = [head];
  if (extension) parts.push(Buffer.from([0xbe, 0xde, 0x00, 0x01, 1, 2, 3, 4]));
  parts.push(payload);
  if (padding) parts.push(Buffer.concat([Buffer.alloc(padding - 1), Buffer.from([padding])]));
  return Buffer.concat(parts);
};
const SPS = Buffer.from([0x67, 1, 2, 3]);
const PPS = Buffer.from([0x68, 4, 5]);
const IDR = Buffer.from([0x65, 9, 9, 9, 9]);
const stapa = (...nals) => Buffer.concat([Buffer.from([0x18]), ...nals.flatMap((n) => [Buffer.from([n.length >> 8, n.length & 0xff]), n])]);
const fu = (type, start, end, data) => Buffer.concat([Buffer.from([0x7c, (start ? 0x80 : 0) | (end ? 0x40 : 0) | type]), data]);

test("rtpStartsKeyframe sees an SPS, an IDR, an aggregate holding one, and a fragmented IDR start", () => {
  assert.strictEqual(cap.rtpStartsKeyframe(SPS), true);
  assert.strictEqual(cap.rtpStartsKeyframe(IDR), true);
  assert.strictEqual(cap.rtpStartsKeyframe(stapa(SPS, PPS)), true);
  assert.strictEqual(cap.rtpStartsKeyframe(fu(5, true, false, Buffer.from([1]))), true, "first fragment of an IDR");
  assert.strictEqual(cap.rtpStartsKeyframe(fu(5, false, false, Buffer.from([1]))), false, "a later fragment is not a start");
  assert.strictEqual(cap.rtpStartsKeyframe(fu(1, true, false, Buffer.from([1]))), false, "a P slice");
  assert.strictEqual(cap.rtpStartsKeyframe(Buffer.from([0x41, 1, 2])), false);
  assert.strictEqual(cap.rtpStartsKeyframe(stapa(PPS)), false, "a PPS alone does not start a keyframe");
  assert.strictEqual(cap.rtpStartsKeyframe(null), false);
});

test("rtpHasParameterSets finds an SPS alone or inside an aggregate", () => {
  assert.strictEqual(cap.rtpHasParameterSets(SPS), true);
  assert.strictEqual(cap.rtpHasParameterSets(stapa(SPS, PPS)), true);
  assert.strictEqual(cap.rtpHasParameterSets(IDR), false);
  assert.strictEqual(cap.rtpHasParameterSets(fu(5, true, false, Buffer.from([1]))), false);
});

test("rtpPayload skips the header, an extension and padding", () => {
  assert.deepStrictEqual([...cap.rtpPayload(rtp(IDR))], [...IDR]);
  assert.deepStrictEqual([...cap.rtpPayload(rtp(IDR, { extension: true }))], [...IDR]);
  assert.deepStrictEqual([...cap.rtpPayload(rtp(IDR, { padding: 3 }))], [...IDR]);
  assert.strictEqual(cap.rtpPayload(Buffer.alloc(5)), null);
});

test("annexBFromRtpPackets joins single NALs, aggregates and fragments, parameter sets first", () => {
  const big = Buffer.from([0x65, 1, 2, 3, 4, 5, 6]); // an IDR NAL split into three fragments
  const out = cap.annexBFromRtpPackets(
    [
      rtp(stapa(SPS, PPS)),
      rtp(fu(5, true, false, big.subarray(1, 3))),
      rtp(fu(5, false, false, big.subarray(3, 5))),
      rtp(fu(5, false, true, big.subarray(5))),
      rtp(Buffer.from([0x41, 7, 7])),
    ],
    `${Buffer.from([0x67, 0xaa]).toString("base64")},${Buffer.from([0x68, 0xbb]).toString("base64")}`
  );
  const sc = Buffer.from([0, 0, 0, 1]);
  assert.ok(out.equals(Buffer.concat([sc, Buffer.from([0x67, 0xaa]), sc, Buffer.from([0x68, 0xbb]), sc, SPS, sc, PPS, sc, big, sc, Buffer.from([0x41, 7, 7])])));
});

test("buildParameterSetPacket makes a packet that comes just before the keyframe", () => {
  const first = rtp(fu(5, true, false, Buffer.from([1])), { seq: 500, ts: 123456, ssrc: 0xdeadbeef, pt: 97 });
  const sprop = `${SPS.toString("base64")},${PPS.toString("base64")}`;
  const p = cap.buildParameterSetPacket(first, sprop);
  assert.strictEqual(p.readUInt16BE(2), 499);
  assert.strictEqual(p.readUInt32BE(4), 123456);
  assert.strictEqual(p.readUInt32BE(8), 0xdeadbeef);
  assert.strictEqual(p[1] & 0x7f, 97);
  assert.strictEqual(p[1] & 0x80, 0, "no marker");
  assert.strictEqual(cap.rtpHasParameterSets(cap.rtpPayload(p)), true);
  assert.strictEqual(cap.rtpStartsKeyframe(cap.rtpPayload(p)), true);
  assert.strictEqual(cap.buildParameterSetPacket(first, "x"), null, "needs both an SPS and a PPS");
  const wrap = cap.buildParameterSetPacket(rtp(IDR, { seq: 0 }), sprop);
  assert.strictEqual(wrap.readUInt16BE(2), 65535, "the sequence number wraps");
});

test("a released hold puts the parameter sets in front when the keyframe has none", () => {
  const sent = [];
  const sprop = `${SPS.toString("base64")},${PPS.toString("base64")}`;
  const prefix = (first) => (cap.rtpHasParameterSets(cap.rtpPayload(first)) ? null : cap.buildParameterSetPacket(first, sprop));
  const hold = new VideoHold({ send: (p) => sent.push(p), prefix });
  const idr = rtp(fu(5, true, true, Buffer.from([1])), { seq: 10 });
  hold.push(idr, true);
  hold.release();
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0].readUInt16BE(2), 9);
  assert.ok(sent[1].equals(idr));

  const sent2 = [];
  const hold2 = new VideoHold({ send: (p) => sent2.push(p), prefix });
  const withSps = rtp(stapa(SPS, PPS), { seq: 20 });
  hold2.push(withSps, true);
  hold2.release();
  assert.strictEqual(sent2.length, 1, "nothing is added when the keyframe brings its own");
});

// ---- a real keyframe through the real ffmpeg --------------------------------------

const dgram = require("node:dgram");
const { spawnSync, spawn } = require("node:child_process");

async function syntheticStream() {
  const ffmpeg = cap.resolveFfmpegPath();
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  if (!/libx264/.test(probe.stdout || "")) return null;
  const port = await cap.pickFreeUdpPort();
  const sock = dgram.createSocket("udp4");
  const packets = [];
  sock.on("message", (m) => packets.push(Buffer.from(m)));
  await new Promise((r) => sock.bind(port, "127.0.0.1", r));
  const run = spawn(ffmpeg, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=15", "-t", "2",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-g", "15", "-f", "rtp", `rtp://127.0.0.1:${port}?pkt_size=1200`]);
  await new Promise((r) => run.on("close", r));
  await new Promise((r) => setTimeout(r, 200));
  sock.close();
  const frames = [];
  for (const p of packets) {
    const ts = p.readUInt32BE(4);
    if (!frames.length || frames[frames.length - 1].ts !== ts) frames.push({ ts, packets: [] });
    frames[frames.length - 1].packets.push(p);
  }
  return frames;
}

test("decodeKeyframe turns the packets of a real keyframe into a JPEG", async (t) => {
  const frames = await syntheticStream();
  if (!frames) return t.skip("this ffmpeg has no libx264");
  assert.strictEqual(cap.rtpStartsKeyframe(cap.rtpPayload(frames[0].packets[0])), true);
  assert.strictEqual(cap.rtpStartsKeyframe(cap.rtpPayload(frames[1].packets[0])), false);
  const later = frames[15]; // the second keyframe (a keyframe every 15 frames)
  assert.strictEqual(cap.rtpStartsKeyframe(cap.rtpPayload(later.packets[0])), true);
  const jpeg = await cap.decodeKeyframe({ packets: later.packets });
  assert.strictEqual(jpeg[0], 0xff);
  assert.strictEqual(jpeg[1], 0xd8);
  assert.ok(jpeg.length > 1000);
});

test("decodeKeyframe says so when there is nothing to decode", async () => {
  await assert.rejects(() => cap.decodeKeyframe({ packets: [] }), /no keyframe/);
  await assert.rejects(() => cap.decodeKeyframe({ packets: [Buffer.alloc(3)] }), /no keyframe/);
});
