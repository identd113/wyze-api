/**
 * Wyze Cam Doorbell v2 (HL_DB2): registered as a camera, and its stream info is
 * usable even though it doesn't report the iot-power property.
 */
const test = require("node:test");
const assert = require("node:assert");
const axios = require("axios");

const WyzeAPI = require("../src/index");
const { WyzeAccessoryModels, DeviceModels } = require("../src/types");

const stub = () => {
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
  w.maybeLogin = async () => {};
  w._checkRateLimit = async () => {};
  w.access_token = "tok";
  return w;
};

const withStreamReply = async (entry, fn) => {
  const orig = axios.post;
  axios.post = async () => ({ headers: {}, data: { code: "1", data: [entry] } });
  try { return await fn(); } finally { axios.post = orig; }
};

const SECRET_URL = "wss://example.invalid/?X-Amz-Signature=SECRET";

test("HL_DB2 is registered as a camera (not a devicemgmt camera)", () => {
  assert.strictEqual(WyzeAccessoryModels.CameraModels.WyzeCamDoorbellV2, "HL_DB2");
  assert.ok(DeviceModels.CAMERA.includes("HL_DB2"));
  assert.ok(!DeviceModels.CAMERA_DEVICEMGMT.includes("HL_DB2"));
});

test("stream info is returned when iot-power is not reported (Doorbell v2)", async () => {
  const entry = { property: { "iot-device::iot-state": 1 }, params: { signaling_url: SECRET_URL, auth_token: "t", ice_servers: [] } };
  const params = await withStreamReply(entry, () => stub().cameraGetStreamInfo("MAC", "HL_DB2"));
  assert.strictEqual(params.signaling_url, SECRET_URL);
});

test("an explicit iot-power of 0 still means the camera is off, and the error hides the stream credentials", async () => {
  const entry = { property: { "iot-device::iot-state": 1, "iot-device::iot-power": 0 }, params: { signaling_url: SECRET_URL, auth_token: "SECRET-TOKEN" } };
  await withStreamReply(entry, async () => {
    await assert.rejects(() => stub().cameraGetStreamInfo("MAC", "HL_DB2"), (err) => {
      assert.match(err.message, /Camera is off/);
      assert.ok(!err.message.includes("SECRET"), err.message);
      return true;
    });
  });
});

test("an offline camera without a signaling URL is reported offline without leaking the entry", async () => {
  const entry = { property: { "iot-device::iot-state": 0 }, params: { auth_token: "SECRET-TOKEN" } };
  await withStreamReply(entry, async () => {
    await assert.rejects(() => stub().cameraGetStreamInfo("MAC", "WYZE_CAKP2JFUS"), (err) => {
      assert.match(err.message, /offline/);
      assert.ok(!err.message.includes("SECRET"), err.message);
      return true;
    });
  });
});
