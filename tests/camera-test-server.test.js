/**
 * The browser test page: the port rules, who may reach it, and what its routes do. The camera calls are
 * replaced by stand-ins, so nothing here touches a network.
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { createCameraTestServer, validateWebPort, isPrivateAddress, isAllowedHost } = require("../src/web/cameraTestServer");
const WyzeAPI = require("../src/index");

const MAC = "AABBCCDDEEFF";
const CAMERAS = [
  { mac: MAC, nickname: "Front Doorbell", product_model: "HL_DB2", product_type: "Camera", firmware_ver: "4.51.3.6791", enr: "SECRETENRSECRET16", device_params: { ip: "192.168.1.50", p2p_id: "ABCDEFGHIJKLMNOPQRST", dtls: 1 } },
  { mac: "AABBCCDDEE02", nickname: "Old Cam", product_model: "WYZEC1", product_type: "Camera", firmware_ver: "3.9.1", enr: "ANOTHERENRSECRET1", device_params: { ip: "192.168.1.51", p2p_id: "TSRQPONMLKJIHGFEDCBA" } },
  { mac: "112233445566", nickname: "Hall bulb", product_model: "WLPA19C", product_type: "MeshLight", firmware_ver: "1.0" },
];

async function start(overrides = {}) {
  const calls = { probe: [], night: [] };
  const server = createCameraTestServer({
    client: { getDeviceList: async () => CAMERAS },
    ephemeral: true,
    host: "127.0.0.1",
    token: "test-token-1234",
    probe: async (target) => {
      calls.probe.push(target);
      target.onStep("reachable");
      target.onStep("K10040");
      return { reachable: true, sessionForm: "CC51", dtlsHandshake: true, avLogin: true, authenticated: true, answers: { K10040: { meaning: "night vision", answer: { bytes: 1, hex: "03", value: 3 } } } };
    },
    setNightVision: async (target) => { calls.night.push(target); return { before: "auto", after: target.value, matches: true }; },
    ...overrides,
  });
  const { port } = await server.start();
  return { server, port, calls };
}

function request(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

const auth = { "x-test-token": "test-token-1234" };
const json = { ...auth, "content-type": "application/json" };

test("the port: 0 or unset is off, 1 to 1023 is refused, 1024 to 65535 is accepted", () => {
  for (const off of [undefined, null, "", 0, "0"]) assert.deepStrictEqual(validateWebPort(off), { enabled: false });
  for (const low of [1, 80, 443, 1023, "22"]) assert.match(validateWebPort(low).error, /below 1024.*root/, String(low));
  assert.deepStrictEqual(validateWebPort(1024), { enabled: true, port: 1024 });
  assert.deepStrictEqual(validateWebPort("8099"), { enabled: true, port: 8099 });
  assert.deepStrictEqual(validateWebPort(65535), { enabled: true, port: 65535 });
  for (const bad of [65536, -1, 80.5, "abc", "80x", "1e3", true, {}]) assert.ok(validateWebPort(bad).error, String(bad));
  assert.throws(() => createCameraTestServer({ client: { getDeviceList: async () => [] }, port: 80 }), /below 1024/);
  assert.throws(() => createCameraTestServer({ client: { getDeviceList: async () => [] }, port: 0 }), /off/);
});

test("the library exports the page and the port check", () => {
  assert.strictEqual(typeof WyzeAPI.createCameraTestServer, "function");
  assert.strictEqual(WyzeAPI.validateWebPort(8099).port, 8099);
});

test("only private and loopback addresses are served, and only sensible Host headers", () => {
  for (const ok of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.9", "169.254.1.1", "::1", "fd12:3456::1", "fe80::1", "::ffff:192.168.1.9"]) assert.ok(isPrivateAddress(ok), ok);
  for (const no of ["8.8.8.8", "172.32.0.1", "11.0.0.1", "2001:db8::1", "", undefined, "::ffff:8.8.8.8"]) assert.ok(!isPrivateAddress(no), String(no));
  for (const ok of ["192.168.1.9:8099", "localhost:8099", "macmini.local", "macmini:8099", "[::1]:8099", "10.0.0.5"]) assert.ok(isAllowedHost(ok), ok);
  for (const no of ["evil.example.com", "evil.example.com:8099", "a.b", "", undefined]) assert.ok(!isAllowedHost(no), String(no));
});

test("the page needs the token and is sent with a nonce policy", async () => {
  const { server, port } = await start();
  try {
    assert.strictEqual((await request(port, { path: "/" })).status, 401);
    assert.strictEqual((await request(port, { path: "/?token=wrong" })).status, 401);
    const res = await request(port, { path: "/?token=test-token-1234" });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    const nonce = /script-src 'nonce-([^']+)'/.exec(res.headers["content-security-policy"])[1];
    assert.ok(res.text.includes(`nonce="${nonce}"`), "the page carries the same nonce");
    assert.ok(!res.text.includes("__NONCE__"));
    assert.strictEqual(res.headers["cache-control"], "no-store");
    assert.ok(!res.text.includes("test-token-1234"), "the token is never written into the page");
  } finally { await server.stop(); }
});

test("the sidebar links to the project home and shows the versions it was given", async () => {
  const { server, port } = await start({ versions: { plugin: "2.0.0-beta.4", "wyze-api": "<2.1.0>" } });
  try {
    const res = await request(port, { path: "/?token=test-token-1234" });
    assert.match(res.headers["content-security-policy"], /img-src data:/, "the embedded logo is allowed, nothing else");
    assert.ok(res.text.includes('href="https://github.com/wyze-smart-home/homebridge-wyze-smart-home"'), "project home link");
    assert.ok(res.text.includes('href="https://github.com/wyze-smart-home/homebridge-wyze-smart-home/issues/new/choose"'), "issue link");
    assert.ok(res.text.includes("plugin 2.0.0-beta.4 · wyze-api &lt;2.1.0&gt;"), "versions are shown and escaped");
    assert.ok(!/__(PROJECT_HOME|VERSIONS|NONCE)__/.test(res.text), "no placeholder is left behind");
    assert.ok(/rel="noopener noreferrer"/.test(res.text));
  } finally { await server.stop(); }
});

test("the camera list carries names and models but no address, id or key", async () => {
  const { server, port } = await start();
  try {
    assert.strictEqual((await request(port, { path: "/api/cameras" })).status, 401);
    const res = await request(port, { path: "/api/cameras", headers: auth });
    assert.strictEqual(res.status, 200);
    const { cameras } = JSON.parse(res.text);
    assert.deepStrictEqual(cameras.map((c) => [c.id, c.name, c.model, !!c.reason]), [["cam-1", "Front Doorbell", "HL_DB2", false], ["cam-2", "Old Cam", "WYZEC1", true]]);
    for (const secret of [MAC, "192.168.1.50", "SECRETENR", "ABCDEFGHIJKLMNOPQRST"]) assert.ok(!res.text.includes(secret), `leaked ${secret}`);
  } finally { await server.stop(); }
});

test("a proxy header, a foreign Host, or a foreign origin is refused even with the token", async () => {
  const { server, port } = await start();
  try {
    assert.strictEqual((await request(port, { path: "/api/cameras", headers: { ...auth, "x-forwarded-for": "1.2.3.4" } })).status, 403);
    assert.strictEqual((await request(port, { path: "/api/cameras", headers: { ...auth, "cf-connecting-ip": "1.2.3.4" } })).status, 403);
    assert.strictEqual((await request(port, { path: "/api/cameras", headers: { ...auth, host: "evil.example.com" } })).status, 403);
    assert.strictEqual((await request(port, { path: "/api/cameras", headers: { ...auth, origin: "http://evil.example.com" } })).status, 403);
    assert.strictEqual((await request(port, { path: "/api/cameras", headers: { ...auth, "sec-fetch-site": "cross-site" } })).status, 403);
    assert.strictEqual((await request(port, { path: "/api/cameras", headers: { ...auth, "sec-fetch-site": "same-origin" } })).status, 200);
  } finally { await server.stop(); }
});

test("a test streams its steps and result, and the probe gets the camera's keys", async () => {
  const { server, port, calls } = await start();
  try {
    const res = await request(port, { method: "POST", path: "/api/cameras/cam-1/test", headers: auth });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers["content-type"], /ndjson/);
    const lines = res.text.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepStrictEqual(lines.map((l) => l.event), ["step", "step", "done"]);
    assert.strictEqual(lines[2].result.authenticated, true);
    assert.strictEqual(calls.probe.length, 1);
    assert.strictEqual(calls.probe[0].host, "192.168.1.50");
    assert.strictEqual(calls.probe[0].uid, "ABCDEFGHIJKLMNOPQRST");
    assert.strictEqual(calls.probe[0].mac, MAC);
    assert.ok(!res.text.includes("SECRETENR") && !res.text.includes("192.168.1.50"), "nothing private in the stream");
  } finally { await server.stop(); }
});

test("a camera that cannot be tested, or does not exist, is answered and not probed", async () => {
  const { server, port, calls } = await start();
  try {
    const old = await request(port, { method: "POST", path: "/api/cameras/cam-2/test", headers: auth });
    assert.strictEqual(old.status, 422);
    assert.match(JSON.parse(old.text).error, /dtls/);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/cameras/cam-9/test", headers: auth })).status, 404);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/cameras/cam-3/test", headers: auth })).status, 404, "the bulb is not a camera");
    assert.strictEqual(calls.probe.length, 0);
  } finally { await server.stop(); }
});

test("night vision is only changed with confirm: true, a good value and JSON", async () => {
  const { server, port, calls } = await start();
  try {
    const path = "/api/cameras/cam-1/night-vision";
    assert.strictEqual((await request(port, { method: "POST", path, headers: auth, body: "{}" })).status, 415, "needs a JSON content type");
    assert.strictEqual((await request(port, { method: "POST", path, headers: json, body: { value: "off" } })).status, 400, "no confirm");
    assert.strictEqual((await request(port, { method: "POST", path, headers: json, body: { value: "off", confirm: "yes" } })).status, 400, "confirm must be true");
    assert.strictEqual((await request(port, { method: "POST", path, headers: json, body: { value: "dim", confirm: true } })).status, 400, "bad value");
    assert.strictEqual((await request(port, { method: "POST", path, headers: json, body: "{not json" })).status, 400);
    assert.strictEqual(calls.night.length, 0, "nothing was changed so far");
    const ok = await request(port, { method: "POST", path, headers: json, body: { value: "off", confirm: true } });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(JSON.parse(ok.text), { before: "auto", after: "off", matches: true });
    assert.strictEqual(calls.night.length, 1);
    assert.strictEqual(calls.night[0].value, "off");
    assert.strictEqual(calls.night[0].host, "192.168.1.50");
  } finally { await server.stop(); }
});

test("only one test or change runs at a time", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { server, port } = await start({ probe: async () => { await gate; return { authenticated: true }; } });
  try {
    const first = request(port, { method: "POST", path: "/api/cameras/cam-1/test", headers: auth });
    await new Promise((r) => setTimeout(r, 100));
    const second = await request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body: { value: "on", confirm: true } });
    assert.strictEqual(second.status, 409);
    release();
    assert.strictEqual((await first).status, 200);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body: { value: "on", confirm: true } })).status, 200, "free again afterwards");
  } finally { release(); await server.stop(); }
});

test("repeated wrong tokens are blocked", async () => {
  const { server, port } = await start();
  try {
    for (let i = 0; i < 20; i++) assert.strictEqual((await request(port, { path: "/api/cameras", headers: { "x-test-token": `wrong-${i}` } })).status, 401);
    assert.strictEqual((await request(port, { path: "/api/cameras", headers: auth })).status, 429, "even the right token is blocked for a while");
  } finally { await server.stop(); }
});

test("with an issue form, the camera list and a finished test carry a prefilled GitHub link", async () => {
  const issueForm = {
    url: "https://github.com/example/plugin/issues/new", template: "new-device.yml", origin: "camera-test-page", plugin: "9.9.9", kind: "Camera or doorbell",
    deviceLabel: (m) => (m === "HL_DB2" ? "Doorbells - Video Doorbell v2 (HL_DB2)" : undefined),
  };
  const { server, port } = await start({ issueForm });
  try {
    const list = JSON.parse((await request(port, { path: "/api/cameras", headers: auth })).text).cameras;
    const before = new URL(list[0].issueUrl).searchParams;
    assert.strictEqual(before.get("device"), "Doorbells - Video Doorbell v2 (HL_DB2)");
    assert.strictEqual(before.get("blob"), null);
    const res = await request(port, { method: "POST", path: "/api/cameras/cam-1/test", headers: auth });
    const done = res.text.trim().split("\n").map((l) => JSON.parse(l)).find((l) => l.event === "done");
    const after = new URL(done.issueUrl).searchParams;
    assert.strictEqual(JSON.parse(after.get("blob")).product_model, "HL_DB2");
    assert.strictEqual(JSON.parse(after.get("blob")).camera_test_page.nightVision, "auto");
    for (const secret of [MAC, "192.168.1.50", "SECRETENR", "ABCDEFGHIJKLMNOPQRST"]) assert.ok(!decodeURIComponent(done.issueUrl).includes(secret), `leaked ${secret}`);
  } finally { await server.stop(); }
});

test("without an issue form there is no link", async () => {
  const { server, port } = await start();
  try {
    const list = JSON.parse((await request(port, { path: "/api/cameras", headers: auth })).text).cameras;
    assert.strictEqual(list[0].issueUrl, null);
    const res = await request(port, { method: "POST", path: "/api/cameras/cam-1/test", headers: auth });
    assert.strictEqual(res.text.trim().split("\n").map((l) => JSON.parse(l)).find((l) => l.event === "done").issueUrl, null);
  } finally { await server.stop(); }
});

// ---- the settings and sensors tabs: read-only views of the host's config file ----

function fakeSettings() {
  const file = { warmLiveView: false };
  const calls = { describe: 0 };
  return {
    file, calls,
    describe: async () => { calls.describe += 1; return { file: "config.json", fields: [{ key: "warmLiveView", title: "Quick Live View", type: "boolean", value: file.warmLiveView, running: false, pending: file.warmLiveView !== false, default: false }] }; },
  };
}

function fakeSensors() {
  const calls = { describe: 0 };
  return {
    calls,
    describe: async () => { calls.describe += 1; return { plans: [], cameras: [{ id: "AA", name: "Yard", model: "HL_CAM3", plan: "", planActive: false, setting: "Automatic", notAuto: false, items: [], unnamed: [] }] }; },
  };
}

test("without settings or sensors there are no such routes", async () => {
  const { server, port } = await start({});
  try {
    assert.strictEqual((await request(port, { path: "/api/settings", headers: auth })).status, 404);
    assert.strictEqual((await request(port, { path: "/api/sensors", headers: auth })).status, 404);
  } finally { await server.stop(); }
});

test("the settings and sensors are read from the host every time, and need the token", async () => {
  const settings = fakeSettings();
  const sensors = fakeSensors();
  const { server, port } = await start({ settings, sensors });
  try {
    assert.strictEqual((await request(port, { path: "/api/settings" })).status, 401);
    assert.strictEqual((await request(port, { path: "/api/sensors" })).status, 401);
    const first = JSON.parse((await request(port, { path: "/api/settings", headers: auth })).text).settings;
    assert.strictEqual(first.fields[0].value, false);
    settings.file.warmLiveView = true; // changed in the file by someone else
    const second = JSON.parse((await request(port, { path: "/api/settings", headers: auth })).text).settings;
    assert.strictEqual(second.fields[0].value, true);
    assert.strictEqual(settings.calls.describe, 2, "no copy kept between reads");
    await request(port, { path: "/api/sensors", headers: auth });
    const read = JSON.parse((await request(port, { path: "/api/sensors", headers: auth })).text).sensors;
    assert.strictEqual(read.cameras[0].name, "Yard");
    assert.strictEqual(sensors.calls.describe, 2);
  } finally { await server.stop(); }
});

test("the page cannot change the settings or the sensors: only reads are served", async () => {
  const { server, port } = await start({ settings: fakeSettings(), sensors: fakeSensors() });
  try {
    for (const route of ["/api/settings", "/api/sensors"]) {
      for (const method of ["PUT", "POST", "DELETE", "PATCH"]) {
        const res = await request(port, { method, path: route, headers: json, body: { changes: { warmLiveView: true }, id: "AA", auto: true } });
        assert.strictEqual(res.status, 405, `${method} ${route}`);
      }
    }
  } finally { await server.stop(); }
});

test("a read that fails is a 502 with the reason", async () => {
  const settings = { describe: async () => { throw new Error("could not read config.json (EACCES)"); } };
  const { server, port } = await start({ settings });
  try {
    const res = await request(port, { path: "/api/settings", headers: auth });
    assert.strictEqual(res.status, 502);
    assert.match(JSON.parse(res.text).error, /EACCES/);
  } finally { await server.stop(); }
});

test("the page's script is valid, and the page uses nothing its security policy blocks", async () => {
  const { server, port } = await start();
  try {
    const html = (await request(port, { path: "/?token=test-token-1234" })).text;
    const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.strictEqual(scripts.length, 1, "one inline script, with the nonce");
    assert.doesNotThrow(() => new (require("node:vm").Script)(scripts[0]), "the script parses");
    assert.ok(!/\sstyle\s*=/.test(html.replace(/<style[\s\S]*?<\/style>/g, "")), "no inline style attributes: the policy allows only the nonce'd style element");
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), "no inline event handler attributes");
    assert.ok(!/<(script|link|img|iframe)[^>]+(src|href)\s*=\s*["']https?:/i.test(html), "nothing is loaded from another site");
    // the i icon that carries the extra information
    assert.match(scripts[0], /function info\(text, label/);
    assert.match(scripts[0], /setAttribute\("role", "tooltip"\)/);
    assert.match(html, /\.info \.tip \{/);
  } finally { await server.stop(); }
});


test("the page itself never writes settings: it has no save button and sends no PUT", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/web/cameraTestPage.html"), "utf8");
  assert.ok(!html.includes('"PUT"'));
  assert.ok(!html.includes("settings-save"));
  assert.ok(!html.includes("/api/sensors\", {"));
});

test("every name the page's script uses is defined (a missing function only shows in the browser)", async () => {
  const { ESLint } = require("eslint");
  const html = fs.readFileSync(path.join(__dirname, "../src/web/cameraTestPage.html"), "utf8");
  const script = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)[1];
  const eslint = new ESLint({
    useEslintrc: false,
    overrideConfig: { root: true, parserOptions: { ecmaVersion: 2022 }, env: { browser: true, es2022: true }, rules: { "no-undef": "error" } },
  });
  const [result] = await eslint.lintText(script);
  assert.deepStrictEqual(result.messages.map((m) => `${m.line}: ${m.message}`), []);
});

// ---- the other-devices tab: devices the host does not support, tested and reported ----

const THINGS = [
  { mac: "AABBCCDDEEFF", product_model: "CO_AP1", product_type: "AirPurifier", nickname: "Bedroom purifier", firmware_ver: "1.2.3", conn_state: 1, device_params: { ip: "10.0.0.7" } },
  { mac: "112233445566", product_model: "WLPP1", product_type: "Plug", nickname: "Lamp", firmware_ver: "1.0", conn_state: 1, device_params: {} },
  { mac: "665544332211", product_model: "GW_WC", product_type: "Camera", nickname: "Window", firmware_ver: "9.9", conn_state: 0, device_params: { dtls: 1, ip: "10.0.0.8", p2p_id: "U", } },
];
const issueForm = { url: "https://github.com/example/plugin/issues/new", template: "new-device.yml", origin: "camera-test-page", plugin: "2.0.0", deviceLabel: (m) => (m === "WLPP1" ? "Plugs and switches - Plug (WLPP1)" : undefined) };
const ENTRY = {
  label: "device-1", model: "CO_AP1", type: "AirPurifier", firmware: "1.2.3",
  endpoints: { propertyList: "POST https://api.example.test/app/v2/device/get_property_list", deviceInfo: "POST https://api.example.test/app/v2/device/get_device_Info" },
  propertyList: { P3: "1", P5: "2", P1301: "40" }, deviceInfo: { power: 1 },
};

function startOthers(extra = {}) {
  const calls = { report: [], discovery: [] };
  const unsupported = (d) => d.product_model !== "WLPP1";
  return {
    calls,
    ...{ promise: start({
      client: { getDeviceList: async () => THINGS, cameraUsesDeviceMgmt: () => false },
      unsupported,
      describeDevice: (m) => (m === "GW_WC" ? "Wyze Window Cam: nothing is known about how it is controlled yet." : undefined),
      versions: { plugin: "2.0.0" },
      issueForm,
      deviceReport: async (opts) => {
        calls.report.push({ selected: THINGS.filter(opts.select).map((d) => d.product_model), versions: opts.versions, hasProbe: typeof opts.localProbe === "function" });
        calls.discovery.push(opts.discovery);
        const entry = opts.discovery
          ? { ...ENTRY, capabilityDiscovery: { requests: 3, withValues: ["device-info", "iot-device"], accepted: { "device-info": ["firmware-ver"], "iot-device": ["iot-state"] }, rejected: ["camera"] } }
          : ENTRY;
        return { generated: "2026-11-14T00:00:00Z", versions: opts.versions, devices: [entry] };
      },
      ...extra,
    }) },
  };
}

test("capability discovery runs only when the request asks for it, and shows up as a step", async () => {
  const { promise, calls } = startOthers();
  const { server, port } = await promise;
  try {
    await request(port, { path: "/api/devices", headers: auth });
    const plain = JSON.parse((await request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body: {} })).text);
    assert.strictEqual(calls.discovery[0], false);
    assert.ok(!plain.steps.some((st) => st.name === "Capability discovery"));
    const asked = JSON.parse((await request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body: { discovery: true } })).text);
    assert.strictEqual(calls.discovery[1], true);
    const step = asked.steps.find((st) => st.name === "Capability discovery");
    assert.ok(step && step.ok);
    assert.match(step.detail, /values for device-info, iot-device; 1 groups rejected \(3 reads\)/);
    // a truthy string is not a yes: it has to be the boolean true (refresh, so a saved scan is not what answers)
    await request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body: { discovery: "true", refresh: true } });
    assert.strictEqual(calls.discovery[2], false);
  } finally { await server.stop(); }
});

const post = (port, body = {}) => request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body });

test("a scan is saved: the same device is not read again, and the link and the report are the same as the first time", async () => {
  const { promise, calls } = startOthers();
  const { server, port } = await promise;
  try {
    await request(port, { path: "/api/devices", headers: auth });
    const first = JSON.parse((await post(port)).text);
    const again = JSON.parse((await post(port)).text);
    assert.strictEqual(calls.report.length, 1, "Wyze was asked once");
    assert.strictEqual(first.cached, false);
    assert.strictEqual(again.cached, true);
    assert.strictEqual(again.collectedAt, first.collectedAt, "it says when the scan was made");
    assert.strictEqual(again.issueUrl, first.issueUrl, "the issue link is the same from a saved scan");
    assert.deepStrictEqual(again.report, first.report);
    assert.deepStrictEqual(again.steps, first.steps);
    // "Scan again" ignores what was saved
    const fresh = JSON.parse((await post(port, { refresh: true })).text);
    assert.strictEqual(calls.report.length, 2);
    assert.strictEqual(fresh.cached, false);
  } finally { await server.stop(); }
});

test("capability discovery is read once per device and firmware: a scan without it is upgraded, and a saved one is reused", async () => {
  const { promise, calls } = startOthers();
  const { server, port } = await promise;
  try {
    await request(port, { path: "/api/devices", headers: auth });
    await post(port);                                   // plain scan
    const withIt = JSON.parse((await post(port, { discovery: true })).text);   // needs discovery: a new read
    assert.strictEqual(calls.report.length, 2);
    assert.strictEqual(withIt.cached, false);
    assert.ok(withIt.steps.some((st) => st.name === "Capability discovery"));
    const saved = JSON.parse((await post(port, { discovery: true })).text);    // asked again: saved
    assert.strictEqual(calls.report.length, 2);
    assert.strictEqual(saved.cached, true);
    const plain = JSON.parse((await post(port)).text);  // a plain ask is answered by the saved scan too
    assert.strictEqual(calls.report.length, 2);
    assert.strictEqual(plain.cached, true);
    assert.deepStrictEqual(calls.discovery, [false, true]);
  } finally { await server.stop(); }
});

test("when a saved scan is too old it is read again, but capability discovery is not (the firmware has not changed)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const { promise, calls } = startOthers();
  const { server, port } = await promise;
  try {
    await request(port, { path: "/api/devices", headers: auth });
    await post(port, { discovery: true });
    assert.deepStrictEqual(calls.discovery, [true]);
    t.mock.timers.tick(11 * 60 * 1000);                 // past the ten minutes a scan is kept
    const later = JSON.parse((await post(port, { discovery: true })).text);
    assert.strictEqual(calls.report.length, 2, "the device is read again");
    assert.deepStrictEqual(calls.discovery, [true, false], "but its capability groups are not asked for again");
    assert.ok(later.report.device.capabilityDiscovery, "the saved discovery is still in the report");
    assert.ok(later.report.device.endpoints.devicemgmt.includes("get_iot_prop"));
    assert.strictEqual(later.cached, false);
  } finally { await server.stop(); t.mock.timers.reset(); }
});

test("the device list is read once for both tabs within a minute, and again after that", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  let reads = 0;
  const { promise } = startOthers({ client: { getDeviceList: async () => { reads += 1; return THINGS; }, cameraUsesDeviceMgmt: () => false } });
  const { server, port } = await promise;
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    await request(port, { path: "/api/devices", headers: auth });
    await request(port, { path: "/api/cameras", headers: auth });
    assert.strictEqual(reads, 1);
    t.mock.timers.tick(61 * 1000);
    await request(port, { path: "/api/devices", headers: auth });
    assert.strictEqual(reads, 2);
  } finally { await server.stop(); t.mock.timers.reset(); }
});

test("which capability groups a device has is saved in the persist path, owner-only and without the MAC, and a restart reuses it", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-cache-"));
  const client = () => ({ getDeviceList: async () => THINGS, cameraUsesDeviceMgmt: () => false, persistPath: dir });
  try {
    let run = startOthers({ client: client() });
    let { server, port } = await run.promise;
    await request(port, { path: "/api/devices", headers: auth });
    await post(port, { discovery: true });
    assert.deepStrictEqual(run.calls.discovery, [true], "the first time it is asked");
    await server.stop();

    const file = path.join(dir, "device-scan-cache.json");
    assert.ok(fs.existsSync(file), "the cache is in the persist path");
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, "owner-only");
    const text = fs.readFileSync(file, "utf8");
    for (const secret of ["AABBCCDDEEFF", "112233445566", "665544332211", "Bedroom purifier", "10.0.0.7"]) assert.ok(!text.includes(secret), `no ${secret} on disk`);
    assert.ok(text.includes("device-info"), "the group names are there");
    assert.ok(!fs.existsSync(`${file}.tmp`), "no half-written file is left");

    // a new server (a restart) in the same folder: asked for discovery, it reads the device but not its groups
    run = startOthers({ client: client() });
    ({ server, port } = await run.promise);
    await request(port, { path: "/api/devices", headers: auth });
    const body = JSON.parse((await post(port, { discovery: true })).text);
    assert.deepStrictEqual(run.calls.discovery, [false], "the groups came from the file");
    assert.ok(body.steps.some((st) => st.name === "Capability discovery" && st.ok));
    // Scan again asks anyway, and writes the new answer
    await post(port, { discovery: true, refresh: true });
    assert.deepStrictEqual(run.calls.discovery, [false, true]);
    await server.stop();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a different firmware, a damaged cache file or no persist path never breaks a scan", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-cache-"));
  const file = path.join(dir, "device-scan-cache.json");
  try {
    fs.writeFileSync(file, "{ this is not json");
    let run = startOthers({ client: { getDeviceList: async () => THINGS, cameraUsesDeviceMgmt: () => false, persistPath: dir } });
    let { server, port } = await run.promise;
    await request(port, { path: "/api/devices", headers: auth });
    assert.strictEqual((await post(port, { discovery: true })).status, 200, "a damaged file is ignored and replaced");
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
    await server.stop();

    // the saved answer belongs to a firmware: a device that now has another one is asked again
    const updated = THINGS.map((d) => (d.mac === "AABBCCDDEEFF" ? { ...d, firmware_ver: "9.9.9" } : d));
    run = startOthers({ client: { getDeviceList: async () => updated, cameraUsesDeviceMgmt: () => false, persistPath: dir } });
    ({ server, port } = await run.promise);
    await request(port, { path: "/api/devices", headers: auth });
    await post(port, { discovery: true });
    assert.deepStrictEqual(run.calls.discovery, [true], "a new firmware is not served the old answer");
    await server.stop();

    // scanCacheDir null: memory only, and nothing is written
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "scan-cache-"));
    run = startOthers({ client: { getDeviceList: async () => THINGS, cameraUsesDeviceMgmt: () => false, persistPath: other }, scanCacheDir: null });
    ({ server, port } = await run.promise);
    await request(port, { path: "/api/devices", headers: auth });
    await post(port, { discovery: true });
    assert.deepStrictEqual(fs.readdirSync(other), []);
    await server.stop();
    fs.rmSync(other, { recursive: true, force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("without an unsupported check there are no device routes", async () => {
  const { server, port } = await start({});
  try {
    assert.strictEqual((await request(port, { path: "/api/devices", headers: auth })).status, 404);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body: {} })).status, 404);
  } finally { await server.stop(); }
});

test("the devices the host does not support are listed, with what it knows, and the ids show no address", async () => {
  const { promise } = startOthers();
  const { server, port } = await promise;
  try {
    assert.strictEqual((await request(port, { path: "/api/devices" })).status, 401, "needs the token");
    const res = await request(port, { path: "/api/devices", headers: auth });
    const devices = JSON.parse(res.text).devices;
    assert.deepStrictEqual(devices.map((d) => [d.id, d.model, d.type]), [["dev-1", "CO_AP1", "AirPurifier"], ["dev-2", "GW_WC", "Camera"]]);
    assert.strictEqual(devices[1].known, "Wyze Window Cam: nothing is known about how it is controlled yet.")
    assert.strictEqual(devices[0].known, null);
    assert.match(devices[0].issueUrl, /^https:\/\/github\.com\/example\/plugin\/issues\/new\?/);
    assert.match(devices[0].issueUrl, /model=CO_AP1/);
    assert.match(devices[0].issueUrl, /kind=Vacuum%2C%20sprinkler%20or%20other%20appliance/);
    assert.match(devices[0].issueUrl, /report=It%20is%20not%20supported%20yet/);
    assert.ok(!res.text.includes("AABBCCDDEEFF") && !res.text.includes("10.0.0.7"), "no MAC or address in the answer");
  } finally { await server.stop(); }
});

test("the Test button collects a report for that one device and returns steps, the report and a prefilled link", async () => {
  const { promise, calls } = startOthers();
  const { server, port } = await promise;
  try {
    await request(port, { path: "/api/devices", headers: auth });
    const res = await request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body: {} });
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.text);
    assert.deepStrictEqual(calls.report, [{ selected: ["CO_AP1"], versions: { plugin: "2.0.0" }, hasProbe: true }]);
    assert.deepStrictEqual(body.steps.map((s) => [s.name, s.ok]), [["Property list", true], ["Device info", true]]);
    assert.strictEqual(body.steps[0].detail, "3 properties");
    assert.strictEqual(body.steps[0].endpoint, "POST https://api.example.test/app/v2/device/get_property_list", "each step says which endpoint it asked");
    assert.strictEqual(body.steps[1].endpoint, "POST https://api.example.test/app/v2/device/get_device_Info");
    assert.strictEqual(body.report.device.model, "CO_AP1");
    const link = new URL(body.issueUrl);
    assert.strictEqual(link.searchParams.get("model"), "CO_AP1");
    const blob = JSON.parse(link.searchParams.get("blob"));
    assert.strictEqual(blob.product_model, "CO_AP1", "the form's check finds the model code first");
    assert.deepStrictEqual(blob.device_report.propertyList, { P3: "1", P5: "2", P1301: "40" }, "the report fits, so it is in the link");
    assert.match(link.searchParams.get("details"), /^Wyze lists it as type AirPurifier, model CO_AP1, firmware 1\.2\.3\. Collected/);
    assert.match(link.searchParams.get("details"), /3 properties in the property list/);
    assert.match(link.searchParams.get("details"), /from https:\/\/api\.example\.test\/app\/v2\/device\/get_property_list and https:\/\/api\.example\.test\/app\/v2\/device\/get_device_Info/);
    assert.deepStrictEqual(blob.endpoints, ENTRY.endpoints, "the form's device information box names the endpoints too");
    assert.ok(body.issueUrl.length <= 7000);
  } finally { await server.stop(); }
});

test("a long report is summarised in the link, and the full one is still in the answer for the download", async () => {
  const big = { ...ENTRY, propertyList: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`P${i}`, "x".repeat(20)])) };
  const { promise } = startOthers({ deviceReport: async (opts) => ({ generated: "now", versions: opts.versions, devices: [big] }) });
  const { server, port } = await promise;
  try {
    await request(port, { path: "/api/devices", headers: auth });
    const body = JSON.parse((await request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body: {} })).text);
    assert.ok(body.issueUrl.length <= 7000);
    const blob = JSON.parse(new URL(body.issueUrl).searchParams.get("blob"));
    assert.strictEqual(blob.device_report.property_count, 400);
    assert.match(blob.device_report.note, /drag it into the .What the device does. box/);
    assert.strictEqual(Object.keys(body.report.device.propertyList).length, 400);
  } finally { await server.stop(); }
});

test("a report that fails is a 502 and leaves the page free for the next one; an unknown device is a 404; only POST is accepted", async () => {
  let fail = true;
  const { promise } = startOthers({ deviceReport: async (opts) => { if (fail) throw new Error("Wyze said no"); return { generated: "now", versions: opts.versions, devices: [ENTRY] }; } });
  const { server, port } = await promise;
  try {
    await request(port, { path: "/api/devices", headers: auth });
    const failed = await request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body: {} });
    assert.strictEqual(failed.status, 502);
    assert.match(JSON.parse(failed.text).error, /Wyze said no/);
    fail = false;
    assert.strictEqual((await request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body: {} })).status, 200);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/devices/dev-9/report", headers: json, body: {} })).status, 404);
    assert.strictEqual((await request(port, { method: "GET", path: "/api/devices/dev-1/report", headers: auth })).status, 405);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: { ...json, origin: "http://evil.example.com" }, body: {} })).status, 403);
  } finally { await server.stop(); }
});

test("a device report and a camera test never run at the same time", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { promise } = startOthers({ deviceReport: async (opts) => { await gate; return { generated: "now", versions: opts.versions, devices: [ENTRY] }; } });
  const { server, port } = await promise;
  try {
    await request(port, { path: "/api/devices", headers: auth });
    const first = request(port, { method: "POST", path: "/api/devices/dev-1/report", headers: json, body: {} });
    await new Promise((r) => setTimeout(r, 40));
    const second = await request(port, { method: "POST", path: "/api/devices/dev-2/report", headers: json, body: {} });
    assert.strictEqual(second.status, 409);
    release();
    assert.strictEqual((await first).status, 200);
  } finally { release(); await server.stop(); }
});

// ---- review fixes: one change at a time, the lockout, and the host's per-camera queue ----

test("two night vision changes sent together run one at a time: the second is refused while the first is running", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let started = 0;
  const { server, port } = await start({ setNightVision: async (target) => { started += 1; await gate; return { before: "auto", after: target.value, matches: true }; } });
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    const body = { value: "on", confirm: true };
    const first = request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body });
    const second = request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body });
    await new Promise((r) => setTimeout(r, 60));
    release();
    const statuses = [(await first).status, (await second).status].sort();
    assert.deepStrictEqual(statuses, [200, 409]);
    assert.strictEqual(started, 1, "only one conversation with the camera");
  } finally { release(); await server.stop(); }
});

test("a night vision change that is refused before it starts (no confirm, bad value) does not take the slot", async () => {
  const { server, port } = await start({});
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    assert.strictEqual((await request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body: { value: "on" } })).status, 400);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body: { value: "dim", confirm: true } })).status, 400);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body: { value: "on", confirm: true } })).status, 200);
  } finally { await server.stop(); }
});

test("a few wrong tokens (a tab left open across a restart) do not lock the right token out; many do", async () => {
  const { server, port } = await start({});
  try {
    for (let i = 0; i < 8; i += 1) assert.strictEqual((await request(port, { path: "/api/cameras", headers: { "x-test-token": "old-token" } })).status, 401);
    assert.strictEqual((await request(port, { path: "/api/cameras", headers: auth })).status, 200, "still served after eight wrong ones");
    for (let i = 0; i < 25; i += 1) await request(port, { path: "/api/cameras", headers: { "x-test-token": "guess" } });
    assert.strictEqual((await request(port, { path: "/api/cameras", headers: auth })).status, 429, "blocked after many");
  } finally { await server.stop(); }
});

test("with the host's own client, a night vision change and a test go through its per-camera queue", async () => {
  const queued = [];
  const client = {
    getDeviceList: async () => CAMERAS,
    _oneAtATime: (mac, job) => { queued.push(mac); return job(); },
    // like the real client, the change queues itself: the page must not queue it a second time
    setCameraNightVision: (mac, value) => client._oneAtATime(mac, async () => ({ before: "off", after: value, matches: true })),
  };
  const { server, port } = await start({ client, setNightVision: undefined, probe: async () => ({ authenticated: true }) });
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    const set = await request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body: { value: "auto", confirm: true } });
    assert.deepStrictEqual(JSON.parse(set.text), { before: "off", after: "auto", matches: true }, "the client's method is used");
    await request(port, { method: "POST", path: "/api/cameras/cam-1/test", headers: json, body: {} });
    assert.strictEqual(queued.length, 2, "each went through the queue once: the change by the client itself, the test by the page");
  } finally { await server.stop(); }
});

test("the page stops asking once the server has refused its token", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/web/cameraTestPage.html"), "utf8");
  assert.ok(html.includes("linkExpired = true"));
  assert.ok(html.includes('if (linkExpired) throw new Error("this link has expired")'));
  assert.ok(html.includes("if (!linkExpired) showStatus"));
});

// ---- snapshots, the support view and the prefilled links ----

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const camForm = { url: "https://github.com/example/plugin/issues/new", template: "new-device.yml", origin: "camera-test-page", plugin: "2.0.0", kind: "Camera or doorbell", deviceLabel: (m) => (m === "HL_DB2" ? "Video Doorbell v2 (HL_DB2)" : undefined) };

test("a snapshot is a JPEG behind the token; ?live=1 asks for a fresh frame, and a failure says nothing about the camera's insides", async () => {
  const asked = [];
  const { server, port } = await start({
    client: {
      getDeviceList: async () => CAMERAS,
      getCameraSnapshotImage: async (mac, options) => { asked.push({ mac, options }); return { buffer: JPEG, source: options.skipCloud ? "capture" : "cloud" }; },
    },
  });
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    assert.strictEqual((await request(port, { path: "/api/cameras/cam-1/snapshot" })).status, 401, "no token, no picture");
    const saved = await request(port, { path: "/api/cameras/cam-1/snapshot", headers: auth });
    assert.strictEqual(saved.status, 200);
    assert.strictEqual(saved.headers["content-type"], "image/jpeg");
    assert.strictEqual(saved.headers["cache-control"], "no-store");
    assert.strictEqual(saved.headers["x-snapshot-source"], "cloud");
    assert.deepStrictEqual(asked[0], { mac: MAC, options: { deviceModel: "HL_DB2", skipCloud: false, noCache: false, cloudOnly: true, timeoutMs: 20000 } });
    const live = await request(port, { path: "/api/cameras/cam-1/snapshot?live=1", headers: auth });
    assert.strictEqual(live.headers["x-snapshot-source"], "live");
    assert.deepStrictEqual([asked[1].options.skipCloud, asked[1].options.noCache], [true, true], "a live frame, not a saved or cached one");
    assert.strictEqual(asked[0].options.cloudOnly, true, "the picture shown on opening never starts a stream on the camera");
    assert.strictEqual(asked[1].options.cloudOnly, false);
    assert.strictEqual((await request(port, { path: "/api/cameras/cam-9/snapshot", headers: auth })).status, 404);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/cameras/cam-1/snapshot", headers: json, body: {} })).status, 405);
  } finally { await server.stop(); }
});

test("a snapshot that is not a picture, or that fails, is a plain error; one at a time per camera", async () => {
  let mode = "bad";
  let release;
  const { server, port } = await start({
    client: {
      getDeviceList: async () => CAMERAS,
      getCameraSnapshotImage: async () => {
        if (mode === "bad") return { buffer: Buffer.from("<html>nope</html>"), source: "cloud" };
        if (mode === "throw") throw new Error("ffmpeg exploded at https://secret.example/x?token=abc\nmore");
        await new Promise((resolve) => { release = resolve; });
        return { buffer: JPEG, source: "capture" };
      },
    },
  });
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    const notJpeg = await request(port, { path: "/api/cameras/cam-1/snapshot", headers: auth });
    assert.strictEqual(notJpeg.status, 502);
    assert.match(notJpeg.text, /did not return a picture/);
    mode = "throw";
    const failed = await request(port, { path: "/api/cameras/cam-1/snapshot", headers: auth });
    assert.strictEqual(failed.status, 502);
    assert.ok(!/secret|token|ffmpeg|exploded/.test(failed.text), "what went wrong inside is not handed to the page");
    mode = "slow";
    const first = request(port, { path: "/api/cameras/cam-1/snapshot?live=1", headers: auth });
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual((await request(port, { path: "/api/cameras/cam-1/snapshot?live=1", headers: auth })).status, 409, "a second one for the same camera waits its turn");
    release();
    assert.strictEqual((await first).status, 200);
  } finally { await server.stop(); }
});

test("a client that cannot take snapshots gives the page a plain 404 instead of an error", async () => {
  const { server, port } = await start();
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    assert.strictEqual((await request(port, { path: "/api/cameras/cam-1/snapshot", headers: auth })).status, 404);
  } finally { await server.stop(); }
});

test("what a camera may support: scanned once and saved, joined with what Test found, and with a prefilled link that carries it", async () => {
  const calls = [];
  const ENTRY2 = { label: "device-1", model: "HL_DB2", type: "Camera", firmware: "4.51.3.6791", propertyList: { P3: "1", P1049: "2" }, deviceInfo: { data: {} },
    capabilityDiscovery: { requests: 1, withValues: ["siren"], accepted: { siren: ["state"], wifi: ["signal-strength"] }, rejected: [] } };
  const { server, port } = await start({
    client: { getDeviceList: async () => CAMERAS },
    issueForm: camForm,
    deviceReport: async (opts) => { calls.push({ discovery: opts.discovery, local: typeof opts.localProbe === "function" }); return { generated: "2026-11-18T00:00:00Z", versions: opts.versions, devices: [{ ...ENTRY2 }] }; },
  });
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    const one = JSON.parse((await request(port, { method: "POST", path: "/api/cameras/cam-1/support", headers: json, body: {} })).text);
    assert.deepStrictEqual(calls, [{ discovery: true, local: false }], "discovery, and no direct ask of the camera");
    assert.strictEqual(one.cached, false);
    assert.strictEqual(one.cameraAnswered, null, "Test has not been run");
    const states = Object.fromEntries(one.support.features.map((f) => [f.key, f.state]));
    assert.strictEqual(states.siren, "yes");
    assert.strictEqual(states.wifiSignal, "yes");
    assert.strictEqual(states.doorbell, "likely", "the Doorbell v2 is a known doorbell");
    assert.strictEqual(states.nightVision, "likely", "not asked over the network yet");
    const link = new URL(one.issueUrl);
    assert.strictEqual(link.searchParams.get("report"), "It works", "a camera that answered is preselected as working, not as unsupported");
    assert.strictEqual(link.searchParams.get("device"), "Video Doorbell v2 (HL_DB2)");
    assert.ok(JSON.parse(link.searchParams.get("blob")).support.yes.includes("siren"), "the support list is in the link");

    const again = JSON.parse((await request(port, { method: "POST", path: "/api/cameras/cam-1/support", headers: json, body: {} })).text);
    assert.strictEqual(calls.length, 1, "the second ask is answered from the saved scan");
    assert.strictEqual(again.cached, true);
    assert.strictEqual(again.issueUrl, one.issueUrl);

    // Test the camera over the network: its answers join the list, and the test's own link carries the list too
    const test = await request(port, { method: "POST", path: "/api/cameras/cam-1/test", headers: json, body: {} });
    const done = test.text.trim().split("\n").map((l) => JSON.parse(l)).find((l) => l.event === "done");
    const testLink = new URL(done.issueUrl);
    assert.strictEqual(testLink.searchParams.get("report"), "It works", "authenticated and night vision answered");
    assert.ok(JSON.parse(testLink.searchParams.get("blob")).support, "the test link has the support list too");
    const joined = JSON.parse((await request(port, { method: "POST", path: "/api/cameras/cam-1/support", headers: json, body: {} })).text);
    assert.ok(joined.cameraAnswered, "it says the camera's own answers are included");
    assert.strictEqual(Object.fromEntries(joined.support.features.map((f) => [f.key, f.state])).nightVision, "yes");
    assert.strictEqual(calls.length, 1, "joining what Test found did not read Wyze again");

    const fresh = JSON.parse((await request(port, { method: "POST", path: "/api/cameras/cam-1/support", headers: json, body: { refresh: true } })).text);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(fresh.cached, false);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/cameras/cam-9/support", headers: json, body: {} })).status, 404);
    assert.strictEqual((await request(port, { method: "GET", path: "/api/cameras/cam-1/support", headers: auth })).status, 405);
  } finally { await server.stop(); }
});

test("the footer's Report an issue is the bug form with the versions filled in, or the chooser when the host gave no form", async () => {
  const withForm = await start({ issueForm: camForm, versions: { plugin: "2.0.0", "wyze-api": "2.0.1", node: "v22.1.0" } });
  try {
    const html = (await request(withForm.port, { path: "/?token=test-token-1234" })).text;
    const href = /href="([^"]*)"[^>]*>Report an issue</.exec(html)[1].replace(/&amp;/g, "&");
    const link = new URL(href);
    assert.strictEqual(`${link.origin}${link.pathname}`, camForm.url);
    assert.strictEqual(link.searchParams.get("template"), "bug-report.yml");
    assert.match(link.searchParams.get("versions"), /Plugin: 2\.0\.0\nwyze-api: 2\.0\.1\nHomebridge: \nNode\.js: v22\.1\.0/);
    assert.strictEqual(link.searchParams.get("origin"), "camera-test-page");
  } finally { await withForm.server.stop(); }
  const without = await start();
  try {
    const html = (await request(without.port, { path: "/?token=test-token-1234" })).text;
    assert.match(html, /href="https:\/\/github\.com\/[^"]*\/issues\/new\/choose"[^>]*>Report an issue</);
  } finally { await without.server.stop(); }
});

test("a night vision change with the real client's own queue finishes (it used to wait on itself) and frees the page for the next test", async () => {
  // the real client: it has _oneAtATime, and setCameraNightVision queues on it, as in Homebridge
  const api = new WyzeAPI({ username: "u", password: "p", keyId: "k", apiKey: "a", logLevel: "error" });
  const device = { ...CAMERAS[0], device_params: { dtls: 1, ip: "10.0.0.9", p2p_id: "UID" } };
  api.getDeviceList = async () => [device];
  const sent = [];
  const tutkClient = require("../src/tutk/client");
  const original = tutkClient.setNightVision;
  tutkClient.setNightVision = async (args) => { sent.push(args.value); return { before: "auto", after: args.value, matches: true }; };
  const { server, port } = await start({ client: api, setNightVision: null });
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    const done = await Promise.race([
      request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body: { value: "off", confirm: true } }),
      new Promise((resolve) => setTimeout(() => resolve({ status: "HUNG" }), 3000)),
    ]);
    assert.strictEqual(done.status, 200, "the change came back");
    assert.deepStrictEqual(sent, ["off"], "and was sent once");
    // nothing is left holding the one-test-at-a-time lock, and the camera's queue is free
    const next = await request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body: { value: "auto", confirm: true } });
    assert.strictEqual(next.status, 200);
    assert.deepStrictEqual(sent, ["off", "auto"]);
  } finally { tutkClient.setNightVision = original; await server.stop(); }
});

test("a stand-in night vision change and the bare tutk path are each queued once", async () => {
  const order = [];
  const { server, port } = await start({
    client: { getDeviceList: async () => CAMERAS, _oneAtATime: (mac, job) => { order.push("queued"); return job(); } },
    setNightVision: async (args) => { order.push("ran"); return { before: "auto", after: args.value, matches: true }; },
  });
  try {
    await request(port, { path: "/api/cameras", headers: auth });
    assert.strictEqual((await request(port, { method: "POST", path: "/api/cameras/cam-1/night-vision", headers: json, body: { value: "on", confirm: true } })).status, 200);
    assert.deepStrictEqual(order, ["queued", "ran"], "queued once, then run");
  } finally { await server.stop(); }
});

test("a card's id stays with its device when the list is reordered or a device goes, so a button never changes another camera", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const A = { ...CAMERAS[0], mac: "AAAAAAAAAAAA", nickname: "A" };
  const B = { ...CAMERAS[0], mac: "BBBBBBBBBBBB", nickname: "B" };
  const C = { ...CAMERAS[0], mac: "CCCCCCCCCCCC", nickname: "C" };
  const D = { ...CAMERAS[0], mac: "DDDDDDDDDDDD", nickname: "D" };
  let list = [A, B, C];
  const changed = [];
  const { server, port } = await start({
    client: { getDeviceList: async () => list },
    setNightVision: async (args) => { changed.push(args.mac); return { before: "auto", after: args.value, matches: true }; },
  });
  const night = (id) => request(port, { method: "POST", path: `/api/cameras/${id}/night-vision`, headers: json, body: { value: "off", confirm: true } });
  const read = async () => JSON.parse((await request(port, { path: "/api/cameras", headers: auth })).text).cameras.map((c) => [c.id, c.name]);
  try {
    assert.deepStrictEqual(await read(), [["cam-1", "A"], ["cam-2", "B"], ["cam-3", "C"]]);
    // Wyze returns them in another order, A is gone and D is new; the page reads the list again after the minute it is kept
    list = [C, D, B];
    t.mock.timers.tick(61 * 1000);
    assert.deepStrictEqual(await read(), [["cam-3", "C"], ["cam-4", "D"], ["cam-2", "B"]], "each keeps its id; the new one gets the next number");
    await night("cam-2");
    assert.deepStrictEqual(changed, ["BBBBBBBBBBBB"], "cam-2 is still B (by position it would now be D)");
    await night("cam-3");
    assert.deepStrictEqual(changed, ["BBBBBBBBBBBB", "CCCCCCCCCCCC"]);
    assert.strictEqual((await night("cam-1")).status, 404, "A is gone: its id is not handed to another camera");
    assert.deepStrictEqual(changed.length, 2, "and nothing was changed");
  } finally { await server.stop(); t.mock.timers.reset(); }
});
