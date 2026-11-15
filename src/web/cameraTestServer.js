"use strict";

/**
 * A small web page for testing a Wyze account's cameras from a browser.
 *
 * It exists because a browser cannot speak the camera protocol (UDP, DTLS): the server does, and the page
 * shows the steps and answers. The server has to run on a computer on the same network as the cameras, for
 * example the machine that runs Homebridge.
 *
 * What it can do
 *   - list the account's cameras (name, model, firmware, and whether the local session can reach them);
 *   - run the read-only test of one camera, with progress, and show what it answered;
 *   - set night vision (on, off, auto) on one camera, only when the request says `confirm: true`.
 *
 * How it is protected. It can change a camera setting, so it is not open to the world:
 *   - every request must carry the random token (header `X-Test-Token`; the page takes it from the link);
 *   - only clients on the same network are served: loopback and private addresses, never a public one, and
 *     never a request that carries a proxy header (so it does not work behind a tunnel or a reverse proxy);
 *   - the `Host` header must be an IP address, `localhost`, a name without dots or a `.local` name, which
 *     stops a web page on the internet from reaching it through DNS rebinding;
 *   - a browser page on another origin is refused (`Origin` and `Sec-Fetch-Site` are checked);
 *   - one test or change runs at a time, and repeated wrong tokens are blocked for a while.
 * Plain HTTP on your own network: do not forward the port to the internet.
 *
 * The port. 0 or unset means the server is off. A port from 1 to 1023 is refused, because those need
 * root on most systems. Use validateWebPort() for a value from a config file.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const tutk = require("../tutk/client");
const { buildIssueUrl, buildDeviceIssueUrl } = require("./issueLink");
const { buildReport } = require("../deviceReport");

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const MAX_BODY = 2048;
// Wrong tokens before the block. The token has 144 bits, so guessing is hopeless; the block is a second line of defence,
// and it is not tight, because a page left open across a Homebridge restart sends the old token a few times.
const AUTH_FAILURES_BEFORE_BLOCK = 20;
const AUTH_BLOCK_MS = 10 * 60 * 1000;
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip", "cf-connecting-ip", "cf-ray", "via"];

/**
 * Checks a port from a config file. Returns { enabled: false } for 0 or an unset value, and
 * { enabled: true, port } for a good one; { enabled: false, error } when the value is not usable.
 */
function validateWebPort(value) {
  if (value === undefined || value === null || value === "" || value === 0 || value === "0") return { enabled: false };
  const port = typeof value === "number" ? value : /^\d+$/.test(String(value).trim()) ? Number(String(value).trim()) : NaN;
  if (!Number.isInteger(port)) return { enabled: false, error: `web server port must be a whole number, not ${JSON.stringify(value)}` };
  if (port < 0 || port > MAX_PORT) return { enabled: false, error: `web server port must be 0 (off) or ${MIN_PORT} to ${MAX_PORT}, not ${port}` };
  if (port < MIN_PORT) return { enabled: false, error: `web server port ${port} is below ${MIN_PORT}, which needs root; use ${MIN_PORT} or higher, or 0 to turn it off` };
  return { enabled: true, port };
}

// ---- who may talk to it ----

function isPrivateAddress(address) {
  let a = String(address || "");
  if (a.startsWith("::ffff:")) a = a.slice(7); // an IPv4 client on a dual-stack socket
  if (net.isIPv4(a)) {
    const [p, q] = a.split(".").map(Number);
    return p === 127 || p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254);
  }
  if (net.isIPv6(a)) {
    const lower = a.toLowerCase();
    return lower === "::1" || /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower);
  }
  return false;
}

function isAllowedHost(hostHeader) {
  if (!hostHeader) return false;
  let host = hostHeader;
  if (host.startsWith("[")) host = host.slice(1, host.indexOf("]")); // [::1]:8099
  else if (host.includes(":") && net.isIPv4(host.split(":")[0])) host = host.split(":")[0];
  else if (host.split(":").length === 2) host = host.split(":")[0];
  host = host.toLowerCase();
  if (net.isIP(host)) return true;
  if (host === "localhost" || host.endsWith(".local")) return true;
  return /^[a-z0-9-]+$/.test(host); // a single name, such as the computer's host name
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return false;
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  }
  return out;
}

// ---- the page ----

let pageTemplate = null;
function page(nonce) {
  if (!pageTemplate) pageTemplate = fs.readFileSync(path.join(__dirname, "cameraTestPage.html"), "utf8");
  return pageTemplate.replace(/__NONCE__/g, nonce);
}

// ---- the server ----

/**
 * @param {object} opts
 * @param {object} opts.client a logged-in WyzeAPI (it needs getDeviceList())
 * @param {number} opts.port 1024 to 65535 (0 only with `ephemeral: true`, for tests)
 * @param {{info?: Function, warn?: Function, error?: Function}} [opts.log]
 * @param {string} [opts.host] the address to listen on; default every address
 * @param {string} [opts.token] default: random
 * @param {Function} [opts.probe] default tutk.probeCamera
 * @param {Function} [opts.setNightVision] default: the client's setCameraNightVision (which shares its per-camera queue), else tutk.setNightVision
 * @param {boolean} [opts.ephemeral] tests only: let the system pick a port
 * @param {boolean} [opts.privateClientsOnly] default true
 * @param {{describe: Function}} [opts.settings] the host's settings, kept in its own config file, shown read-only.
 *   describe() resolves to { file, fields: [{ key, title, type, description, default, minimum, maximum, value, running, pending }] }
 *   read from that file now. The page keeps no copy and never writes: the host's own settings screen does the changing.
 *   Without it the page has no settings tab.
 * @param {{describe: Function}} [opts.sensors] the host's per-camera sensor choices, shown read-only. describe() resolves to
 *   { plans: [{ text, soon }], cameras: [{ id, name, model, plan, planActive, setting, notAuto,
 *   items: [{ key, label, ai, checked, blocked, warning, tag, other }], unnamed }] } read from the file now.
 *   Without it the page has no sensors tab.
 * @param {(device: object) => boolean} [opts.unsupported] true for a device from the Wyze device list that the host has no
 *   support for. With it, the page has an "Other devices" tab listing them, each with a Test button that reads what Wyze
 *   knows about the device (read only; see src/deviceReport.js) and makes a link to the issue form with it filled in.
 * @param {(model: string) => string|undefined} [opts.describeDevice] what the host already knows about a model code (one
 *   sentence), shown on that device's card
 * @param {object} [opts.versions] shown in the report, for example { plugin: "2.0.0" }
 * @param {Function} [opts.deviceReport] default buildReport (src/deviceReport.js); tests give a stand-in
 * @param {object} [opts.issueForm] { url, template, origin, plugin, kind, deviceLabel(model) }: when given, a finished
 *   test comes with a link that opens that GitHub issue form with the test's findings filled in (see issueLink.js)
 */
function createCameraTestServer({
  client, port, log = {}, host = "0.0.0.0", token = crypto.randomBytes(18).toString("hex"),
  probe = tutk.probeCamera, setNightVision = null, ephemeral = false, privateClientsOnly = true, issueForm = null, settings = null, sensors = null,
  unsupported = null, describeDevice = null, versions = {}, deviceReport = buildReport,
}) {
  if (!client || typeof client.getDeviceList !== "function") throw new Error("createCameraTestServer needs a client with getDeviceList()");
  if (!ephemeral) {
    const v = validateWebPort(port);
    if (!v.enabled) throw new Error(v.error || "web server port is 0 (off)");
    port = v.port;
  }
  const say = (level, msg) => { if (typeof log[level] === "function") log[level](`[Web] ${msg}`); };
  const tokenBuf = Buffer.from(token);
  const failures = new Map(); // address -> { count, until }
  let busy = false;
  let cameras = []; // the last device list, in the order shown
  let others = []; // the devices the host does not support, in the order shown

  const tokenOk = (given) => {
    if (typeof given !== "string") return false;
    const b = Buffer.from(given);
    return b.length === tokenBuf.length && crypto.timingSafeEqual(b, tokenBuf);
  };

  async function loadCameras() {
    const list = await client.getDeviceList();
    cameras = list.filter((d) => String(d.product_type).toLowerCase() === "camera");
    return cameras.map((d, i) => ({
      id: `cam-${i + 1}`,
      name: d.nickname,
      model: d.product_model,
      firmware: d.firmware_ver,
      reason: tutk.cameraLocalSkipReason(d) || null,
      issueUrl: buildIssueUrl(issueForm, { model: d.product_model, firmware: d.firmware_ver }, null),
    }));
  }

  async function loadOthers() {
    const list = await client.getDeviceList();
    others = list.filter((d) => unsupported(d));
    return others.map((d, i) => ({
      id: `dev-${i + 1}`,
      name: d.nickname,
      model: d.product_model,
      type: d.product_type,
      firmware: d.firmware_ver,
      connected: d.conn_state === 1,
      known: (typeof describeDevice === "function" && describeDevice(d.product_model)) || null,
      issueUrl: buildDeviceIssueUrl(issueForm, { model: d.product_model, type: d.product_type, firmware: d.firmware_ver }, null),
    }));
  }

  // The host's client keeps one conversation per camera at a time (its own night vision reads and switches use the
  // same queue), so a test or a change from this page waits for those instead of colliding with them.
  const oneAtATime = (mac, job) => (typeof client._oneAtATime === "function" ? client._oneAtATime(mac, job) : job());
  const changeNightVision = (mac, args) => {
    if (setNightVision) return setNightVision(args);
    return typeof client.setCameraNightVision === "function" ? client.setCameraNightVision(mac, args.value) : tutk.setNightVision(args);
  };

  const findOther = async (id) => {
    if (!others.length) await loadOthers();
    const m = /^dev-(\d+)$/.exec(id);
    return m ? others[Number(m[1]) - 1] : undefined;
  };

  // What the report found, as short lines for the page.
  function reportSteps(entry) {
    const steps = [];
    const ep = entry.endpoints || {};
    const answered = (part) => part && !part.error && !part.skipped;
    steps.push({ name: "Property list", endpoint: ep.propertyList, ok: answered(entry.propertyList), detail: answered(entry.propertyList) ? `${Object.keys(entry.propertyList).length} properties` : (entry.propertyList && entry.propertyList.error) || "no answer" });
    steps.push({ name: "Device info", endpoint: ep.deviceInfo, ok: answered(entry.deviceInfo), detail: answered(entry.deviceInfo) ? "answered" : (entry.deviceInfo && entry.deviceInfo.error) || "no answer" });
    if (entry.devicemgmt) steps.push({ name: "Devicemgmt read", endpoint: ep.devicemgmt, ok: !!entry.devicemgmt.answered, detail: entry.devicemgmt.answered ? `${Object.keys(entry.devicemgmt.capabilities || {}).length} capabilities` : entry.devicemgmt.error || "no answer" });
    if (entry.local) {
      const ok = !!(entry.local.authenticated);
      steps.push({ name: "Direct local session", endpoint: ep.local, ok, detail: entry.local.skipped ? entry.local.skipped : ok ? `${Object.values(entry.local.answers || {}).filter((a) => a.answer).length} commands answered` : entry.local.error || "did not authenticate" });
    }
    return steps;
  }

  const findCamera = async (id) => {
    if (!cameras.length) await loadCameras();
    const m = /^cam-(\d+)$/.exec(id);
    return m ? cameras[Number(m[1]) - 1] : undefined;
  };

  const secure = (res, extra = {}) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  };
  const sendJson = (res, status, body) => {
    secure(res, { "Content-Type": "application/json; charset=utf-8" });
    res.writeHead(status);
    res.end(JSON.stringify(body));
  };
  const sendText = (res, status, text) => {
    secure(res, { "Content-Type": "text/plain; charset=utf-8" });
    res.writeHead(status);
    res.end(text);
  };

  function readJson(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) return reject(Object.assign(new Error("send JSON"), { status: 415 }));
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (_) { reject(Object.assign(new Error("not valid JSON"), { status: 400 })); }
      });
      req.on("error", reject);
    });
  }

  async function handle(req, res) {
    const address = req.socket.remoteAddress;
    const url = new URL(req.url, "http://placeholder");

    if (privateClientsOnly && !isPrivateAddress(address)) return sendText(res, 403, "Only clients on the local network are served.");
    if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return sendText(res, 403, "This page does not work behind a proxy or tunnel.");
    if (!isAllowedHost(req.headers.host)) return sendText(res, 403, "Open this page by the computer's IP address or its local name.");

    const block = failures.get(address);
    if (block && block.until > Date.now() && block.count >= AUTH_FAILURES_BEFORE_BLOCK) return sendText(res, 429, "Too many wrong tokens. Try again later.");

    const isApi = url.pathname.startsWith("/api/");
    const given = isApi ? req.headers["x-test-token"] : url.searchParams.get("token");
    if (!tokenOk(given)) {
      const f = failures.get(address) || { count: 0, until: 0 };
      f.count = f.until > Date.now() ? f.count + 1 : 1;
      f.until = Date.now() + AUTH_BLOCK_MS;
      failures.set(address, f);
      say("warn", `refused a request from ${address}: missing or wrong token`);
      return sendText(res, 401, "Open the link printed in the log. It ends with ?token=...");
    }
    failures.delete(address);

    if (req.method === "GET" && url.pathname === "/") {
      const nonce = crypto.randomBytes(12).toString("base64");
      secure(res, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      res.writeHead(200);
      return res.end(page(nonce));
    }

    if (!isApi) return sendText(res, 404, "Not found");
    if (!sameOrigin(req)) return sendText(res, 403, "Cross-origin request refused.");

    if (req.method === "GET" && url.pathname === "/api/cameras") {
      try { return sendJson(res, 200, { cameras: await loadCameras() }); } catch (e) {
        say("error", `could not read the device list: ${e.message}`);
        return sendJson(res, 502, { error: "could not read the device list from Wyze" });
      }
    }

    if (url.pathname === "/api/settings") {
      if (!settings) return sendJson(res, 404, { error: "this page has no settings" });
      if (req.method === "GET") {
        try { return sendJson(res, 200, { settings: await settings.describe() }); } catch (e) {
          say("warn", `could not read the settings: ${e.message}`);
          return sendJson(res, 502, { error: e.message });
        }
      }
      return sendText(res, 405, "Method not allowed");
    }

    if (url.pathname === "/api/sensors") {
      if (!sensors) return sendJson(res, 404, { error: "this page has no sensors panel" });
      if (req.method === "GET") {
        try { return sendJson(res, 200, { sensors: await sensors.describe() }); } catch (e) {
          say("warn", `could not read the sensors: ${e.message}`);
          return sendJson(res, 502, { error: e.message });
        }
      }
      return sendText(res, 405, "Method not allowed");
    }

    if (url.pathname === "/api/devices") {
      if (!unsupported) return sendJson(res, 404, { error: "this page has no other-devices tab" });
      if (req.method !== "GET") return sendText(res, 405, "Method not allowed");
      try { return sendJson(res, 200, { devices: await loadOthers() }); } catch (e) {
        say("error", `could not read the device list: ${e.message}`);
        return sendJson(res, 502, { error: "could not read the device list from Wyze" });
      }
    }

    const dm = /^\/api\/devices\/(dev-\d+)\/report$/.exec(url.pathname);
    if (dm) {
      if (!unsupported) return sendJson(res, 404, { error: "this page has no other-devices tab" });
      if (req.method !== "POST") return sendText(res, 405, "Method not allowed");
      const device = await findOther(dm[1]);
      if (!device) return sendJson(res, 404, { error: "no such device" });
      if (busy) return sendJson(res, 409, { error: "another test is running; wait for it to finish" });
      busy = true;
      try {
        const report = await deviceReport({
          client,
          select: (d) => d.mac === device.mac,
          versions,
          routing: { devicemgmt: (m) => (typeof client.cameraUsesDeviceMgmt === "function" ? client.cameraUsesDeviceMgmt(m) : false) },
          localProbe: (camera) => oneAtATime(camera.mac, () => probe(camera)),
        });
        const entry = report.devices[0];
        if (!entry) return sendJson(res, 404, { error: "that device is no longer on the account" });
        const info = { model: device.product_model, type: device.product_type, firmware: device.firmware_ver };
        say("info", `collected a report for a ${device.product_model} (${device.product_type})`);
        return sendJson(res, 200, {
          done: true,
          steps: reportSteps(entry),
          report: { generated: report.generated, versions: report.versions, device: entry },
          issueUrl: buildDeviceIssueUrl(issueForm, info, entry),
        });
      } catch (e) {
        say("warn", `could not collect a report: ${e.message}`);
        return sendJson(res, 502, { error: `could not collect a report: ${e.message}` });
      } finally {
        busy = false;
      }
    }

    const m = /^\/api\/cameras\/(cam-\d+)\/(test|night-vision)$/.exec(url.pathname);
    if (m && req.method === "POST") {
      const cam = await findCamera(m[1]);
      if (!cam) return sendJson(res, 404, { error: "no such camera" });
      const why = tutk.cameraLocalSkipReason(cam);
      if (why) return sendJson(res, 422, { error: `cannot test this camera: ${why}` });
      const target = { host: cam.device_params.ip, uid: cam.device_params.p2p_id, enr: cam.enr, mac: cam.mac };

      // A change reads and checks its body first. The one test slot is taken right after the check, with no await in
      // between, so two requests (a double click, two tabs) cannot both pass it.
      let body;
      if (m[2] === "night-vision") {
        try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
        if (body.confirm !== true) return sendJson(res, 400, { error: "changing a setting needs confirm: true" });
        if (!["on", "off", "auto"].includes(body.value)) return sendJson(res, 400, { error: "value must be on, off or auto" });
      }
      if (busy) return sendJson(res, 409, { error: "another test is running; wait for it to finish" });

      if (m[2] === "test") {
        busy = true;
        secure(res, { "Content-Type": "application/x-ndjson; charset=utf-8" });
        res.writeHead(200);
        const send = (obj) => { if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`); };
        say("info", `testing ${cam.nickname} (${cam.product_model})`);
        try {
          const result = await oneAtATime(cam.mac, () => probe({ ...target, onStep: (step) => send({ event: "step", step }) }));
          send({ event: "done", result, issueUrl: buildIssueUrl(issueForm, { model: cam.product_model, firmware: cam.firmware_ver }, result) });
          say("info", `${cam.nickname}: ${result.authenticated ? "authenticated" : `failed (${result.error || "no answer"})`}`);
        } catch (e) {
          send({ event: "done", result: { error: e.message } });
        } finally {
          busy = false;
          res.end();
        }
        return undefined;
      }

      busy = true;
      say("info", `setting night vision of ${cam.nickname} to ${body.value}`);
      try {
        const result = await oneAtATime(cam.mac, () => changeNightVision(cam.mac, { ...target, value: body.value }));
        say("info", `${cam.nickname}: night vision ${result.before} -> ${result.after}${result.matches ? "" : " (did not match)"}`);
        return sendJson(res, 200, result);
      } catch (e) {
        say("warn", `${cam.nickname}: night vision change failed: ${e.message}`);
        return sendJson(res, 502, { error: e.message });
      } finally {
        busy = false;
      }
    }
    return sendText(res, 404, "Not found");
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      say("error", `request failed: ${e.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.end();
    });
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 120000;

  return {
    token,
    /** Starts listening. Resolves to { port, urls } where each url includes the token. */
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(ephemeral ? 0 : port, host, () => {
          server.off("error", reject);
          const actual = server.address().port;
          const hosts = host === "0.0.0.0" || host === "::" ? ["localhost", ...lanAddresses()] : [host];
          resolve({ port: actual, urls: hosts.map((h) => `http://${h}:${actual}/?token=${token}`) });
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}

module.exports = { createCameraTestServer, validateWebPort, isPrivateAddress, isAllowedHost, MIN_PORT, MAX_PORT };
