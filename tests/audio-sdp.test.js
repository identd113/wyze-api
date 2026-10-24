/**
 * Wyze cameras answer PCMU/8000 under dynamic payload type 96; the SDP handed to
 * ffmpeg must name the payload type the camera really uses.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

const { extractAudioCodec, writeAudioSdpFile } = require("../src/devices/cameraStreamCapture");

const WYZE_ANSWER = [
  "v=0",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "a=rtpmap:96 H264/90000",
  "m=audio 9 UDP/TLS/RTP/SAVPF 96",
  "a=sendrecv",
  "a=rtpmap:96 PCMU/8000",
  "a=rtcp-fb:96 nack",
  "",
].join("\r\n");

test("extractAudioCodec reads PCMU on payload type 96 from a Wyze answer (not the video's rtpmap:96)", () => {
  assert.deepStrictEqual(extractAudioCodec(WYZE_ANSWER), { payloadType: 96, name: "PCMU", clockRate: 8000, channels: 1, fmtp: null });
});

test("extractAudioCodec handles Opus with fmtp, static payload types and no audio", () => {
  const opus = "m=audio 9 UDP/TLS/RTP/SAVPF 111 63\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n";
  assert.deepStrictEqual(extractAudioCodec(opus), { payloadType: 111, name: "opus", clockRate: 48000, channels: 2, fmtp: "minptime=10;useinbandfec=1" });
  assert.strictEqual(extractAudioCodec("m=audio 9 RTP/AVP 0\r\n").name, "PCMU");
  assert.strictEqual(extractAudioCodec("m=audio 9 RTP/AVP 8\r\n").name, "PCMA");
  assert.strictEqual(extractAudioCodec("m=video 9 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\n"), null);
  assert.strictEqual(extractAudioCodec(null), null);
});

test("writeAudioSdpFile declares the negotiated payload type, or both defaults without one", () => {
  const read = (p) => { const s = fs.readFileSync(p, "utf8"); fs.unlinkSync(p); return s; };
  const named = read(writeAudioSdpFile(5000, extractAudioCodec(WYZE_ANSWER)));
  assert.match(named, /m=audio 5000 RTP\/AVP 96\n/);
  assert.match(named, /a=rtpmap:96 PCMU\/8000\n/);
  assert.ok(!named.includes("111"));
  const fallback = read(writeAudioSdpFile(5000));
  assert.match(fallback, /RTP\/AVP 0 111/);
});
