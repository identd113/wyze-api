// Manual, read-only probe of Wyze endpoints that the library does not call yet.
// Not part of `npm test` (no network access there) — run explicitly:
//   node scripts/probe-unused-endpoints.js [outFile]
//
// Calls, against api.wyzecam.com only:
//   1. app/user/get_user_info                 account info
//   2. app/v2/device_list/get_property_list   bulk property read for all cameras
//   3. app/v2/device/get_event_list           sound, smoke, CO and other event lists
//                                             (the library only uses the motion type today)
//
// Only read methods are called. Writes the raw result to outFile (default:
// ./unused-endpoints.json) with MAC addresses removed.

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const WyzeAPI = require("../src/index");

const required = ["USERNAME", "PASSWORD", "KEY_ID", "API_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const outFile = process.argv[2] || path.join(process.cwd(), "unused-endpoints.json");

const wyze = new WyzeAPI({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: process.env.PERSIST_PATH || __dirname,
  logLevel: process.env.LOG_LEVEL || "warn",
});

// Remove every MAC-looking field so the output file is safe to keep.
// Circular references are replaced with a marker instead of recursing forever.
function scrubMacs(value, seen = new WeakSet()) {
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
  }
  if (Array.isArray(value)) return value.map((v) => scrubMacs(v, seen));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/mac/i.test(k)) continue;
      out[k] = scrubMacs(v, seen);
    }
    return out;
  }
  return value;
}

// Event codes from wyze-sdk's EventAlarmType (SOUND 2, OTHER 3, SMOKE 4, CO 5).
const EVENT_TYPES = { sound: [2], other: [3], smoke: [4], co: [5] };

async function probe(name, fn, report) {
  try {
    report[name] = { ok: true, result: await fn() };
    console.log(`${name}: OK`);
  } catch (e) {
    report[name] = { ok: false, error: e.message };
    console.log(`${name}: FAILED (${e.message})`);
  }
}

(async () => {
  await wyze.maybeLogin();
  const devices = await wyze.getDeviceList();
  const cameras = devices.filter((d) => d.product_type.toLowerCase() === "camera");
  const macs = cameras.map((c) => c.mac);
  console.log(`${cameras.length} camera(s) found`);

  const report = {};

  await probe("user_info", () => wyze.request("app/user/get_user_info", {}), report);

  await probe(
    "device_list_property_list",
    () =>
      wyze.request("app/v2/device_list/get_property_list", {
        device_list: macs,
        target_pid_list: ["P3", "P5", "P1003", "P1004", "P1005"],
      }),
    report
  );

  const end = Date.now();
  const begin = end - 7 * 24 * 60 * 60 * 1000;
  for (const [name, codes] of Object.entries(EVENT_TYPES)) {
    await probe(
      `event_list_${name}`,
      () =>
        wyze.request("app/v2/device/get_event_list", {
          device_mac_list: macs,
          event_value_list: codes,
          event_tag_list: [],
          event_type: "1",
          begin_time: begin,
          end_time: end,
          order_by: 2,
          count: 5,
        }),
      report
    );
  }

  fs.writeFileSync(outFile, JSON.stringify(scrubMacs(report), null, 2));
  console.log(`Wrote ${outFile}`);
})().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
