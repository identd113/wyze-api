/**
 * Local UDP ports for ffmpeg's RTP input: handed out once, and with room for the
 * RTCP port ffmpeg binds next to each.
 */
const test = require("node:test");
const assert = require("node:assert");

const { pickFreeUdpPort } = require("../src/devices/cameraStreamCapture");

test("concurrent picks are distinct and never adjacent (ffmpeg binds port+1 for RTCP)", async () => {
  const ports = await Promise.all(Array.from({ length: 40 }, () => pickFreeUdpPort()));
  assert.strictEqual(new Set(ports).size, ports.length);
  const sorted = [...ports].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i] - sorted[i - 1] > 1, `${sorted[i - 1]} and ${sorted[i]} are adjacent`);
});

test("the RTCP neighbour of a picked port is bindable", async () => {
  const dgram = require("dgram");
  const port = await pickFreeUdpPort();
  await new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    sock.once("error", reject);
    sock.bind(port + 1, "127.0.0.1", () => sock.close(resolve));
  });
});
