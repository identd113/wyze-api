// Manual, read-only calls to the unused api.wyzecam.com endpoints that accept POST and
// do not change state. Not part of `npm test` — run explicitly:
//   node scripts/probe-unused-reads.js [outFile]
//
// Calls:
//   - app/device/get_device_info          (per camera)
//   - app/v2/device_group/timer/get       (per device group, action_type 1 and 2)
// Never calls change_password, logout, set_read_state_list, update_user_profile
// or any other write. Writes raw results to outFile with MAC addresses removed.

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

const outFile = process.argv[2] || path.join(process.cwd(), "unused-reads.json");

const wyze = new WyzeAPI({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: process.env.PERSIST_PATH || __dirname,
  logLevel: process.env.LOG_LEVEL || "warn",
});

// Remove every MAC-looking field and guard against circular references.
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

(async () => {
  await wyze.maybeLogin();
  const devices = await wyze.getDeviceList();
  const cameras = devices.filter((d) => d.product_type.toLowerCase() === "camera");
  const groups = await wyze.getDeviceGroupsList();
  console.log(`${cameras.length} camera(s), ${groups.length} device group(s)`);

  const report = { deviceInfo: [], groupTimers: [] };

  for (const [i, cam] of cameras.entries()) {
    try {
      const res = await wyze.request("app/device/get_device_info", {
        device_mac: cam.mac,
        device_model: cam.product_model,
      });
      report.deviceInfo.push({ label: `camera-${i + 1}`, ok: true, response: res });
      console.log(`get_device_info camera-${i + 1}: code=${res.data?.code} msg=${res.data?.msg}`);
    } catch (e) {
      report.deviceInfo.push({ label: `camera-${i + 1}`, ok: false, error: e.message });
      console.log(`get_device_info camera-${i + 1}: FAILED (${e.message})`);
    }
  }

  for (const group of groups) {
    for (const actionType of [1, 2]) {
      try {
        const res = await wyze.request("app/v2/device_group/timer/get", {
          group_id: String(group.group_id),
          action_type: actionType,
        });
        report.groupTimers.push({ group: group.group_id, actionType, ok: true, response: res });
        console.log(`device_group/timer/get action_type=${actionType}: code=${res.data?.code} msg=${res.data?.msg}`);
      } catch (e) {
        report.groupTimers.push({ group: group.group_id, actionType, ok: false, error: e.message });
        console.log(`device_group/timer/get action_type=${actionType}: FAILED (${e.message})`);
      }
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(scrubMacs(report), null, 2));
  console.log(`Wrote ${outFile}`);
})().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
