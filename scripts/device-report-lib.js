// Builds the report for scripts/device-report.js. Kept apart from the script so
// the tests can run it against a stand-in client, with no network.
//
// Read-only: the only client methods called are the four in READ_METHODS.

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
  ].join("|")
);

const MAC_COLON = /\b[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\1[0-9A-Fa-f]{2}){4}\b/g;
const MAC_PLAIN = /(?<![0-9A-Za-z])[0-9A-Fa-f]{12}(?![0-9A-Za-z])/g;
const MAC_AFTER_UNDERSCORE = /(?<=_)[0-9A-Fa-f]{12}(?![0-9A-Za-z])/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

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

function scrubString(s, literals = []) {
  let out = s;
  for (const lit of literals) out = out.split(lit).join("<id>");
  return out
    .replace(MAC_COLON, "<mac>")
    .replace(MAC_AFTER_UNDERSCORE, "<mac>")
    .replace(MAC_PLAIN, "<mac>")
    .replace(IPV4, "<ip>");
}

/**
 * Returns a copy of `value` with private keys removed and MAC and IPv4 patterns in
 * strings replaced. Keys are dropped, not blanked, so nothing about them is left.
 */
function scrub(value, literals = []) {
  if (typeof value === "string") return scrubString(value, literals);
  if (Array.isArray(value)) return value.map((v) => scrub(v, literals));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (PRIVATE_KEY.test(k.toLowerCase())) continue;
      out[scrubString(k, literals)] = scrub(v, literals);
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

// property name -> value, from either a list of {pid, pvalue} or a plain object
function flattenProperties(props, literals) {
  const list = Array.isArray(props) ? props : props && props.property_list;
  if (!Array.isArray(list)) return props === undefined ? undefined : scrub(props, literals);
  const out = {};
  for (const p of list) out[p.pid] = p.pvalue;
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

/**
 * @param {object} opts
 * @param {object} opts.client a logged-in WyzeAPI (or a stand-in with the READ_METHODS)
 * @param {string[]} [opts.models] only these model codes; empty means every device
 * @param {object} [opts.versions] shown at the end, for example { "wyze-api": "2.0.0" }
 * @param {object} [opts.routing] { devicemgmt: (model) => bool, runAction: (model) => bool }
 */
async function buildReport({ client: rawClient, models = [], versions = {}, routing = {} }) {
  const client = readOnly(rawClient);
  const wanted = models.map((m) => m.toUpperCase());
  const all = await client.getDeviceList();
  const devices = all.filter((d) => !wanted.length || wanted.includes(String(d.product_model).toUpperCase()));

  const literals = literalsOf(all);
  const report = { generated: new Date().toISOString(), versions, devices: [] };
  const unmatched = wanted.filter((m) => !all.some((d) => String(d.product_model).toUpperCase() === m));
  if (unmatched.length) report.noDeviceWithModel = unmatched;

  for (const [i, d] of devices.entries()) {
    const entry = { label: `device-${i + 1}`, ...pickDevice(d, literals) };
    if (routing.devicemgmt) entry.libraryUsesDevicemgmt = !!routing.devicemgmt(d.product_model);
    if (routing.runAction) entry.libraryUsesRunActionForLight = !!routing.runAction(d.product_model);

    const props = await attempt(() => client.getPropertyList(d.mac, d.product_model), literals);
    entry.propertyList = props.ok ? flattenProperties(props.result, literals) : { error: props.error, httpStatus: props.httpStatus };

    const info = await attempt(() => client.getDeviceInfo(d.mac, d.product_model), literals);
    entry.deviceInfo = info.ok ? scrub(info.result, literals) : { error: info.error, httpStatus: info.httpStatus };

    if (String(d.product_type).toLowerCase() === "camera") {
      const ownList = !!(routing.devicemgmt && routing.devicemgmt(d.product_model));
      const propsModel = ownList ? d.product_model : DEVICEMGMT_FALLBACK_MODEL;
      const dm = await attempt(() => client._deviceMgmtGetIotProp(d.mac, d.product_model, propsModel), literals);
      entry.devicemgmt = {
        propertyListUsed: propsModel,
        answered: dm.ok,
        ...(dm.ok ? { capabilities: summarizeCapabilities(dm.result, literals) } : { error: dm.error, httpStatus: dm.httpStatus, response: dm.response }),
      };
    }
    report.devices.push(entry);
  }
  return report;
}

module.exports = { READ_METHODS, DEVICEMGMT_FALLBACK_MODEL, scrub, scrubString, readOnly, buildReport };
