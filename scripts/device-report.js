// Read-only report on the devices of a Wyze account, for bug reports about a device
// that is missing or only partly works. Not part of `npm test` (it needs the network
// and your login). Run it yourself and paste the file it writes into the issue:
//   node scripts/device-report.js [--model CODE[,CODE...]] [--out FILE] [--local] [--discovery]
//
// Without --model it covers every device. It writes JSON (default
// ./wyze-device-report.json). Only read calls are made: the device list, each device's
// property list and device info, and for cameras the devicemgmt property read. It never
// sets, switches, deletes or logs out. MAC addresses, device names, IP addresses, the
// Wi-Fi name and account identifiers are removed from the output; read the file once
// before you post it.
//
// --local (opt in) also contacts each camera directly on your home network, with the
// read-only TUTK client in src/tutk/client.js. It needs to run on the same network as the
// cameras. It authenticates and then asks a fixed list of get commands (night vision,
// IR LED, status light, video settings, battery use, ...); it sends no setting. The file
// records what each camera answered, or why it could not be asked. Each camera takes up to
// about 40 seconds if it answers little.
//
// Login comes from USERNAME, PASSWORD, KEY_ID and API_KEY in the environment or in
// the .env file next to the package, as with the other scripts.

const fs = require("fs");
const path = require("path");

const { buildReport } = require("../src/deviceReport");

const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/device-report.js [--model CODE[,CODE...]] [--out FILE] [--local] [--discovery]");
  process.exit(0);
}
const models = (option("--model") || "").split(",").map((m) => m.trim()).filter(Boolean);
const withLocal = args.includes("--local");
const withDiscovery = args.includes("--discovery");
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
    discovery: withDiscovery,
    onDiscovery: (found) => console.log(`capability discovery for ${found.model}: ${found.requests} read${found.requests === 1 ? "" : "s"}${found.rejected ? `, ${found.rejected} group${found.rejected === 1 ? "" : "s"} rejected` : ""}`),
    localProbe: withLocal ? (camera) => require("../src/tutk/client").probeCamera(camera) : null,
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
