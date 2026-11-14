/**
 * scripts/device-report.js: the report must stay read-only and must not carry
 * personal details.
 */
const test = require("node:test");
const assert = require("node:assert");

const { buildReport, scrub, readOnly, localSkipReason, READ_METHODS, DEVICEMGMT_FALLBACK_MODEL } = require("../src/deviceReport");
const WyzeAPI = require("../src/index");

const MAC = "AABBCCDDEEFF";
const DEVICES = [
  {
    mac: MAC, nickname: "Backyard", product_model: "HL_CFL2", product_type: "Camera", firmware_ver: "4.53.2.1",
    conn_state: 1, ssid: "HomeWifi", ip: "192.168.1.50", enr: "SECRETENR", sn: "SN123",
    device_params: { ip: "192.168.1.50", power_switch: 1, p2p_id: "ABCDEFGHIJKLMNOPQRST" },
  },
  { mac: "AABBCCDDEEFF", nickname: "Hall bulb", product_model: "WLPA19C", product_type: "MeshLight", firmware_ver: "1.0" },
];

function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    getDeviceList: async () => { calls.push("getDeviceList"); return DEVICES; },
    getPropertyList: async (mac) => { calls.push("getPropertyList"); return { property_list: [{ pid: "P1056", pvalue: "2" }, { pid: "P1066", pvalue: "63" }], mac }; },
    getDeviceInfo: async (mac) => { calls.push("getDeviceInfo"); return { device_info: { mac, nickname: "Backyard", note: `seen at 192.168.1.50 as ${MAC}` } }; },
    _deviceMgmtGetIotProp: async (mac, model, propsModel) => {
      calls.push(["_deviceMgmtGetIotProp", model, propsModel]);
      return { code: 1, data: { capabilities: [{ name: "floodlight", properties: { on: false } }] } };
    },
    setProperty: async () => { throw new Error("setProperty must not be called"); },
    runAction: async () => { throw new Error("runAction must not be called"); },
    ...overrides,
  };
  return { client, calls };
}

test("report lists devices as device-N and keeps the model, firmware and properties", async () => {
  const { client } = fakeClient();
  const report = await buildReport({ client, versions: { "wyze-api": "x" } });
  assert.deepStrictEqual(report.devices.map((d) => [d.label, d.model]), [["device-1", "HL_CFL2"], ["device-2", "WLPA19C"]]);
  assert.strictEqual(report.devices[0].firmware, "4.53.2.1");
  assert.deepStrictEqual(report.devices[0].propertyList, { P1056: "2", P1066: "63" });
  assert.deepStrictEqual(report.versions, { "wyze-api": "x" });
});

test("a camera with no list of its own is asked with the Floodlight Pro list", async () => {
  const { client, calls } = fakeClient();
  const report = await buildReport({ client, routing: { devicemgmt: () => false } });
  assert.ok(calls.some((c) => Array.isArray(c) && c[1] === "HL_CFL2" && c[2] === DEVICEMGMT_FALLBACK_MODEL));
  assert.strictEqual(report.devices[0].devicemgmt.propertyListUsed, DEVICEMGMT_FALLBACK_MODEL);
  assert.deepStrictEqual(report.devices[0].devicemgmt.capabilities, { floodlight: { on: false } });
  assert.strictEqual(report.devices[1].devicemgmt, undefined, "non-camera devices are not asked");
});

test("--model limits the devices and names models that were not found", async () => {
  const { client } = fakeClient();
  const report = await buildReport({ client, models: ["hl_cfl2", "NOPE_X"] });
  assert.strictEqual(report.devices.length, 1);
  assert.deepStrictEqual(report.noDeviceWithModel, ["NOPE_X"]);
});

test("no MAC, name, IP, Wi-Fi name or account value survives in the report", async () => {
  const { client } = fakeClient();
  const text = JSON.stringify(await buildReport({ client }));
  for (const secret of [MAC, "AABBCCDDEEFF", "Backyard", "Hall bulb", "HomeWifi", "192.168.1.50", "SECRETENR", "SN123"]) {
    assert.ok(!text.includes(secret), `${secret} leaked into the report`);
  }
});

test("a failing call is recorded, with its status, and does not stop the report", async () => {
  const { client } = fakeClient({
    getPropertyList: async () => { throw Object.assign(new Error(`bad for ${MAC}`), { response: { status: 403, data: { msg: "no" } } }); },
  });
  const report = await buildReport({ client });
  assert.strictEqual(report.devices[0].propertyList.httpStatus, 403);
  assert.ok(!JSON.stringify(report).includes(MAC));
  assert.strictEqual(report.devices.length, 2);
});

test("only the read methods can be reached", async () => {
  const { client } = fakeClient();
  const view = readOnly(client);
  for (const name of READ_METHODS) assert.strictEqual(typeof view[name], "function", name);
  for (const name of ["setProperty", "runAction", "setPropertyList", "logout", "_deviceMgmtRunAction"]) {
    assert.throws(() => view[name], /may only call/, name);
  }
});

test("scrub keeps version numbers that look like an IPv4 address, and still hides real IPs", () => {
  const out = scrub({ firmware_ver: "4.53.2.1", mcu_ver: "1.0.0.12", note: "at 192.168.1.5 and 300.1.1.1" });
  assert.strictEqual(out.firmware_ver, "4.53.2.1");
  assert.strictEqual(out.mcu_ver, "1.0.0.12");
  assert.strictEqual(out.note, "at <ip> and 300.1.1.1");
});

test("scrub removes private keys and rewrites MACs and IPs inside strings", () => {
  const out = scrub({ keep: "ok", mac: "x", nested: [{ nickname: "n", text: `a 00:11:22:33:44:55 b ${MAC} c 10.0.0.9 d WYZE_CAKP2JFUS_${MAC}` }] });
  assert.deepStrictEqual(out, { keep: "ok", nested: [{ text: "a <mac> b <mac> c <ip> d WYZE_CAKP2JFUS_<mac>" }] });
});

test("_deviceMgmtGetIotProp can use another model's property list but names the real model", async () => {
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info() {}, debug() {}, warn() {}, error() {} };
  w.maybeLogin = async () => {};
  await assert.rejects(() => w._deviceMgmtGetIotProp("MAC", "HL_CFL2"), /no property list for model HL_CFL2/);
  await assert.rejects(() => w._deviceMgmtGetIotProp("MAC", "HL_CFL2", "NOT_A_MODEL"), /no property list for model NOT_A_MODEL/);
});

test("values from the device list are removed wherever they turn up, even when they are not 12-hex MACs", async () => {
  const devices = [{ mac: "AB12CD34", nickname: "Chime", product_model: "GW_CHI", product_type: "Common", device_params: { p2p_id: "AB12CD34" } }];
  const { client } = fakeClient({
    getDeviceList: async () => devices,
    getDeviceInfo: async () => ({ data: { p2p_id: "AB12CD34", thumbnails: { thumbnails_url: "https://x/AB12CD34/img?sig=abc" }, note: "id is AB12CD34" } }),
  });
  const text = JSON.stringify(await buildReport({ client }));
  assert.ok(!text.includes("AB12CD34"), "id leaked");
  assert.ok(!text.includes("sig=abc"), "URL leaked");
  assert.ok(text.includes("<id>"));
});

test("property values are scrubbed too", async () => {
  const { flattenProperties } = require("../src/deviceReport");
  const out = flattenProperties({ property_list: [{ pid: "P1", pvalue: "10.0.0.9" }, { pid: "P2", pvalue: "2" }] }, []);
  assert.deepStrictEqual(out, { P1: "<ip>", P2: "2" });
});

// ---- --local: the read-only TUTK probe ----

const LOCAL_CAMERA = {
  ...DEVICES[0],
  device_params: { ...DEVICES[0].device_params, dtls: 1 },
};

test("without a probe the report has no local section", async () => {
  const { client } = fakeClient();
  const report = await buildReport({ client });
  assert.strictEqual(report.devices[0].local, undefined);
});

test("the probe is called for a camera with the dtls flag, with its keys, and only for cameras", async () => {
  const { client } = fakeClient({ getDeviceList: async () => [LOCAL_CAMERA, DEVICES[1]] });
  const seen = [];
  const report = await buildReport({
    client,
    localProbe: async (camera) => { seen.push(camera); return { reachable: true, authenticated: true }; },
  });
  assert.strictEqual(seen.length, 1, "the bulb is not probed");
  assert.deepStrictEqual(Object.keys(seen[0]).sort(), ["enr", "host", "mac", "model", "uid"]);
  assert.strictEqual(seen[0].host, "192.168.1.50");
  assert.deepStrictEqual(report.devices[0].local, { reachable: true, authenticated: true });
  assert.strictEqual(report.devices[1].local, undefined);
});

test("what the probe returns is scrubbed like the rest of the report", async () => {
  const { client } = fakeClient({ getDeviceList: async () => [LOCAL_CAMERA] });
  const report = await buildReport({
    client,
    localProbe: async () => ({
      camera: { firmware: "4.53.2.1" },
      note: `reached 192.168.1.50 as ${MAC} (Backyard) with SECRETENR`,
      answers: { K10040: { answer: { bytes: 1, hex: "03", value: 3 } } },
    }),
  });
  const text = JSON.stringify(report);
  for (const secret of [MAC, "192.168.1.50", "SECRETENR", "Backyard", "ABCDEFGHIJKLMNOPQRST"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.strictEqual(report.devices[0].local.camera.firmware, "4.53.2.1", "a firmware version is kept");
  assert.strictEqual(report.devices[0].local.answers.K10040.answer.value, 3);
});

test("a probe that throws is recorded, and a camera that cannot be probed says why", async () => {
  const noDtls = { ...DEVICES[0], device_params: { ...DEVICES[0].device_params } };
  const { client } = fakeClient({ getDeviceList: async () => [LOCAL_CAMERA, noDtls] });
  let calls = 0;
  const report = await buildReport({ client, localProbe: async () => { calls++; throw new Error(`no answer from 192.168.1.50`); } });
  assert.strictEqual(calls, 1, "the camera without the dtls flag is not probed");
  assert.match(report.devices[0].local.error, /no answer from <(id|ip)>/); // the camera's own address is a known value, so it shows as <id>
  assert.match(report.devices[1].local.skipped, /dtls/);
  assert.match(localSkipReason({ device_params: { dtls: 1 } }), /IP address/);
  assert.match(localSkipReason({ device_params: { dtls: 1, ip: "10.0.0.2" } }), /missing a key or id/);
  assert.strictEqual(localSkipReason(LOCAL_CAMERA), "");
});

test("the TUTK probe can only send get commands", () => {
  const { DEFAULT_PROBE_CODES, READ_ONLY_COMMANDS } = require("../src/tutk/client");
  const messages = require("../future/tutk/lib/messages");
  const names = Object.keys(messages).filter((n) => /^K\d+/.test(n));
  for (const code of Object.keys(READ_ONLY_COMMANDS).map(Number)) {
    const matching = names.filter((n) => n.startsWith(`K${code}`));
    assert.ok(matching.length > 0, `K${code} has no message class`);
    // every class that shares the code must be a get or a check; a set, format, take-photo, reset or start must not
    for (const name of matching) assert.ok(/^K\d+(Get|Check)/.test(name), `${name} is not a get command`);
  }
  for (const code of DEFAULT_PROBE_CODES) assert.ok(READ_ONLY_COMMANDS[code], `K${code} is probed but not in the read-only list`);
});
