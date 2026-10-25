/**
 * Pure helpers on the WyzeAPI prototype — no network, no auth.
 */
const test = require("node:test");
const assert = require("node:assert");
const WyzeAPI = require("../src/index");

const stub = () => Object.create(WyzeAPI.prototype);

test("cameraIsOnline", async (t) => {
  const w = stub();

  await t.test("conn_state takes priority", () => {
    assert.strictEqual(w.cameraIsOnline({ conn_state: 1 }), true);
    assert.strictEqual(w.cameraIsOnline({ conn_state: 0 }), false);
    // device_params.status is ignored when conn_state is present
    assert.strictEqual(
      w.cameraIsOnline({ conn_state: 1, device_params: { status: 0 } }),
      true
    );
  });

  await t.test("device_params.status fallback when no conn_state", () => {
    assert.strictEqual(w.cameraIsOnline({ device_params: { status: 1 } }), true);
    assert.strictEqual(w.cameraIsOnline({ device_params: { status: 0 } }), false);
  });

  await t.test("is_online final fallback", () => {
    assert.strictEqual(w.cameraIsOnline({ is_online: true }), true);
    assert.strictEqual(w.cameraIsOnline({ is_online: false }), false);
  });

  await t.test("returns false for empty / null / undefined", () => {
    assert.strictEqual(w.cameraIsOnline({}), false);
    assert.strictEqual(w.cameraIsOnline(null), false);
    assert.strictEqual(w.cameraIsOnline(undefined), false);
  });
});

test("cameraGetThumbnail", async (t) => {
  const w = stub();

  await t.test("returns first thumbnail URL", () => {
    assert.strictEqual(
      w.cameraGetThumbnail({
        device_params: { camera_thumbnails: [{ url: "https://a" }, { url: "https://b" }] },
      }),
      "https://a"
    );
  });

  await t.test("returns null when no thumbnails", () => {
    assert.strictEqual(w.cameraGetThumbnail({ device_params: {} }), null);
    assert.strictEqual(
      w.cameraGetThumbnail({ device_params: { camera_thumbnails: [] } }),
      null
    );
    assert.strictEqual(w.cameraGetThumbnail({}), null);
    assert.strictEqual(w.cameraGetThumbnail(null), null);
  });
});

test("cameraGetSnapshot returns full thumbnail object", () => {
  const w = stub();
  const thumb = { url: "https://x", ts: 1700000000, type: 1 };
  assert.deepStrictEqual(
    w.cameraGetSnapshot({ device_params: { camera_thumbnails: [thumb] } }),
    thumb
  );
  assert.strictEqual(w.cameraGetSnapshot({}), null);
});

test("cameraToSummary builds correct shape", () => {
  const w = stub();
  const device = {
    mac: "AA:BB:CC",
    product_model: "WYZE_CAKP",
    nickname: "Front",
    conn_state: 1,
    device_params: {
      camera_thumbnails: [{ url: "https://thumb" }],
    },
  };
  assert.deepStrictEqual(w.cameraToSummary(device), {
    mac: "AA:BB:CC",
    productModel: "WYZE_CAKP",
    nickname: "Front",
    online: true,
    thumbnail: "https://thumb",
  });
});

test("device-info accessors", async (t) => {
  const w = stub();
  const camera = {
    firmware_ver: "4.50.4.182",
    timezone_name: "America/New_York",
    device_params: {
      signal_strength: 67,
      ip: "192.168.1.5",
      last_login_time: 1700000000000,
    },
  };

  await t.test("cameraGetSignalStrength", () => {
    assert.strictEqual(w.cameraGetSignalStrength(camera), 67);
    assert.strictEqual(w.cameraGetSignalStrength({}), null);
    assert.strictEqual(w.cameraGetSignalStrength(null), null);
  });

  await t.test("cameraGetIp", () => {
    assert.strictEqual(w.cameraGetIp(camera), "192.168.1.5");
    assert.strictEqual(w.cameraGetIp({}), null);
  });

  await t.test("cameraGetFirmware reads top-level field", () => {
    assert.strictEqual(w.cameraGetFirmware(camera), "4.50.4.182");
    assert.strictEqual(w.cameraGetFirmware({}), null);
  });

  await t.test("cameraGetTimezone reads top-level field", () => {
    assert.strictEqual(w.cameraGetTimezone(camera), "America/New_York");
    assert.strictEqual(w.cameraGetTimezone({}), null);
  });

  await t.test("cameraGetLastSeen returns Date or null", () => {
    const d = w.cameraGetLastSeen(camera);
    assert.ok(d instanceof Date);
    assert.strictEqual(d.getTime(), 1700000000000);
    assert.strictEqual(w.cameraGetLastSeen({}), null);
    assert.strictEqual(
      w.cameraGetLastSeen({ device_params: { last_login_time: "not a number" } }),
      null
    );
  });
});

test("each stream (re)connect attempt uses fresh local ports, not the pre-picked ones", async () => {
  const WyzeAPI = require("../src/index");
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
  const used = [];
  w.cameraStartRtpForwarding = async (mac, model, rtpPort, options) => {
    used.push([rtpPort, options.localAudioRtpPort]);
    throw new Error("stop here"); // we only care which ports the attempt asked for
  };
  await assert.rejects(() => w.startCameraHKStream("MAC", "HL_DB2", {
    localRtpPort: 1111,
    localAudioRtpPort: 2222,
    targetAddress: "127.0.0.1",
    videoPort: 3333,
    rtcpPort: 3334,
    srtpKey: Buffer.alloc(16),
    srtpSalt: Buffer.alloc(14),
    videoSsrc: 1,
  }), /stop here/);
  assert.strictEqual(used.length, 1);
  assert.notStrictEqual(used[0][0], 1111);
  assert.notStrictEqual(used[0][1], 2222);
  assert.ok(used[0][0] > 1024 && used[0][1] > 1024);
  assert.ok(Math.abs(used[0][0] - used[0][1]) > 1, "video and audio ports must not be adjacent");
});

test("a failed reconnect is retried with a growing delay until one succeeds", async () => {
  const WyzeAPI = require("../src/index");
  const w = Object.create(WyzeAPI.prototype);
  const budget = { retries: 0 };
  const delays = [];
  let calls = 0;
  const ok = await w._streamReconnect({
    budget, max: 4, isStopped: () => false,
    sleep: async (ms) => { delays.push(ms); },
    attempt: async () => { calls += 1; if (calls < 3) throw new Error("negotiation timed out"); },
  });
  assert.strictEqual(ok, true);
  assert.strictEqual(calls, 3);
  assert.deepStrictEqual(delays, [1000, 2000, 3000]);
  assert.strictEqual(budget.retries, 3);
});

test("reconnecting gives up when the budget is spent, and stops when the stream is stopped", async () => {
  const WyzeAPI = require("../src/index");
  const w = Object.create(WyzeAPI.prototype);
  let calls = 0;
  const fail = async () => { calls += 1; throw new Error("no answer"); };
  const spent = await w._streamReconnect({ budget: { retries: 0 }, max: 3, isStopped: () => false, sleep: async () => {}, attempt: fail });
  assert.strictEqual(spent, false);
  assert.strictEqual(calls, 3);

  calls = 0;
  let stopped = false;
  const stoppedMidway = await w._streamReconnect({
    budget: { retries: 0 }, max: 4, isStopped: () => stopped,
    sleep: async () => { stopped = true; }, // the stream is stopped while we wait
    attempt: fail,
  });
  assert.strictEqual(stoppedMidway, false);
  assert.strictEqual(calls, 0, "must not start another session after a stop");
});
