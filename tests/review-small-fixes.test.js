/**
 * Smaller findings from the review of the merge into 2.0.0, each with the class of mistake it stands for:
 *   - a value that is not one of the expected ones must not turn into a default action (camera off),
 *   - a time from Wyze may be in seconds or milliseconds,
 *   - a URL from Wyze's cloud is checked before it is fetched, and so is every redirect,
 *   - credentials fetched ahead of use do not stay in memory.
 */
const test = require("node:test");
const assert = require("node:assert");
const axios = require("axios");

const WyzeAPI = require("../src/index");
const { isSafeThumbnailUrl } = require("../src/util/network");

const quietLog = { info() {}, error() {}, warn() {}, warning() {}, debug() {} };

// ---- cameraPrivacy ----

test("cameraPrivacy on a devicemgmt camera: power_on and power_off, and anything else is an error, not 'off'", async () => {
  const w = Object.create(WyzeAPI.prototype);
  w.log = quietLog;
  const calls = [];
  w.cameraUsesDeviceMgmt = () => true;
  w.cameraTurnOn = async () => calls.push("on");
  w.cameraTurnOff = async () => calls.push("off");
  await w.cameraPrivacy("AA", "HL_PAN4", "power_on");
  await w.cameraPrivacy("AA", "HL_PAN4", "power_off");
  for (const value of ["1", "", undefined, null, "POWER_ON", "restart", 1]) {
    await assert.rejects(() => w.cameraPrivacy("AA", "HL_PAN4", value), /takes "power_on" or "power_off"/, String(value));
  }
  assert.deepStrictEqual(calls, ["on", "off"], "a wrong value switched nothing");
});

// ---- Cam Plus expiry units ----

test("a Cam Plus plan whose expiry is in seconds is not taken for expired, and one in milliseconds still works", async () => {
  const w = Object.create(WyzeAPI.prototype);
  w.log = quietLog;
  const future = Date.now() + 30 * 86400000;
  const past = Date.now() - 86400000;
  w.getPlanBindingListByUser = async () => ({
    data: [
      { pid: "a", service_status: "ACTIVE", expired_date: Math.floor(future / 1000) },
      { pid: "b", service_status: "ACTIVE", expired_date: future },
      { pid: "c", service_status: "ACTIVE", expired_date: Math.floor(past / 1000) },
      { pid: "d", service_status: "ACTIVE", expired_date: past },
      { pid: "e", service_status: "EXPIRED", expired_date: future },
      { pid: "f", service_status: "ACTIVE" },
    ],
  });
  const plans = await w.getCamPlusPlans();
  assert.deepStrictEqual(plans.map((p) => [p.pid, p.active]), [["a", true], ["b", true], ["c", false], ["d", false], ["e", false], ["f", false]]);
  assert.strictEqual(plans[0].expires, Math.floor(future / 1000) * 1000, "expires is always milliseconds");
  assert.strictEqual(plans[5].expires, null);
});

// ---- thumbnail URL ----

test("isSafeThumbnailUrl: https to a public host, nothing that reaches inside the network", () => {
  for (const ok of ["https://s3.amazonaws.com/b/pic.jpg", "https://cdn.example.com/x?y=1", "https://8.8.8.8/x"]) assert.ok(isSafeThumbnailUrl(ok), ok);
  for (const no of [
    "http://cdn.example.com/x", "ftp://cdn.example.com/x", "file:///etc/passwd", "https://localhost/x", "https://127.0.0.1/x",
    "https://10.0.0.5/x", "https://192.168.1.1/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://[fd00::1]/x",
    "https://printer/x", "https://nas.local/x", "https://svc.internal/x", "not a url", "", null, undefined,
  ]) assert.ok(!isSafeThumbnailUrl(no), String(no));
});

test("a cloud thumbnail at an address that is not public is never fetched, and a redirect is checked too", async () => {
  const api = new WyzeAPI({ username: "u", password: "p", keyId: "k", apiKey: "a", logLevel: "error" });
  api.log = quietLog;
  api.cameraCaptureSnapshot = async () => Buffer.from("live");
  const fetched = [];
  const real = axios.get;
  axios.get = async (url, config) => { fetched.push({ url, config }); return { data: Buffer.from("pic") }; };
  try {
    api.getCameraSnapshot = async () => ({ url: "http://169.254.169.254/latest/meta-data" });
    const refused = await api.getCameraSnapshotImage("AA", { deviceModel: "X" });
    assert.strictEqual(fetched.length, 0, "nothing was fetched");
    assert.strictEqual(refused.source, "capture", "it fell back to a live capture");

    api.getCameraSnapshot = async () => ({ url: "https://cdn.example.com/p.jpg" });
    const ok = await api.getCameraSnapshotImage("AA", { deviceModel: "X" });
    assert.strictEqual(ok.source, "cloud");
    const { config } = fetched[0];
    assert.ok(config.maxRedirects <= 3, "redirects are limited");
    assert.throws(() => config.beforeRedirect({ href: "https://127.0.0.1/x" }), /not a public https one/);
    assert.throws(() => config.beforeRedirect({ href: "http://cdn.example.com/x" }), /not a public https one/);
    assert.doesNotThrow(() => config.beforeRedirect({ href: "https://other.example.com/x" }));
  } finally {
    axios.get = real;
  }
});

// ---- prefetched camera credentials ----

test("camera connection details fetched ahead of use are dropped when nobody takes them", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const w = Object.create(WyzeAPI.prototype);
  w.getCameraWebRTCConnectionInfo = async () => ({ secret: "stream-credentials" });
  w.prefetchCameraConnection("AA", "HL_CAM4");
  assert.strictEqual(w._prefetchedConn.size, 1);
  t.mock.timers.tick(30_000);
  assert.strictEqual(w._prefetchedConn.size, 1, "still there while they can be taken");
  t.mock.timers.tick(2_000);
  assert.strictEqual(w._prefetchedConn.size, 0, "gone once too old to be taken");
});

test("camera connection details that are taken are used once", async () => {
  const w = Object.create(WyzeAPI.prototype);
  w.getCameraWebRTCConnectionInfo = async () => ({ secret: "x" });
  w.prefetchCameraConnection("AA", "HL_CAM4");
  assert.ok(w._takePrefetchedConnection("AA", "HL_CAM4"));
  assert.strictEqual(w._takePrefetchedConnection("AA", "HL_CAM4"), null);
});
