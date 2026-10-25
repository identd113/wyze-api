// Manual, read-only live verification against the real Wyze servers.
// Not part of `npm test` (no network access there) — run explicitly:
//   node scripts/verify-live.js
//
// Exercises exactly what src/httpsAgent.js and the Ford GET-signing fix
// (src/payloadFactory.js) are meant to fix:
//   1. login              -> TLS handshake to auth server succeeds
//   2. getDeviceList      -> TLS handshake to api.wyzecam.com succeeds
//   3. getLockInfo        -> Ford GET signature is accepted (was PARAM_SIGN_INVALID)
//
// Never calls controlLock or any other state-changing method.

const fs = require("fs");
const path = require("path");

// No dotenv dependency in this package - parse .env manually if present.
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
  console.error("Set them in a .env file at the repo root (see .env.sample).");
  process.exit(1);
}

const wyze = new WyzeAPI({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: process.env.PERSIST_PATH || __dirname,
  logLevel: process.env.LOG_LEVEL || "info",
});

function step(name) {
  console.log(`\n=== ${name} ===`);
}

(async () => {
  let failed = false;

  try {
    step("login");
    await wyze.maybeLogin();
    console.log("OK - access_token acquired, TLS handshake succeeded");

    step("getDeviceList");
    const devices = await wyze.getDeviceList();
    console.log(`OK - ${devices.length} device(s) returned`);
    for (const d of devices) {
      console.log(`  - ${d.nickname} (${d.product_type} / ${d.product_model}) mac=${d.mac}`);
    }

    const locks = devices.filter((d) => d.product_type.toLowerCase() === "lock");
    if (locks.length === 0) {
      console.log("\nNo Lock devices on this account - skipping getLockInfo check.");
    } else {
      for (const lock of locks) {
        step(`getLockInfo (${lock.nickname})`);
        try {
          const info = await wyze.getLockInfo(lock.mac, lock.product_model);
          console.log(`OK - code=${info.code} msg=${info.msg}`);
          if (String(info.code) !== "1") {
            console.error(`  Unexpected response code (expected "1"): ${JSON.stringify(info)}`);
            failed = true;
          }
        } catch (e) {
          console.error(`  FAILED: ${e.message}`);
          if (e.response) {
            console.error(`  Response: ${JSON.stringify(e.response.data)}`);
          }
          failed = true;
        }
      }
    }
  } catch (e) {
    console.error(`\nFAILED: ${e.message}`);
    if (e.response) {
      console.error(`Response: ${JSON.stringify(e.response.data)}`);
    }
    failed = true;
  }

  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS");
  process.exit(failed ? 1 : 0);
})();
