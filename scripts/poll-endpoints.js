// Manual, read-only poller for the confirmed endpoints (see docs/endpoints.md).
// Not part of `npm test` — run explicitly:
//   node scripts/poll-endpoints.js [outDir] [intervalSeconds=300] [count=12]
//
// Each tick reads, for every camera:
//   - app/v2/device_list/get_property_list  (property values and their change times)
//   - app/v2/device/get_event_list           (motion events in the last interval)
// It writes one snapshot per tick (MAC addresses removed) and prints every
// property whose value or change time moved since the previous tick.
//
// Only read methods are called. Never calls a setter or action method.

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

const outDir = process.argv[2] || path.join(process.cwd(), "poll");
const intervalMs = Number(process.argv[3] || 300) * 1000;
const count = Number(process.argv[4] || 12);
fs.mkdirSync(outDir, { recursive: true });

const wyze = new WyzeAPI({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: process.env.PERSIST_PATH || __dirname,
  logLevel: process.env.LOG_LEVEL || "warn",
});

// Remove every MAC-looking field so the snapshots are safe to keep.
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

// Flatten a property-list response into { "<label>/<pid>": {value, ts} }.
function flattenProperties(snapshot) {
  const flat = {};
  for (const cam of snapshot.cameras) {
    const rows = cam.properties?.data?.device_property_list || [];
    for (const row of rows) {
      flat[`${cam.label}/${row.pid}`] = { value: row.value, ts: row.ts };
    }
  }
  return flat;
}

function diff(prev, next) {
  const changes = [];
  for (const key of Object.keys(next)) {
    const before = prev[key];
    const after = next[key];
    if (!before) {
      changes.push(`${key}: new (${after.value})`);
    } else if (before.value !== after.value || before.ts !== after.ts) {
      changes.push(`${key}: ${before.value} -> ${after.value} (ts ${before.ts} -> ${after.ts})`);
    }
  }
  return changes;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  await wyze.maybeLogin();
  const devices = await wyze.getDeviceList();
  const cameras = devices.filter((d) => d.product_type.toLowerCase() === "camera");
  const macs = cameras.map((c) => c.mac);
  console.log(`Polling ${cameras.length} camera(s), ${count} tick(s), every ${intervalMs / 1000}s`);

  let previous = null;
  for (let tick = 1; tick <= count; tick++) {
    const now = Date.now();
    const snapshot = { at: new Date(now).toISOString(), cameras: [] };

    const propertyList = await wyze.request("app/v2/device_list/get_property_list", {
      device_list: macs,
      target_pid_list: ["P1", "P3", "P5", "P1001", "P1003", "P1004", "P1005", "P1047", "P1048", "P1049", "P1050", "P1056", "P1078", "P1073", "P1074"],
    });
    // Label by position: the response keeps the request's order (camera-1 is the first MAC).
    const perDevice = propertyList.data?.data?.device_list || [];
    perDevice.forEach((row, i) => {
      snapshot.cameras.push({
        label: `camera-${i + 1}`,
        properties: { data: { device_property_list: row.device_property_list || [] } },
      });
    });

    const events = await wyze.request("app/v2/device/get_event_list", {
      device_mac_list: macs,
      event_value_list: [1, 6, 7, 13],
      event_tag_list: [],
      event_type: "1",
      begin_time: now - intervalMs,
      end_time: now,
      order_by: 2,
      count: 20,
    });
    snapshot.motionEvents = events.data?.data?.event_list?.length ?? 0;

    const file = path.join(outDir, `snapshot-${snapshot.at.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(scrubMacs(snapshot), null, 2));

    const flat = flattenProperties(snapshot);
    if (previous) {
      const changes = diff(previous, flat);
      console.log(`tick ${tick} ${snapshot.at}: ${changes.length} change(s), ${snapshot.motionEvents} motion event(s)`);
      for (const c of changes) console.log(`  ${c}`);
    } else {
      console.log(`tick ${tick} ${snapshot.at}: baseline, ${snapshot.motionEvents} motion event(s)`);
    }
    previous = flat;

    if (tick < count) await sleep(intervalMs);
  }
  console.log(`Done. Snapshots in ${outDir}`);
})().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
