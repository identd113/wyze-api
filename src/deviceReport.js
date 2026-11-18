// Builds the report for scripts/device-report.js and the camera test page's "other devices" tab. Kept apart
// from them so the tests can run it against a stand-in client, with no network.
//
// Read-only: the only client methods called are the four in READ_METHODS.

const constants = require("./constants");
const devicemgmtProps = require("./util/devicemgmtProps");

// The calls a report makes, so the report says which endpoint each answer came from. The paths are the ones the client
// uses for getPropertyList and getDeviceInfo (a test keeps them in step), and the devicemgmt host and path of
// _deviceMgmtGetIotProp. Every one is a read.
const ENDPOINTS = {
  propertyList: `POST ${constants.apiBaseUrl}/app/v2/device/get_property_list`,
  deviceInfo: `POST ${constants.apiBaseUrl}/app/v2/device/get_device_Info`,
  devicemgmt: `POST ${constants.devicemgmtBaseUrl}/device-management/api/device-property/get_iot_prop`,
  local: "directly to the camera on your network (UDP port 32761, the TUTK protocol), read-only get commands",
};

const READ_METHODS = ["getDeviceList", "getPropertyList", "getDeviceInfo", "_deviceMgmtGetIotProp"];

// Models without a property list of their own are asked with this one (Floodlight Pro).
const DEVICEMGMT_FALLBACK_MODEL = "LD_CFP";

// Keys whose values are personal or identify the account, home or device. Matched
// on the lower-cased key name.
const PRIVATE_KEY = new RegExp(
  [
    "mac", "nickname", "ssid", "^ip$", "^ip_", "_ip$", "ipaddr", "^enr$", "^sn$", "email", "user", "phone",
    "token", "password", "secret", "apikey", "api_key", "key_id", "ticket", "latitude", "longitude",
    "^lat$", "^lon$", "^lng$", "address", "^did$", "device_id", "^uid$", "cloud_id", "^id$", "authorization",
    "p2p", "url", "thumbnail", "timezone",
    "serial", "uuid", "guid", "traceid", "request_id", "requestid", "home_id", "homeid", "group_id", "parent_id", "owner", "city", "zip", "postal", "street",
  ].join("|")
);

// Ordinary words that contain a private pattern ("capacity" has "city", "microphone" has "phone", "velocity" has "city").
// They are taken out of a key before it is tested, so `microphone` is kept and `microphone_ip` is still dropped.
const HARMLESS_WORDS = /capacity|microphone|velocity/g;

const MAC_COLON = /\b[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\1[0-9A-Fa-f]{2}){4}\b/g;
const MAC_PLAIN = /(?<![0-9A-Za-z])[0-9A-Fa-f]{12}(?![0-9A-Za-z])/g;
const MAC_AFTER_UNDERSCORE = /(?<=_)[0-9A-Fa-f]{12}(?![0-9A-Za-z])/g;
const IPV6 = /(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})/gi;
const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;
// A version number such as 4.53.2.1 has the shape of an IPv4 address. Under these keys it is kept.
// A key such as "fw_ver", "version" or "hwver". "server" and "driver" also end in "ver" and are not versions.
const VERSION_KEY = /(^|_)(fw|firmware|ver|version)(_|$)|(hw|sw|fw)ver$/;

// Values the device list itself gives for this account (MAC, name, Wi-Fi name, IP, serial,
// P2P id), found wherever they turn up in another answer. Short ones are ignored.
function literalsOf(devices) {
  const found = new Set();
  const keys = /mac|nickname|ssid|^ip$|^enr$|^sn$|p2p|device_id/i;
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && v.length >= 4 && keys.test(k)) found.add(v);
      else walk(v);
    }
  };
  walk(devices);
  // longest first, so a name that contains a shorter one is replaced whole
  return [...found].sort((a, b) => b.length - a.length);
}

function scrubString(s, literals = [], keepVersions = false) {
  let out = s;
  for (const lit of literals) out = out.split(lit).join("<id>");
  out = out
    .replace(MAC_COLON, "<mac>")
    .replace(MAC_AFTER_UNDERSCORE, "<mac>")
    .replace(MAC_PLAIN, "<mac>")
    .replace(IPV6, "<ip>"); // never a version, so it is hidden even where versions are kept
  return keepVersions ? out : out.replace(IPV4, "<ip>");
}

/**
 * Returns a copy of `value` with private keys removed and MAC and IPv4 patterns in
 * strings replaced. Keys are dropped, not blanked, so nothing about them is left.
 */
function scrub(value, literals = [], keepVersions = false) {
  if (typeof value === "string") return scrubString(value, literals, keepVersions);
  if (Array.isArray(value)) return value.map((v) => scrub(v, literals, keepVersions));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const lower = k.toLowerCase();
      if (PRIVATE_KEY.test(lower.replace(HARMLESS_WORDS, ""))) continue;
      out[scrubString(k, literals)] = scrub(v, literals, VERSION_KEY.test(lower));
    }
    return out;
  }
  return value;
}

function describeError(e, literals) {
  const out = { error: scrubString(String(e && e.message ? e.message : e), literals) };
  if (e && e.response) {
    out.httpStatus = e.response.status;
    out.response = scrub(e.response.data, literals);
  }
  return out;
}

async function attempt(fn, literals) {
  try {
    return { ok: true, result: await fn() };
  } catch (e) {
    return { ok: false, ...describeError(e, literals) };
  }
}

// property name -> value, from Wyze's answer ({ data: { property_list: [{ pid, value }] } }), a bare
// { property_list } or a plain list of rows, or a plain object. Older callers and tests used `pvalue`.
function flattenProperties(props, literals) {
  const list = Array.isArray(props) ? props : props && (props.data && props.data.property_list || props.property_list);
  if (!Array.isArray(list)) return props === undefined ? undefined : scrub(props, literals);
  const out = {};
  for (const p of list) out[p.pid] = scrub(p.value !== undefined ? p.value : p.pvalue, literals);
  return out;
}

// capability name -> { property: value }, from a devicemgmt get_iot_prop answer
function summarizeCapabilities(answer, literals) {
  const caps = answer && answer.data && answer.data.capabilities;
  if (!Array.isArray(caps)) return { code: answer && answer.code, message: answer && scrub(answer.message, literals) };
  const out = {};
  for (const c of caps) out[c.name] = scrub(c.properties || {}, literals);
  return out;
}

// Every capability group any of our devicemgmt lists names, with the union of its property names (the first
// list to name a group sets its iid). Capability discovery asks for all of them at once.
function discoveryGroups() {
  const byName = new Map();
  for (const list of Object.values(devicemgmtProps)) {
    for (const g of list) {
      const have = byName.get(g.name);
      if (!have) byName.set(g.name, { iid: g.iid, name: g.name, properties: [...g.properties] });
      else for (const p of g.properties) if (!have.properties.includes(p)) have.properties.push(p);
    }
  }
  return [...byName.values()];
}
const DISCOVERY_GROUPS = discoveryGroups();

// Wyze rejects a devicemgmt request that names a group the device lacks, with HTTP 400 and the first such group
// in the message ("unsupported capability camera-ai").
// A short wait between the asks for one device (a device that rejects groups takes up to eleven), so discovery
// never sends a burst at Wyze.
const DISCOVERY_PAUSE_MS = 300;

const UNSUPPORTED_GROUP = /unsupported capability ([A-Za-z0-9_-]+)/;

/**
 * Which devicemgmt capability groups does this device have? Asks for every group at once. Some devices (the
 * Doorbell v2's chime) reject the whole ask, naming the first group they lack; that group is left out of the
 * next ask, until the answer comes back whole. At most one ask per group, plus the last. Most devices accept
 * every group and answer null for what they lack, so an accepted group proves nothing: `withValues` lists the
 * groups that came back with a value, and `accepted` has the property names that did. Works for any device, not
 * only cameras. Records group and property NAMES only, never the values.
 */
async function discoverCapabilities(client, d, literals, pauseMs = DISCOVERY_PAUSE_MS) {
  let groups = DISCOVERY_GROUPS;
  const rejected = [];
  let requests = 0;
  while (groups.length && requests <= DISCOVERY_GROUPS.length) {
    if (requests && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs)); // be gentle with Wyze
    requests += 1;
    const r = await attempt(() => client._deviceMgmtGetIotProp(d.mac, d.product_model, DEVICEMGMT_FALLBACK_MODEL, groups), literals);
    if (r.ok) {
      const accepted = {};
      const caps = r.result && r.result.data && r.result.data.capabilities;
      for (const c of Array.isArray(caps) ? caps : []) {
        accepted[c.name] = Object.entries(c.properties || {}).filter(([, v]) => v !== null && v !== undefined).map(([k]) => k);
      }
      const withValues = Object.keys(accepted).filter((g) => accepted[g].length);
      return { requests, withValues, accepted, rejected };
    }
    const named = UNSUPPORTED_GROUP.exec(JSON.stringify(r.response === undefined ? r.error : r.response));
    if (!named || !groups.some((g) => g.name === named[1])) {
      return { requests, withValues: [], accepted: {}, rejected, stopped: { error: r.error, httpStatus: r.httpStatus, response: r.response } };
    }
    rejected.push(named[1]);
    groups = groups.filter((g) => g.name !== named[1]);
  }
  return { requests, withValues: [], accepted: {}, rejected };
}

function pickDevice(d, literals) {
  return {
    model: d.product_model,
    type: d.product_type,
    firmware: d.firmware_ver,
    connected: d.conn_state,
    params: scrub(d.device_params || {}, literals),
  };
}

/**
 * A view of the client that offers only READ_METHODS. Anything else throws, so a
 * change to this script cannot start writing without a test failing.
 */
function readOnly(client) {
  const view = {};
  for (const name of READ_METHODS) view[name] = (...args) => client[name](...args);
  return new Proxy(view, {
    get(target, prop) {
      if (prop in target) return target[prop];
      throw new Error(`device report may only call ${READ_METHODS.join(", ")}; tried ${String(prop)}`);
    },
  });
}

const { cameraLocalSkipReason: localSkipReason } = require("./tutk/client");

async function localSection(d, probe, literals) {
  const why = localSkipReason(d);
  if (why) return { skipped: why };
  const p = d.device_params;
  try {
    const result = await probe({ host: p.ip, uid: p.p2p_id, enr: d.enr, mac: d.mac, model: d.product_model });
    return scrub(result, literals);
  } catch (e) {
    return { error: scrubString(String(e && e.message ? e.message : e), literals) };
  }
}

/**
 * @param {object} opts
 * @param {object} opts.client a logged-in WyzeAPI (or a stand-in with the READ_METHODS)
 * @param {string[]} [opts.models] only these model codes; empty means every device
 * @param {(device: object) => boolean} [opts.select] only the devices this returns true for (one device, for the test page)
 * @param {object} [opts.versions] shown at the end, for example { "wyze-api": "2.0.0" }
 * @param {object} [opts.routing] { devicemgmt: (model) => bool, runAction: (model) => bool }
 * @param {(info: {model: string, requests: number, rejected: number}) => void} [opts.onDiscovery] told once per
 *   device after its discovery, so the host can log how many reads it made
 * @param {number} [opts.discoveryPauseMs] wait between the asks for one device (default 300)
 * @param {boolean} [opts.discovery] ask devicemgmt which capability groups each device has. Off unless asked for
 *   (`--discovery`, or the box on the camera test page): it is one to eleven extra reads per device.
 * @param {(camera: object) => Promise<object>} [opts.localProbe] for each camera that has the dtls flag
 *   and an address, opens a read-only local session and returns what it answered. It gets the raw device
 *   (with its keys), so what it returns is scrubbed here like everything else. Left out unless asked for.
 */
async function buildReport({ client: rawClient, models = [], select = null, versions = {}, routing = {}, discovery = false, onDiscovery = null, discoveryPauseMs = DISCOVERY_PAUSE_MS, localProbe = null }) {
  const client = readOnly(rawClient);
  const wanted = models.map((m) => m.toUpperCase());
  const all = await client.getDeviceList();
  const devices = all.filter((d) => (!wanted.length || wanted.includes(String(d.product_model).toUpperCase())) && (!select || select(d)));

  const literals = literalsOf(all);
  const report = { generated: new Date().toISOString(), versions, devices: [] };
  const unmatched = wanted.filter((m) => !all.some((d) => String(d.product_model).toUpperCase() === m));
  if (unmatched.length) report.noDeviceWithModel = unmatched;

  for (const [i, d] of devices.entries()) {
    const entry = { label: `device-${i + 1}`, ...pickDevice(d, literals) };
    if (routing.devicemgmt) entry.libraryUsesDevicemgmt = !!routing.devicemgmt(d.product_model);
    if (routing.runAction) entry.libraryUsesRunActionForLight = !!routing.runAction(d.product_model);

    entry.endpoints = { propertyList: ENDPOINTS.propertyList, deviceInfo: ENDPOINTS.deviceInfo };
    const props = await attempt(() => client.getPropertyList(d.mac, d.product_model), literals);
    entry.propertyList = props.ok ? flattenProperties(props.result, literals) : { error: props.error, httpStatus: props.httpStatus };

    const info = await attempt(() => client.getDeviceInfo(d.mac, d.product_model), literals);
    entry.deviceInfo = info.ok ? scrub(info.result, literals) : { error: info.error, httpStatus: info.httpStatus };

    if (String(d.product_type).toLowerCase() === "camera") {
      const ownList = !!(routing.devicemgmt && routing.devicemgmt(d.product_model));
      const propsModel = ownList ? d.product_model : DEVICEMGMT_FALLBACK_MODEL;
      entry.endpoints.devicemgmt = ENDPOINTS.devicemgmt;
      const dm = await attempt(() => client._deviceMgmtGetIotProp(d.mac, d.product_model, propsModel), literals);
      entry.devicemgmt = {
        propertyListUsed: propsModel,
        answered: dm.ok,
        ...(dm.ok ? { capabilities: summarizeCapabilities(dm.result, literals) } : { error: dm.error, httpStatus: dm.httpStatus, response: dm.response }),
      };
    }
    if (discovery) {
      entry.endpoints.devicemgmt = ENDPOINTS.devicemgmt;
      entry.capabilityDiscovery = await discoverCapabilities(client, d, literals, discoveryPauseMs);
      if (onDiscovery) onDiscovery({ model: d.product_model, requests: entry.capabilityDiscovery.requests, rejected: entry.capabilityDiscovery.rejected.length });
    }
    if (localProbe && String(d.product_type).toLowerCase() === "camera") {
      entry.endpoints.local = ENDPOINTS.local;
      entry.local = await localSection(d, localProbe, literals);
    }
    report.devices.push(entry);
  }
  return report;
}

module.exports = { ENDPOINTS, localSkipReason, READ_METHODS, DEVICEMGMT_FALLBACK_MODEL, DISCOVERY_GROUPS, DISCOVERY_PAUSE_MS, discoverCapabilities, scrub, scrubString, flattenProperties, readOnly, buildReport };
