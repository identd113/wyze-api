/**
 * Camera light/power routing and devicemgmt state parsing, mirroring
 * SecKatie/wyzeapy CameraService (floodlight_on/off, turn_on/off, update).
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");
const { WyzeAccessoryModels, DeviceModels } = require("../src/types");

const stub = () => {
  const calls = [];
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
  w._deviceMgmtRunAction = async (...a) => { calls.push(["devicemgmt", ...a]); };
  w.runAction = async (...a) => { calls.push(["runAction", ...a]); };
  w.setProperty = async (...a) => { calls.push(["setProperty", ...a]); };
  return { w, calls };
};

test("Pan v4 and Battery Cam Pro light uses the devicemgmt 'spotlight' capability", async () => {
  for (const model of ["HL_PAN4", "AN_RSCW"]) {
    const { w, calls } = stub();
    await w.cameraFloodLightOn("MAC", model);
    await w.cameraFloodLightOff("MAC", model);
    await w.cameraSpotLightOn("MAC", model);
    assert.deepStrictEqual(calls, [
      ["devicemgmt", "MAC", model, "spotlight", "1"],
      ["devicemgmt", "MAC", model, "spotlight", "0"],
      ["devicemgmt", "MAC", model, "spotlight", "1"],
    ], model);
  }
});

test("Floodlight Pro light still uses the devicemgmt 'floodlight' capability", async () => {
  const { w, calls } = stub();
  await w.cameraFloodLightOn("MAC", "LD_CFP");
  assert.deepStrictEqual(calls, [["devicemgmt", "MAC", "LD_CFP", "floodlight", "1"]]);
});

test("Pan v4 power and siren use the devicemgmt API", async () => {
  const { w, calls } = stub();
  await w.cameraTurnOn("MAC", "HL_PAN4");
  await w.cameraTurnOff("MAC", "HL_PAN4");
  await w.cameraSirenOn("MAC", "HL_PAN4");
  assert.deepStrictEqual(calls.map((c) => c.slice(3).join(":")), ["power:wakeup", "power:sleep", "siren:siren-on"]);
});

test("Bulb Cam light uses run_action, not set_property P1056", async () => {
  const { w, calls } = stub();
  await w.cameraFloodLightOn("MAC", "HL_BC");
  await w.cameraFloodLightOff("MAC", "HL_BC");
  assert.deepStrictEqual(calls, [
    ["runAction", "MAC", "HL_BC", "floodlight_on"],
    ["runAction", "MAC", "HL_BC", "floodlight_off"],
  ]);
});

test("raw-value entry points route the same way (what the homebridge plugin calls)", async () => {
  const { w, calls } = stub();
  await w.cameraSpotLight("MAC", "HL_PAN4", "1");
  await w.cameraFloodLight("MAC", "HL_BC", "2");
  await w.cameraFloodLight("MAC", "HL_CFL2", "1");
  assert.deepStrictEqual(calls, [
    ["devicemgmt", "MAC", "HL_PAN4", "spotlight", "1"],
    ["runAction", "MAC", "HL_BC", "floodlight_off"],
    ["setProperty", "MAC", "HL_CFL2", "P1056", "1"],
  ]);
});

test("Floodlight v2 (HL_CFL2) keeps the set_property P1056 path, as wyzeapy does", async () => {
  const { w, calls } = stub();
  await w.cameraFloodLightOn("MAC", "HL_CFL2");
  await w.cameraFloodLightOff("MAC", "HL_CFL2");
  assert.deepStrictEqual(calls.map((c) => c[0] + ":" + c[4]), ["setProperty:1", "setProperty:2"]);
});

test("new models are registered", () => {
  assert.strictEqual(WyzeAccessoryModels.CameraModels.WyzeCamPanv4, "HL_PAN4");
  assert.strictEqual(WyzeAccessoryModels.CameraModels.WyzeBulbCam, "HL_BC");
  assert.strictEqual(WyzeAccessoryModels.CameraModels.WyzeCamFloodlightV2, "HL_CFL2");
  for (const m of ["HL_PAN4", "HL_BC", "HL_CFL2"]) assert.ok(DeviceModels.CAMERA.includes(m), m);
  assert.ok(DeviceModels.CAMERA_DEVICEMGMT.includes("HL_PAN4"));
  assert.ok(!DeviceModels.CAMERA_DEVICEMGMT.includes("HL_CFL2"));
});

test("every devicemgmt model has a property list (needed for state reads)", () => {
  const props = require("../src/util/devicemgmtProps");
  for (const m of DeviceModels.CAMERA_DEVICEMGMT) assert.ok(Array.isArray(props[m]) && props[m].length, m);
});

test("devicemgmt state is parsed like wyzeapy's CameraService.update", () => {
  const { w } = stub();
  const state = w._deviceMgmtParseState({
    data: {
      capabilities: [
        { name: "camera", properties: { "motion-detect-recording": true } },
        { name: "spotlight", properties: { on: true } },
        { name: "siren", properties: { state: false } },
        { name: "iot-device", properties: { "push-switch": true, "iot-power": true, "iot-state": true } },
        { name: "wifi", properties: { ssid: "x" } },
      ],
    },
  });
  assert.deepStrictEqual(state, { motion: true, floodlight: true, siren: false, notify: true, on: true, available: true });
  assert.deepStrictEqual(w._deviceMgmtParseState(undefined), {});
});

test("devicemgmt state treats string/number flags as booleans (\"0\" is off)", () => {
  const { w } = stub();
  const state = w._deviceMgmtParseState({
    data: {
      capabilities: [
        { name: "siren", properties: { state: "0" } },
        { name: "spotlight", properties: { on: "1" } },
        { name: "iot-device", properties: { "push-switch": 0, "iot-power": 1 } },
      ],
    },
  });
  assert.deepStrictEqual(state, { siren: false, floodlight: true, notify: false, on: true, available: undefined });
});

test("cameraGetDeviceMgmtState posts the per-model property list and parses the reply", async () => {
  const axios = require("axios");
  const orig = axios.post;
  let posted;
  axios.post = async (url, payload, cfg) => {
    posted = { url, payload, cfg };
    return { data: { data: { capabilities: [{ name: "floodlight", properties: { on: true } }] } } };
  };
  try {
    const { w } = stub();
    w.maybeLogin = async () => {};
    w.access_token = "tok";
    const state = await w.cameraGetDeviceMgmtState("MAC", "HL_PAN4");
    assert.match(posted.url, /device-property\/get_iot_prop$/);
    assert.strictEqual(posted.payload.targetInfo.productModel, "HL_PAN4");
    assert.strictEqual(posted.payload.capabilities, require("../src/util/devicemgmtProps").HL_PAN4);
    assert.strictEqual(posted.cfg.headers.authorization, "tok");
    assert.deepStrictEqual(state, { floodlight: true });
  } finally {
    axios.post = orig;
  }
});

test("raw privacy/siren/notification entry points route devicemgmt cameras (what the plugin calls)", async () => {
  const { w, calls } = stub();
  w._deviceMgmtSetToggle = async (...a) => { calls.push(["toggle", a[1], a[3]]); };
  await w.cameraPrivacy("MAC", "HL_PAN4", "power_off");
  await w.cameraSiren("MAC", "HL_PAN4", "siren_on");
  await w.cameraNotifications("MAC", "HL_PAN4", "0");
  assert.deepStrictEqual(calls, [
    ["devicemgmt", "MAC", "HL_PAN4", "power", "sleep"],
    ["devicemgmt", "MAC", "HL_PAN4", "siren", "siren-on"],
    ["toggle", "HL_PAN4", "0"],
  ]);
});

test("raw entry points are unchanged for ordinary cameras", async () => {
  const { w, calls } = stub();
  await w.cameraPrivacy("MAC", "WYZE_CAKP2JFUS", "power_off");
  await w.cameraSiren("MAC", "WYZE_CAKP2JFUS", "siren_on");
  await w.cameraNotifications("MAC", "WYZE_CAKP2JFUS", "1");
  assert.deepStrictEqual(calls, [
    ["runAction", "MAC", "WYZE_CAKP2JFUS", "power_off"],
    ["runAction", "MAC", "WYZE_CAKP2JFUS", "siren_on"],
    ["setProperty", "MAC", "WYZE_CAKP2JFUS", "P1", "1"],
  ]);
});

test("the Doorbell v2 is the model that can't be powered off through the API", () => {
  const { w } = stub();
  assert.strictEqual(w.cameraSupportsPowerControl("HL_DB2"), false);
  assert.strictEqual(w.cameraSupportsPowerControl("WYZE_CAKP2JFUS"), true);
  assert.strictEqual(w.cameraSupportsPowerControl("HL_PAN4"), true);
  assert.ok(DeviceModels.CAMERA_NO_POWER_CONTROL.includes("HL_DB2"));
});
