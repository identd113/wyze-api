const test = require("node:test");
const assert = require("node:assert");
const { summarizeAudioSection } = require("../src/devices/cameraStreamCapture");

const sdp = (audio) =>
  ["v=0", "m=video 9 UDP/TLS/RTP/SAVPF 98", "a=sendonly", "a=ice-pwd:secretvalue", audio].join("\r\n");

test("reports port, direction and attribute names only", () => {
  const out = summarizeAudioSection(
    sdp("m=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 PCMU/8000\r\na=sendonly\r\na=ice-pwd:secretvalue\r\na=mid:1")
  );
  assert.strictEqual(out, "port=9 direction=sendonly attributes=rtpmap,ice-pwd,mid");
  assert.ok(!out.includes("secretvalue"));
});

test("a rejected audio section shows port 0", () => {
  assert.match(summarizeAudioSection(sdp("m=audio 0 UDP/TLS/RTP/SAVPF 96\r\na=inactive")), /port=0 direction=inactive/);
});

test("no audio section gives null", () => {
  assert.strictEqual(summarizeAudioSection("v=0\r\nm=video 9 RTP/AVP 96"), null);
  assert.strictEqual(summarizeAudioSection(null), null);
});
