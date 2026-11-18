/**
 * What a camera appears to support, from what was read about it: the states, that a missing scan is not a "no", and
 * that nothing from the device itself (a value, an address) gets into the text.
 */
const test = require("node:test");
const assert = require("node:assert");

const { describeSupport } = require("../src/web/support");
const { supportSummary } = require("../src/web/issueLink");

const byKey = (support) => Object.fromEntries(support.features.map((f) => [f.key, f]));

const BACKYARD = {
  mac: "AABBCCDDEEFF", product_model: "WYZE_CAKP2JFUS", product_type: "Camera",
  device_params: { dtls: 1, ip: "10.0.0.9", p2p_id: "UID", dongle_product_model: "HL_CFL", audio_alarm_switch: 0 },
  enr: "enr",
};
const ENTRY = {
  propertyList: { P3: "1", P1049: "2", P1056: "2" },
  devicemgmt: { answered: true, capabilities: { floodlight: { on: true }, siren: { state: false }, wifi: { "signal-strength": 64 } } },
  capabilityDiscovery: { requests: 1, withValues: ["memory-card-management", "wifi"], accepted: { "memory-card-management": ["storage-status"], wifi: ["signal-strength"], "iot-device": ["iot-state"] }, rejected: [] },
};
const LOCAL = {
  authenticated: true, sessionForm: "CC51",
  answers: {
    K10040: { answer: { value: 3 } }, K10044: { answer: { value: 2 } },
    K10020: { answer: { 13: 1, 15: 2, 17: 1, 18: 1, 50: 2 } },
    K10720: { answer: { accessoriesInfo: { status: "1" } } }, K10448: { answer: null },
  },
};

test("a scanned camera with a local test shows what was read, as yes, with what showed it", () => {
  const f = byKey(describeSupport({ device: BACKYARD, entry: ENTRY, local: LOCAL }));
  for (const key of ["nightVision", "irLed", "floodlight", "siren", "motionDetection", "soundDetection", "alarmSounds", "sdCard", "wifiSignal"]) {
    assert.strictEqual(f[key].state, "yes", `${key}: ${JSON.stringify(f[key])}`);
    assert.ok(f[key].how.length > 5, `${key} says what shows it`);
  }
  assert.strictEqual(f.battery.state, "notSeen", "an unanswered battery read is not a yes");
  assert.strictEqual(f.doorbell.state, "notSeen");
  assert.match(f.siren.how, /P1049/);
});

test("with nothing scanned, the model and the device list give likely, and the rest is 'not scanned yet', not a no", () => {
  const support = describeSupport({ device: { product_model: "LD_CFP", product_type: "Camera", device_params: {} }, entry: null, local: null });
  const f = byKey(support);
  assert.strictEqual(f.floodlight.state, "likely");
  assert.strictEqual(f.nightVision.state, "notSeen");
  assert.match(f.siren.how, /not scanned yet/);
  assert.ok(support.notes.some((n) => /Nothing has been scanned yet/.test(n)));
  assert.ok(support.notes.some((n) => /not seen only means nothing read here shows it/.test(n)), "a missing item is never called absent");
  const dev = describeSupport({ device: { product_model: "HL_DB2", product_type: "Camera", device_params: { dtls: 1, ip: "10.0.0.2", p2p_id: "U" }, enr: "e", mac: "AA" } });
  assert.strictEqual(byKey(dev).doorbell.state, "likely");
  assert.strictEqual(byKey(dev).nightVision.state, "likely", "it could be asked over the network");
});

test("night vision says why it cannot be reached, and the checklist is only for cameras", () => {
  const f = byKey(describeSupport({ device: { product_model: "WL_SC3", product_type: "Common", device_params: {} }, entry: ENTRY }));
  assert.ok(!("floodlight" in f) || f.floodlight.state !== "notSeen", "a non-camera gets no camera checklist");
  assert.strictEqual(f.nightVision.state, "notSeen");
  assert.match(f.nightVision.how, /dtls/);
  assert.ok(!("irLed" in f));
});

test("devicemgmt groups the list does not name are shown as such, and a chime-like device with only info groups shows none", () => {
  const f = byKey(describeSupport({
    device: { product_model: "XX_NEW", product_type: "Common", device_params: {} },
    entry: { capabilityDiscovery: { accepted: { "device-info": ["a"], "iot-device": ["b"], battery: ["level"], "robot-arm": ["x"] }, withValues: [], rejected: [] } },
  }));
  assert.strictEqual(f.battery.state, "yes");
  assert.strictEqual(f["devicemgmt:robot-arm"].state, "yes");
  assert.ok(!("devicemgmt:device-info" in f) && !("devicemgmt:iot-device" in f), "the basics are not features");
});

test("the backends line lists what answered, and no value or address of the device is in any text", () => {
  const support = describeSupport({ device: BACKYARD, entry: ENTRY, local: LOCAL });
  assert.ok(support.backends.some((b) => /classic Wyze API \(3 properties\)/.test(b)));
  assert.ok(support.backends.some((b) => /devicemgmt/.test(b)));
  assert.ok(support.backends.some((b) => /1 of 5 reads|2 of 5|answered/.test(b)));
  const text = JSON.stringify(support);
  for (const secret of ["AABBCCDDEEFF", "10.0.0.9", "UID", "enr"]) assert.ok(!text.includes(secret), `no ${secret}`);
});

test("a link gets the names only: yes, likely and not seen", () => {
  const summary = supportSummary(describeSupport({ device: BACKYARD, entry: ENTRY, local: LOCAL }));
  assert.ok(summary.yes.includes("floodlight") && summary.notSeen.includes("doorbell"));
  assert.deepStrictEqual(Object.keys(summary), ["yes", "likely", "notSeen"]);
  assert.strictEqual(supportSummary(null), null);
  assert.strictEqual(supportSummary({}), null);
});
