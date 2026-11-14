// Read-only report on the devices of a Wyze account, for bug reports about a device
// that is missing or only partly works. Not part of `npm test` (it needs the network
// and your login). Run it yourself and paste the file it writes into the issue:
//   node scripts/device-report.js [--model CODE[,CODE...]] [--out FILE]
//
// Without --model it covers every device. It writes JSON (default
// ./wyze-device-report.json). Only read calls are made: the device list, each device's
// property list and device info, and for cameras the devicemgmt property read. It never
// sets, switches, deletes or logs out. MAC addresses, device names, IP addresses, the
// Wi-Fi name and account identifiers are removed from the output; read the file once
// before you post it.
//
// Login comes from USERNAME, PASSWORD, KEY_ID and API_KEY in the environment or in
// the .env file next to the package, as with the other scripts.

const fs = require("fs");
const path = require("path");

const { buildReport } = require("./device-report-lib");

const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/device-report.js [--model CODE[,CODE...]] [--out FILE]");
  process.exit(0);
}
const models = (option("--model") || "").split(",").map((m) => m.trim()).filter(Boolean);
const outFile = option("--out") || path.join(process.cwd(), "wyze-device-report.json");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
const missing = ["USERNAME", "PASSWORD", "KEY_ID", "API_KEY"].filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const WyzeAPI = require("../src/index");
const wyze = new WyzeAPI({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: process.env.PERSIST_PATH, // unset: the library default (~/.wyze-api)
  logLevel: process.env.LOG_LEVEL || "warn",
});

(async () => {
  await wyze.maybeLogin();
  const report = await buildReport({
    client: wyze,
    models,
    versions: { "wyze-api": require("../package.json").version, node: process.version },
    routing: {
      devicemgmt: (m) => wyze.cameraUsesDeviceMgmt(m),
      runAction: (m) => require("../src/types").DeviceModels.CAMERA_LIGHT_RUN_ACTION.includes(m),
    },
  });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`${report.devices.length} device(s) written to ${outFile}`);
  if (report.noDeviceWithModel) console.log(`No device with model: ${report.noDeviceWithModel.join(", ")}`);
  console.log("Read the file before you post it. The plugin version is not in it; please add it.");
})().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
