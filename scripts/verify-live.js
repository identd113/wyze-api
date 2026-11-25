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

const { requireCredentials } = require("./lib/credentials");

// No dotenv dependency in this package - parse .env manually if present.

const WyzeAPI = require("../src/index");

const creds = requireCredentials();

const wyze = new WyzeAPI({
  username: creds.username,
  password: creds.password,
  keyId: creds.keyId,
  apiKey: creds.apiKey,
  persistPath: process.env.PERSIST_PATH, // unset: the library default (~/.wyze-api)
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
