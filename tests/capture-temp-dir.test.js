/**
 * The SDP files ffmpeg reads go inside the folder the host gave (persistPath), not the OS temp folder. A leftover
 * from a killed run is removed after an hour; a folder that cannot be made falls back to the OS temp folder.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const capture = require("../src/devices/cameraStreamCapture");

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "wyze-tmpdir-test-"));

test("the video and audio SDP files are written inside the folder the host gave", () => {
  const dir = path.join(scratch(), "tmp");
  capture.setTempDirectory(dir);
  try {
    const video = capture.writeSdpFile(5004, "AAAA,BBBB", 96);
    const audio = capture.writeAudioSdpFile(5006, "PCMU");
    for (const file of [video, audio]) {
      assert.strictEqual(path.dirname(file), dir);
      assert.ok(fs.existsSync(file));
      assert.match(fs.readFileSync(file, "utf8"), /^v=0/);
      fs.unlinkSync(file);
    }
  } finally {
    capture.setTempDirectory(null);
  }
});

test("a stale file from a killed run is removed, a fresh one and other files are kept", () => {
  const dir = scratch();
  const stale = path.join(dir, "wyze-capture-111-aaaaaaaa.sdp");
  const fresh = path.join(dir, "wyze-audio-222-bbbbbbbb.sdp");
  const other = path.join(dir, "keep-me.txt");
  for (const f of [stale, fresh, other]) fs.writeFileSync(f, "x");
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  fs.utimesSync(other, old, old);
  capture.setTempDirectory(dir);
  try {
    assert.ok(!fs.existsSync(stale));
    assert.ok(fs.existsSync(fresh));
    assert.ok(fs.existsSync(other), "only wyze SDP files are touched");
  } finally {
    capture.setTempDirectory(null);
  }
});

test("without a folder, or when it cannot be made, the OS temp folder is used", () => {
  capture.setTempDirectory(null);
  const a = capture.writeSdpFile(5004);
  assert.strictEqual(path.dirname(a), os.tmpdir());
  fs.unlinkSync(a);

  const blocker = path.join(scratch(), "a-file");
  fs.writeFileSync(blocker, "x");
  capture.setTempDirectory(path.join(blocker, "tmp")); // a folder under a file cannot be made
  try {
    const b = capture.writeSdpFile(5004);
    assert.strictEqual(path.dirname(b), os.tmpdir());
    fs.unlinkSync(b);
  } finally {
    capture.setTempDirectory(null);
  }
});

test("a client built with a persistPath uses a tmp folder inside it", () => {
  const WyzeAPI = require("../src/index");
  const persist = scratch();
  new WyzeAPI({ username: "u@example.com", password: "p", keyId: "k", apiKey: "a", persistPath: persist });
  try {
    const file = capture.writeSdpFile(5004);
    assert.strictEqual(path.dirname(file), path.join(persist, "tmp"));
    fs.unlinkSync(file);
  } finally {
    capture.setTempDirectory(null);
  }
});
