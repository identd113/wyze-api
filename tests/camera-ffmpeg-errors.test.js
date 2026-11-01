/**
 * If ffmpeg cannot start at all (the binary is missing or not executable), the child process emits an 'error'
 * event. With no listener Node throws it, and that takes the whole host process down when anyone starts a stream.
 * The stream must end quietly with a logged reason instead.
 */
const test = require("node:test");
const assert = require("node:assert");

// The ffmpeg path is read when the camera helpers load, so replace it before anything requires them.
const capture = require("../src/devices/cameraStreamCapture");
capture.resolveFfmpegPath = () => "/nonexistent/wyze-api-test/ffmpeg";

const WyzeAPI = require("../src/index");

const forwarder = () => ({
  stop() {},
  audioCodec: null,
  spropParameterSets: null,
  videoPayloadType: 96,
  releaseVideo: () => ({ hadKeyframe: false }),
  audioSeen: () => true,
  marks: null,
});

test("when ffmpeg cannot start, the stream ends with a logged reason and the process survives", async () => {
  const crashes = [];
  const onCrash = (err) => crashes.push(err);
  process.on("uncaughtException", onCrash);
  try {
    const w = Object.create(WyzeAPI.prototype);
    w.cameraStartRtpForwarding = async () => forwarder();
    const lines = [];
    const logger = { error: (m) => lines.push(["error", m]), warn: (m) => lines.push(["warn", m]), info() {}, debug() {} };

    const handle = await w.startCameraHKStream("MAC", "HL_DB2", {
      localRtpPort: 1111, localAudioRtpPort: 2222, targetAddress: "127.0.0.1",
      videoPort: 3333, rtcpPort: 3334, srtpKey: Buffer.alloc(16), srtpSalt: Buffer.alloc(14), videoSsrc: 1,
      audioPort: 4444, audioRtcpPort: 4445, audioSrtpKey: Buffer.alloc(16), audioSrtpSalt: Buffer.alloc(14), audioSsrc: 2,
      logger,
    });
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the spawn failures be reported

    assert.deepStrictEqual(crashes.map((e) => e.message), [], "an unhandled 'error' event crashed the process");
    assert.strictEqual(handle.isAlive(), false, "a stream whose ffmpeg never started is not alive");
    const errors = lines.filter(([level]) => level === "error").map(([, message]) => message);
    assert.ok(errors.some((m) => /FFmpeg\/video could not start/.test(m)), `video reason missing: ${errors}`);
    assert.ok(errors.some((m) => /FFmpeg\/audio could not start/.test(m)), `audio reason missing: ${errors}`);
    // The audio process also reports that it exited, which is fine. What must not happen is a retry or a reconnect.
    assert.ok(!lines.some(([, m]) => /Restarting audio|FFmpeg\/video exited|reconnect/i.test(m)), "it must not try again with a binary that does not exist");
    handle.stop();
  } finally {
    process.off("uncaughtException", onCrash);
  }
});
