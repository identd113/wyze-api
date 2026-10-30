// Manual, read-only probe of camera property IDs against the real Wyze servers.
// Not part of `npm test` (no network access there) — run explicitly:
//   node scripts/probe-camera-properties.js [outFile]
//
// Reads each camera's property list (app/v2/device/get_property_list) and
// device info (app/v2/device/get_device_Info) and writes the raw result to
// outFile (default: ./camera-properties.json). MACs are replaced with
// camera-1, camera-2, ... in the output so they do not end up in logs.
//
// Only read methods are called. Never calls setProperty, setPropertyList or
// any other state-changing method.

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

const outFile = process.argv[2] || path.join(process.cwd(), "camera-properties.json");

const wyze = new WyzeAPI({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: process.env.PERSIST_PATH || __dirname,
  logLevel: process.env.LOG_LEVEL || "warn",
});

// Remove every MAC-looking field so the output file is safe to keep.
function scrubMacs(value) {
  if (Array.isArray(value)) return value.map(scrubMacs);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/mac/i.test(k)) continue;
      out[k] = scrubMacs(v);
    }
    return out;
  }
  return value;
}

(async () => {
  await wyze.maybeLogin();
  const devices = await wyze.getDeviceList();
  const cameras = devices.filter((d) => d.product_type.toLowerCase() === "camera");
  console.log(`${cameras.length} camera(s) found`);

  const report = [];
  for (const [i, cam] of cameras.entries()) {
    const label = `camera-${i + 1}`;
    const entry = { label, model: cam.product_model, nickname: cam.nickname };
    try {
      entry.properties = await wyze.getPropertyList(cam.mac, cam.product_model);
    } catch (e) {
      entry.propertiesError = e.message;
    }
    try {
      entry.deviceInfo = await wyze.getDeviceInfo(cam.mac, cam.product_model);
    } catch (e) {
      entry.deviceInfoError = e.message;
    }
    console.log(
      `${label} (${cam.product_model}): properties ${entry.propertiesError ? "FAILED" : "OK"}, ` +
        `device info ${entry.deviceInfoError ? "FAILED" : "OK"}`
    );
    report.push(entry);
  }

  fs.writeFileSync(outFile, JSON.stringify(scrubMacs(report), null, 2));
  console.log(`Wrote ${outFile}`);
})().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
