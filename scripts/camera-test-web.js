// A web page for testing your Wyze cameras from a browser. Not part of `npm test` (it needs your
// login and your cameras). Run it on a computer on the same network as the cameras:
//   node scripts/camera-test-web.js [--port 8099]
//
// It prints a link that ends with ?token=... ; open it in a browser on the same network. The page
// lists the cameras, runs a read-only test of each one (what it answers over the local network) and,
// after you confirm, can set night vision to on, off or auto. See src/web/cameraTestServer.js for how
// it is protected: a random token, local network clients only, no proxies, one test at a time.
//
// --port is 1024 to 65535 (lower ports need root). Default 8099. Stop it with Ctrl-C.
// Login comes from WYZE_USERNAME, WYZE_PASSWORD, WYZE_KEY_ID and WYZE_API_KEY in the environment or in the .env file next
// to the package, as with the other scripts.

const { requireCredentials } = require("./lib/credentials");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/camera-test-web.js [--port 8099]");
  process.exit(0);
}
const portArg = args.indexOf("--port") === -1 ? "8099" : args[args.indexOf("--port") + 1];

const creds = requireCredentials();

const WyzeAPI = require("../src/index");
const check = WyzeAPI.validateWebPort(portArg);
if (!check.enabled) {
  console.error(check.error || "The port is 0, which turns the web server off. Pass --port 1024 or higher.");
  process.exit(2);
}

const wyze = new WyzeAPI({
  username: creds.username,
  password: creds.password,
  keyId: creds.keyId,
  apiKey: creds.apiKey,
  persistPath: process.env.PERSIST_PATH, // unset: the library default (~/.wyze-api)
  logLevel: process.env.LOG_LEVEL || "warn",
});

(async () => {
  await wyze.maybeLogin();
  const server = WyzeAPI.createCameraTestServer({
    client: wyze,
    port: check.port,
    log: { info: console.log, warn: console.warn, error: console.error },
  });
  const { urls } = await server.start();
  console.log("Camera test page is running. Open one of these on a computer on the same network:");
  for (const url of urls) console.log(`  ${url}`);
  console.log("Anyone with the link can test your cameras and change night vision, so do not share it.");
  console.log("Press Ctrl-C to stop.");
  process.on("SIGINT", async () => { await server.stop(); process.exit(0); });
})().catch((e) => {
  console.error(`FAILED: ${e.code === "EADDRINUSE" ? `port ${check.port} is already in use` : e.message}`);
  process.exit(1);
});
