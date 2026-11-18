/**
 * The prefilled GitHub issue link made from a camera test: what goes into it, what never does, and that
 * it stays short enough for GitHub.
 */
const test = require("node:test");
const assert = require("node:assert");

const { buildIssueUrl, buildDeviceIssueUrl, MAX_URL } = require("../src/web/issueLink");

const FORM = {
  url: "https://github.com/identd113/homebridge-wyze-smart-home/issues/new",
  template: "new-device.yml",
  origin: "camera-test-page",
  plugin: "2.0.0-beta.4 (wyze-api 2.0.0-beta.4)",
  kind: "Camera or doorbell",
  deviceLabel: (model) => (model === "HL_DB2" ? "Doorbells - Video Doorbell v2 (HL_DB2)" : undefined),
};
const CAMERA = { model: "HL_DB2", firmware: "4.51.3.6791" };
const RESULT = {
  reachable: true, sessionForm: "CC51", dtlsHandshake: true, avLogin: true, authenticated: true,
  answers: {
    K10040: { meaning: "night vision", answer: { bytes: 1, hex: "03", value: 3 } },
    K10448: { meaning: "battery usage", answer: null },
    K10030: { meaning: "status light", answer: { bytes: 1, hex: "01", value: 1 } },
  },
};
const params = (url) => new URL(url).searchParams;

test("the link carries the template, the device from the list, the version, the kind and where it came from", () => {
  const p = params(buildIssueUrl(FORM, CAMERA, null));
  assert.strictEqual(p.get("template"), "new-device.yml");
  assert.strictEqual(p.get("device"), "Doorbells - Video Doorbell v2 (HL_DB2)");
  assert.strictEqual(p.get("model"), null, "the model field is only for a device that is not in the list");
  assert.strictEqual(p.get("kind"), "Camera or doorbell");
  assert.strictEqual(p.get("plugin"), "2.0.0-beta.4 (wyze-api 2.0.0-beta.4)");
  assert.strictEqual(p.get("origin"), "camera-test-page");
  assert.strictEqual(p.get("blob"), null, "nothing about a test before there is one");
});

test("a model that is not in the form's list is given as the model code", () => {
  const p = params(buildIssueUrl(FORM, { model: "GW_NEW1", firmware: "1.0.0.1" }, null));
  assert.strictEqual(p.get("device"), null);
  assert.strictEqual(p.get("model"), "GW_NEW1");
});

test("a finished test fills in the device information as JSON that names the model, and a plain sentence", () => {
  const p = params(buildIssueUrl(FORM, CAMERA, RESULT));
  const blob = JSON.parse(p.get("blob"));
  assert.strictEqual(blob.product_model, "HL_DB2", "the form's check looks for the model code");
  assert.strictEqual(blob.firmware_ver, "4.51.3.6791");
  assert.deepStrictEqual(blob.camera_test_page, { reachable: true, sessionForm: "CC51", dtlsHandshake: true, avLogin: true, authenticated: true, answered: "2 of 3", nightVision: "auto" });
  assert.match(p.get("details"), /reached the camera \(CC51 form\).*authenticated; 2 of 3 read-only commands answered; night vision is auto\./);
});

test("a failed test says where it stopped", () => {
  const p = params(buildIssueUrl(FORM, CAMERA, { reachable: false, error: "timeout: no discovery reply from the camera (wrong IP, other VLAN or UDP blocked?)" }));
  assert.match(p.get("details"), /stopped: timeout: no discovery reply/);
  assert.strictEqual(JSON.parse(p.get("blob")).camera_test_page.authenticated, false);
});

test("nothing from the camera's own data can get in: only the fields above", () => {
  const sneaky = { ...RESULT, answers: { ...RESULT.answers, K10020: { meaning: "params", answer: { ssid: "HomeWifi", mac: "AABBCCDDEEFF", 1: 2 } } }, camera: { mac: "AABBCCDDEEFF" }, ip: "192.168.1.5" };
  const url = decodeURIComponent(buildIssueUrl(FORM, CAMERA, sneaky));
  for (const secret of ["HomeWifi", "AABBCCDDEEFF", "192.168.1.5"]) assert.ok(!url.includes(secret), `leaked ${secret}`);
});

test("no form, or a form that does not point at github.com, gives no link", () => {
  assert.strictEqual(buildIssueUrl(null, CAMERA, RESULT), null);
  assert.strictEqual(buildIssueUrl({ ...FORM, url: "https://evil.example.com/x" }, CAMERA, RESULT), null);
  assert.strictEqual(buildIssueUrl({ ...FORM, url: "http://github.com/x" }, CAMERA, RESULT), null);
  assert.strictEqual(buildIssueUrl({ ...FORM, url: "https://github.com.evil.example/x" }, CAMERA, RESULT), null);
});

test("a link that would be too long loses the sentence first, then the device information", () => {
  assert.ok(buildIssueUrl(FORM, CAMERA, { ...RESULT, error: "x".repeat(200) }).length <= MAX_URL);
  // somewhere between "everything fits" and "nothing fits" the sentence goes and the device information stays
  let sawSentenceDropped = false;
  for (let n = 4000; n <= 7000; n += 25) {
    const url = buildIssueUrl({ ...FORM, plugin: "p".repeat(n) }, CAMERA, RESULT);
    assert.ok(url.length <= MAX_URL || n > 6600, `length ${url.length} for ${n}`);
    const p = params(url);
    if (p.get("blob") && !p.get("details")) sawSentenceDropped = true;
    if (p.get("details")) assert.ok(p.get("blob"), "the sentence never stays without the device information");
  }
  assert.ok(sawSentenceDropped, "the sentence is dropped before the device information");
  const hugest = buildIssueUrl({ ...FORM, plugin: "p".repeat(6900) }, CAMERA, RESULT);
  assert.strictEqual(params(hugest).get("blob"), null, "then the device information");
});

test("a thermostat room sensor is a thermostat or room sensor, not a plain sensor", () => {
  const { kindOf } = require("../src/web/issueLink");
  assert.strictEqual(kindOf("ThermostatRoomSensor"), "Thermostat or room sensor");
  assert.strictEqual(kindOf("RoomSensor"), "Thermostat or room sensor");
  assert.strictEqual(kindOf("ContactSensor"), "Sensor (contact, motion, leak, climate)");
  assert.strictEqual(kindOf("Thermostat"), "Thermostat or room sensor");
});

test("a device's issue link carries which devicemgmt groups came back with a value, and which it rejected, even when the full report does not fit", () => {
  const discovery = { requests: 11, withValues: ["device-info", "iot-device", "wifi"], accepted: { "device-info": ["firmware-ver"], "iot-device": ["iot-state"], wifi: ["signal-strength"] }, rejected: ["camera", "camera-ai"] };
  const report = { propertyList: {}, deviceInfo: { data: {} }, capabilityDiscovery: discovery };
  const device = { model: "GW_CHI", type: "Common", firmware: "1.0.0.50" };
  const link = new URL(buildDeviceIssueUrl(FORM, device, report));
  assert.match(link.searchParams.get("details"), /devicemgmt has values for device-info, iot-device, wifi and rejected 2 groups/);
  assert.deepStrictEqual(JSON.parse(link.searchParams.get("blob")).device_report.capabilityDiscovery, discovery);

  // too long for a link: the short summary still names the groups
  const big = { ...report, propertyList: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`P${i}`, "x".repeat(20)])) };
  const short = new URL(buildDeviceIssueUrl(FORM, device, big));
  const summary = JSON.parse(short.searchParams.get("blob")).device_report;
  assert.deepStrictEqual(summary.devicemgmt_groups_with_values, ["device-info", "iot-device", "wifi"]);
  assert.deepStrictEqual(summary.devicemgmt_groups_rejected, ["camera", "camera-ai"]);
  assert.ok(short.toString().length <= MAX_URL);

  // a discovery that stopped on an error says nothing about the groups
  const stopped = new URL(buildDeviceIssueUrl(FORM, device, { ...report, capabilityDiscovery: { ...discovery, stopped: { httpStatus: 500 } } }));
  assert.ok(!/devicemgmt has values/.test(stopped.searchParams.get("details") || ""));
});

test("a report with a discovery in an older or odd shape does not break the link", () => {
  const device = { model: "GW_CHI", type: "Common", firmware: "1.0.0.50" };
  for (const capabilityDiscovery of [{ supported: { wifi: [] }, unsupported: ["camera"] }, {}, { withValues: "wifi", rejected: null }, null, "x"]) {
    const url = buildDeviceIssueUrl(FORM, device, { propertyList: {}, deviceInfo: { data: {} }, capabilityDiscovery });
    assert.ok(url && url.length <= MAX_URL, JSON.stringify(capabilityDiscovery));
    assert.ok(!/devicemgmt has values/.test(new URL(url).searchParams.get("details") || ""), "nothing is said about groups it cannot read");
  }
});
