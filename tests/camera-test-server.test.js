/**
 * The browser test page: the port rules, who may reach it, and what its routes do. The camera calls are
 * replaced by stand-ins, so nothing here touches a network.
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const { createCameraTestServer, validateWebPort, isPrivateAddress, isAllowedHost } = require("../src/web/cameraTestServer");
const WyzeAPI = require("../src/index");

const MAC = "AABBCCDDEEFF";
const CAMERAS = [
  { mac: MAC, nickname: "Front Doorbell", product_model: "HL_DB2", product_type: "Camera", firmware_ver: "4.51.3.6791", enr: "SECRETENRSECRET16", device_params: { ip: "192.168.1.50", p2p_id: "ABCDEFGHIJKLMNOPQRST", dtls: 1 } },
  { mac: "AABBCCDDEEFF", nickname: "Old Cam", product_model: "WYZEC1", product_type: "Camera", firmware_ver: "3.9.1", enr: "ANOTHERENRSECRET1", device_params: { ip: "192.168.1.51", p2p_id: "TSRQPONMLKJIHGFEDCBA" } },
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
    for (let i = 0; i < 8; i++) assert.strictEqual((await request(port, { path: "/api/cameras", headers: { "x-test-token": `wrong-${i}` } })).status, 401);
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

// ---- the settings panel: the host's config file is the only copy ----

function fakeSettings() {
  const file = { warmLiveView: false };
  const calls = { describe: 0, save: [] };
  return {
    file, calls,
    describe: async () => { calls.describe += 1; return { file: "config.json", fields: [{ key: "warmLiveView", title: "Quick Live View", type: "boolean", value: file.warmLiveView, running: false, pending: file.warmLiveView !== false, default: false }] }; },
    save: async (changes) => {
      calls.save.push(changes);
      if (changes.bad) throw Object.assign(new Error("Quick Live View must be true or false"), { status: 400 });
      if (changes.broken) throw new Error("could not write config.json (EACCES)");
      Object.assign(file, changes);
      return { saved: changes, restartNeeded: true };
    },
  };
}

test("without settings there is no settings route", async () => {
  const { server, port } = await start();
  try {
    assert.strictEqual((await request(port, { path: "/api/settings", headers: auth })).status, 404);
    assert.strictEqual((await request(port, { method: "PUT", path: "/api/settings", headers: json, body: { changes: { a: 1 } } })).status, 404);
  } finally { await server.stop(); }
});

test("the settings are read from the host every time, and a save goes straight to the host and is read back", async () => {
  const settings = fakeSettings();
  const { server, port } = await start({ settings });
  try {
    assert.strictEqual((await request(port, { path: "/api/settings" })).status, 401, "needs the token");
    const first = JSON.parse((await request(port, { path: "/api/settings", headers: auth })).text).settings;
    assert.strictEqual(first.fields[0].value, false);
    settings.file.warmLiveView = true; // changed in the file by someone else
    const second = JSON.parse((await request(port, { path: "/api/settings", headers: auth })).text).settings;
    assert.strictEqual(second.fields[0].value, true, "read again from the file, not remembered");
    assert.strictEqual(settings.calls.describe, 2);
    const saved = await request(port, { method: "PUT", path: "/api/settings", headers: json, body: { changes: { warmLiveView: false } } });
    assert.strictEqual(saved.status, 200);
    assert.deepStrictEqual(JSON.parse(saved.text), { saved: { warmLiveView: false }, restartNeeded: true });
    assert.deepStrictEqual(settings.calls.save, [{ warmLiveView: false }]);
    assert.strictEqual(settings.file.warmLiveView, false);
  } finally { await server.stop(); }
});

test("a refused value is a 400 with the host's message, a failed write is a 502, and neither changes the file", async () => {
  const settings = fakeSettings();
  const { server, port } = await start({ settings });
  try {
    const bad = await request(port, { method: "PUT", path: "/api/settings", headers: json, body: { changes: { bad: true } } });
    assert.strictEqual(bad.status, 400);
    assert.match(JSON.parse(bad.text).error, /must be true or false/);
    const broken = await request(port, { method: "PUT", path: "/api/settings", headers: json, body: { changes: { broken: true } } });
    assert.strictEqual(broken.status, 502);
    assert.deepStrictEqual(settings.file, { warmLiveView: false });
  } finally { await server.stop(); }
});

test("a settings save needs the token, JSON, and the same origin", async () => {
  const settings = fakeSettings();
  const { server, port } = await start({ settings });
  try {
    const body = { changes: { warmLiveView: true } };
    assert.strictEqual((await request(port, { method: "PUT", path: "/api/settings", headers: { "content-type": "application/json" }, body })).status, 401);
    assert.strictEqual((await request(port, { method: "PUT", path: "/api/settings", headers: auth, body: JSON.stringify(body) })).status, 415);
    assert.strictEqual((await request(port, { method: "PUT", path: "/api/settings", headers: { ...json, origin: "http://evil.example.com" }, body })).status, 403);
    assert.strictEqual((await request(port, { method: "PUT", path: "/api/settings", headers: { ...json, "sec-fetch-site": "cross-site" }, body })).status, 403);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/settings", headers: json, body })).status, 405);
    assert.deepStrictEqual(settings.calls.save, [], "nothing reached the host");
  } finally { await server.stop(); }
});

test("two saves at the same time are written one after the other", async () => {
  let active = 0;
  let overlapped = false;
  const settings = {
    describe: async () => ({ file: "config.json", fields: [] }),
    save: async (changes) => { active += 1; if (active > 1) overlapped = true; await new Promise((r) => setTimeout(r, 60)); active -= 1; return { saved: changes, restartNeeded: true }; },
  };
  const { server, port } = await start({ settings });
  try {
    const put = (n) => request(port, { method: "PUT", path: "/api/settings", headers: json, body: { changes: { n } } });
    const results = await Promise.all([put(1), put(2), put(3)]);
    assert.deepStrictEqual(results.map((r) => r.status), [200, 200, 200]);
    assert.strictEqual(overlapped, false);
  } finally { await server.stop(); }
});

// ---- the page itself ----

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

// ---- the sensors panel: the same rules as the settings panel, and the same file ----

function fakeSensors() {
  const calls = { describe: 0, save: [] };
  return {
    calls,
    describe: async () => { calls.describe += 1; return { plans: [], cameras: [{ id: "AA", name: "Yard", model: "HL_CAM3", plan: "", planActive: false, setting: "Automatic", notAuto: false, items: [], unnamed: [] }] }; },
    save: async (id, choice) => {
      calls.save.push({ id, ...choice });
      if (id === "bad") throw Object.assign(new Error("Not saved: nope"), { status: 400 });
      if (id === "broken") throw new Error("could not write config.json (EACCES)");
      return { saved: true, restartNeeded: true };
    },
  };
}

test("without sensors there is no sensors route", async () => {
  const { server, port } = await start({});
  try {
    assert.strictEqual((await request(port, { path: "/api/sensors", headers: auth })).status, 404);
    assert.strictEqual((await request(port, { method: "PUT", path: "/api/sensors", headers: json, body: { id: "AA", auto: true } })).status, 404);
  } finally { await server.stop(); }
});

test("the sensors are read from the host every time, and a save goes straight to the host", async () => {
  const sensors = fakeSensors();
  const { server, port } = await start({ sensors });
  try {
    assert.strictEqual((await request(port, { path: "/api/sensors" })).status, 401, "needs the token");
    await request(port, { path: "/api/sensors", headers: auth });
    const read = JSON.parse((await request(port, { path: "/api/sensors", headers: auth })).text).sensors;
    assert.strictEqual(read.cameras[0].name, "Yard");
    assert.strictEqual(sensors.calls.describe, 2, "no copy kept between reads");
    const saved = await request(port, { method: "PUT", path: "/api/sensors", headers: json, body: { id: "AA", ticks: { person: false } } });
    assert.strictEqual(saved.status, 200);
    assert.deepStrictEqual(sensors.calls.save, [{ id: "AA", ticks: { person: false }, auto: false }]);
    await request(port, { method: "PUT", path: "/api/sensors", headers: json, body: { id: "AA", auto: true } });
    assert.strictEqual(sensors.calls.save[1].auto, true);
  } finally { await server.stop(); }
});

test("a refused sensors choice is a 400 with the reason, and a failed write is a 502", async () => {
  const { server, port } = await start({ sensors: fakeSensors() });
  try {
    const bad = await request(port, { method: "PUT", path: "/api/sensors", headers: json, body: { id: "bad", ticks: {} } });
    assert.strictEqual(bad.status, 400);
    assert.match(JSON.parse(bad.text).error, /Not saved: nope/);
    assert.strictEqual((await request(port, { method: "PUT", path: "/api/sensors", headers: json, body: { id: "broken", auto: true } })).status, 502);
    assert.strictEqual((await request(port, { method: "POST", path: "/api/sensors", headers: json, body: {} })).status, 405);
    assert.strictEqual((await request(port, { method: "PUT", path: "/api/sensors", headers: { ...json, origin: "http://evil.example.com" }, body: { id: "AA", auto: true } })).status, 403);
  } finally { await server.stop(); }
});

test("a settings save and a sensors save never write the file at the same time", async () => {
  let active = 0;
  let overlapped = false;
  const slow = async (value) => { active += 1; if (active > 1) overlapped = true; await new Promise((r) => setTimeout(r, 50)); active -= 1; return value; };
  const settings = { describe: async () => ({ file: "config.json", fields: [] }), save: (changes) => slow({ saved: changes, restartNeeded: true }) };
  const sensors = { describe: async () => ({ plans: [], cameras: [] }), save: () => slow({ saved: true, restartNeeded: true }) };
  const { server, port } = await start({ settings, sensors });
  try {
    await Promise.all([
      request(port, { method: "PUT", path: "/api/settings", headers: json, body: { changes: { n: 1 } } }),
      request(port, { method: "PUT", path: "/api/sensors", headers: json, body: { id: "AA", auto: true } }),
    ]);
    assert.strictEqual(overlapped, false);
  } finally { await server.stop(); }
});
