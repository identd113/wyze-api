/**
 * scripts/device-report.js: the report must stay read-only and must not carry
 * personal details.
 */
const test = require("node:test");
const assert = require("node:assert");

const { buildReport, scrub, readOnly, localSkipReason, READ_METHODS, DEVICEMGMT_FALLBACK_MODEL, DISCOVERY_GROUPS, discoverCapabilities } = require("../src/deviceReport");
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

test("each section of the report says which endpoint it came from, and the paths are the ones the client calls", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { ENDPOINTS } = require("../src/deviceReport");
  const source = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  assert.ok(source.includes('"app/v2/device/get_property_list"') && ENDPOINTS.propertyList.endsWith("/app/v2/device/get_property_list"));
  assert.ok(source.includes('"app/v2/device/get_device_Info"') && ENDPOINTS.deviceInfo.endsWith("/app/v2/device/get_device_Info"));
  const devicemgmt = fs.readFileSync(path.join(__dirname, "../src/services/devicemgmt.js"), "utf8");
  assert.ok(devicemgmt.includes("/device-management/api/device-property/get_iot_prop") && ENDPOINTS.devicemgmt.endsWith("/device-management/api/device-property/get_iot_prop"));
  assert.match(ENDPOINTS.propertyList, /^POST https:\/\/api\.wyzecam\.com\//);
  assert.match(ENDPOINTS.devicemgmt, /^POST https:\/\/devicemgmt-service-beta\.wyze\.com\//);
});

test("the report records the endpoint of each answer: the cloud calls for every device, devicemgmt for a camera (and, with discovery, for every device), and the local session when asked", async () => {
  const { client } = fakeClient();
  const report = await buildReport({ client, routing: { devicemgmt: () => true }, localProbe: async () => ({ authenticated: true, answers: {} }) });
  const [camera, bulb] = report.devices;
  assert.deepStrictEqual(Object.keys(bulb.endpoints), ["propertyList", "deviceInfo"]);
  assert.match(bulb.endpoints.propertyList, /^POST https:\/\/api\.wyzecam\.com\/app\/v2\/device\/get_property_list$/);
  assert.ok(camera.endpoints.devicemgmt.includes("get_iot_prop"));
  assert.ok(camera.endpoints.local.includes("32761"), "a local session notes its port, and that it is not a cloud call");
});

test("serial numbers, uuids, home and group ids, owner and address parts are removed from a report", () => {
  const out = scrub({ serial_number: "SN123456789", serial: "ABC", uuid: "0f0f0f0f-aaaa", home_id: "h-77", group_id: "g-77", parent_id: "p-77", owner_name: "Sam", city: "Springfield", zip: "55555", firmware_ver: "1.2.3.4", power: 1 });
  assert.deepStrictEqual(Object.values(out).filter((v) => typeof v === "string" && /SN123|ABC|0f0f|h-77|g-77|p-77|Sam|Springfield|55555/.test(v)), []);
  assert.strictEqual(out.firmware_ver, "1.2.3.4", "a firmware version is kept");
  assert.strictEqual(out.power, 1);
});

// ---- capability discovery ----

const reject = (group) => Object.assign(new Error("Request failed with status code 400"), {
  response: { status: 400, statusText: "Bad Request", data: { code: 1001, message: JSON.stringify({ code: 1001, message: `unsupported capability ${group}` }) } },
});
const answer = (groups) => ({ code: 1, data: { capabilities: groups.map((g) => ({ iid: g.iid, name: g.name, properties: Object.fromEntries(g.properties.map((p) => [p, p === "iot-state" ? true : null])) })) } });

test("discovery leaves out each group the device lacks, as the rejections name them, until the answer comes back whole", async () => {
  const lacks = new Set(["camera", "camera-ai"]);
  const asked = [];
  const { client } = fakeClient({
    _deviceMgmtGetIotProp: async (mac, model, propsModel, groups) => {
      asked.push(groups.map((g) => g.name));
      const missing = groups.find((g) => lacks.has(g.name));
      if (missing) throw reject(missing.name);
      return answer(groups);
    },
  });
  const [chime] = (await buildReport({ client: { ...client, getDeviceList: async () => [DEVICES[1]] }, discovery: true, discoveryPauseMs: 0 })).devices;
  const found = chime.capabilityDiscovery;
  assert.deepStrictEqual(found.rejected, ["camera", "camera-ai"]);
  assert.strictEqual(found.requests, 3);
  assert.ok(!Object.keys(found.accepted).some((g) => lacks.has(g)));
  assert.ok("iot-device" in found.accepted && "wifi" in found.accepted);
  assert.deepStrictEqual(found.accepted["iot-device"], ["iot-state"], "only the properties that have a value, by name");
  assert.deepStrictEqual(found.withValues, ["iot-device"], "an accepted group with no value is not listed as one the device has");
  assert.ok(asked[0].length > asked[2].length, "each ask is smaller");
  assert.strictEqual(chime.endpoints.devicemgmt.includes("get_iot_prop"), true);
});

test("discovery is off unless asked for; when asked it runs for every device, not only cameras", async () => {
  const { client } = fakeClient({ _deviceMgmtGetIotProp: async (m, mo, p, groups) => answer(groups) });
  const off = await buildReport({ client });
  assert.ok(off.devices.every((d) => !("capabilityDiscovery" in d)), "no discovery by default");
  const on = await buildReport({ client, discovery: true });
  assert.ok(on.devices.every((d) => d.capabilityDiscovery && d.capabilityDiscovery.requests === 1));
});

test("discovery gives up on an answer it cannot read, and records it, instead of looping", async () => {
  let n = 0;
  const { client } = fakeClient({ _deviceMgmtGetIotProp: async () => { n += 1; throw Object.assign(new Error("boom"), { response: { status: 500, data: { message: "server error" } } }); } });
  const found = await discoverCapabilities(client, DEVICES[1], [], 0);
  assert.strictEqual(n, 1);
  assert.strictEqual(found.stopped.httpStatus, 500);
  assert.deepStrictEqual(found.accepted, {});
  // a rejection that names a group we did not ask about does not loop either
  n = 0;
  const odd = fakeClient({ _deviceMgmtGetIotProp: async () => { n += 1; throw reject("not-a-group"); } }).client;
  const stopped = await discoverCapabilities(odd, DEVICES[1], [], 0);
  assert.strictEqual(n, 1);
  assert.ok(stopped.stopped);
});

test("discovery asks for every group in all our devicemgmt lists, once each, and never sends a value", async () => {
  assert.ok(["camera", "device-info", "iot-device", "wifi", "floodlight", "spotlight", "battery", "solar-panel"].every((g) => DISCOVERY_GROUPS.some((x) => x.name === g)));
  assert.strictEqual(new Set(DISCOVERY_GROUPS.map((g) => g.name)).size, DISCOVERY_GROUPS.length);
  const sent = [];
  const { client } = fakeClient({ _deviceMgmtGetIotProp: async (m, mo, p, groups) => { sent.push(groups); return answer(groups); } });
  await discoverCapabilities(client, DEVICES[1], [], 0);
  assert.ok(sent[0].every((g) => Array.isArray(g.properties) && g.properties.every((x) => typeof x === "string")), "names only");
});

test("a rejection while discovering is logged as debug, not as an error", async () => {
  const w = Object.create(WyzeAPI.prototype);
  const lines = { error: [], debug: [] };
  w.log = { error: (m) => lines.error.push(m), debug: (m) => lines.debug.push(m), info() {}, warn() {} };
  w.maybeLogin = async () => {};
  w.access_token = "t";
  const axios = require("axios");
  const original = axios.post;
  axios.post = async () => { throw reject("camera"); };
  try {
    await assert.rejects(() => w._deviceMgmtGetIotProp("AABBCCDDEEFF", "GW_CHI", "LD_CFP", DISCOVERY_GROUPS));
    assert.deepStrictEqual(lines.error, []);
    assert.ok(lines.debug.some((m) => m.includes("get_iot_prop")));
    await assert.rejects(() => w._deviceMgmtGetIotProp("AABBCCDDEEFF", "GW_CHI", "LD_CFP"));
    assert.ok(lines.error.length > 0, "an ordinary call still logs the failure as an error");
  } finally {
    axios.post = original;
  }
});

test("Wyze's per-request trace ids are removed from a report", () => {
  const out = scrub({ code: "1", traceId: "d8c45c142b8e791112d47a7be51c65e4", request_id: "9de4ded6-4769160", data: { traceId: "aaaa" } });
  assert.deepStrictEqual(out, { code: "1", data: {} });
});

test("discovery waits between the asks for one device, not before the first, and reports its reads once per device", async () => {
  const lacks = new Set(["camera", "camera-ai"]);
  const stamps = [];
  const { client } = fakeClient({
    _deviceMgmtGetIotProp: async (mac, model, propsModel, groups) => {
      stamps.push(Date.now());
      const missing = groups.find((g) => lacks.has(g.name));
      if (missing) throw reject(missing.name);
      return answer(groups);
    },
  });
  const told = [];
  const started = Date.now();
  await buildReport({ client: { ...client, getDeviceList: async () => [DEVICES[1]] }, discovery: true, discoveryPauseMs: 40, onDiscovery: (i) => told.push(i) });
  assert.strictEqual(stamps.length, 3);
  assert.ok(stamps[1] - stamps[0] >= 35 && stamps[2] - stamps[1] >= 35, "a pause before each repeat ask");
  assert.ok(stamps[0] - started < 35, "none before the first");
  assert.deepStrictEqual(told, [{ model: "WLPA19C", requests: 3, rejected: 2 }]);
  // no discovery, no report of reads
  const none = [];
  await buildReport({ client, onDiscovery: (i) => none.push(i) });
  assert.deepStrictEqual(none, []);
});
