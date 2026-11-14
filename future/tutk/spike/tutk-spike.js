#!/usr/bin/env node
"use strict";

/**
 * tutk-spike.js: command-line test of the pure-JavaScript TUTK client in src/tutk/client.js.
 * Read-only unless --set is given.
 *
 * What it does, against one camera on the LAN, with Node built-ins only (no native library):
 *   1. finds the camera by UDP (discovery + session setup, in either the IOTC or the "CC51" form),
 *   2. runs a DTLS 1.2 handshake over that session (cipher suite 0xCCAC, ECDHE-PSK with ChaCha20-Poly1305),
 *   3. sends the AV login and passes the K10000 to K10003 challenge authentication.
 * It then prints a short summary and exits. It sends no setting to the camera.
 *
 * Phase 2 (opt in):
 *   --night-vision        also reads night vision (K10040): 1 = on, 2 = off, 3 = auto. Read only.
 *   --set on|off|auto     sets night vision (K10042), then reads it back to check. This changes the camera.
 *   --restore             with --set: put the value that was there before back afterwards.
 *   --query 10446,10448   sends those read-only get commands and prints each answer (private fields hidden).
 *                         Only the get commands in READ_ONLY_COMMANDS are accepted; nothing else is sent.
 *
 * The protocol is taken from AlexxIT/go2rtc (pkg/tutk, pkg/tutk/dtls, pkg/wyze), which is MIT licensed:
 *   Copyright (c) 2022 Alexey Khit. Permission is granted, free of charge, to use, copy, modify and
 *   distribute it under the MIT License (https://github.com/AlexxIT/go2rtc/blob/master/LICENSE).
 *
 * Usage:
 *   node future/tutk/spike/tutk-spike.js [--model HL_DB2] [--name <part of nickname>] [--host <ip>]
 *                                        [--port 32761] [--verbose] [--timeout 8000]
 *                                        [--night-vision] [--set on|off|auto [--restore]]
 *
 * Credentials come from wyze-api's .env (USERNAME, PASSWORD, KEY_ID, API_KEY), the same as scripts/.
 * The camera's enr, P2P id and MAC are read from the Wyze device list and never printed.
 *
 * Exit code: 0 authenticated, 1 failed, 2 bad usage.
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------------------------
// Options and logging
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const VERBOSE = args.includes("--verbose");
const TIMEOUT_MS = Number(opt("timeout", 8000));
const log = (...a) => console.log(...a);
const vlog = (...a) => { if (VERBOSE) console.log("   ", ...a); };
if (VERBOSE) process.env.WYZE_TUTK_DEBUG = "1"; // before the client module is loaded

const {
  Session, DtlsClient, AvChannel, calculateAuthKey, derivePsk, READ_ONLY_COMMANDS, NV_NAMES, NV_VALUES, describePayload,
} = require("../../../src/tutk/client");

// ---------------------------------------------------------------------------------------------
// Camera details from the Wyze cloud (read only), then run
// ---------------------------------------------------------------------------------------------

async function cameraFromCloud() {
  const root = path.join(__dirname, "..", "..", "..");
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  const WyzeAPI = require(path.join(root, "src", "index"));
  const wyze = new WyzeAPI({ username: process.env.USERNAME, password: process.env.PASSWORD, keyId: process.env.KEY_ID, apiKey: process.env.API_KEY, logLevel: "error" });
  const list = (await wyze.getObjectList()).data.device_list;
  const model = opt("model", "HL_DB2");
  const name = typeof opt("name", null) === "string" ? opt("name").toLowerCase() : null;
  const cam = list.find((d) => d.product_model === model && (!name || d.nickname.toLowerCase().includes(name)));
  if (!cam) throw new Error(`no ${model} camera in the Wyze device list`);
  const p = cam.device_params || {};
  return { nickname: cam.nickname, model: cam.product_model, mac: cam.mac, enr: cam.enr, uid: p.p2p_id, ip: p.ip, dtls: p.dtls };
}

async function main() {
  const cam = await cameraFromCloud();
  const host = typeof opt("host", null) === "string" ? opt("host") : cam.ip;
  const port = Number(opt("port", 32761));
  log(`Camera: ${cam.nickname} (${cam.model}), dtls flag ${cam.dtls}, address ${host}:${port}`);
  if (!cam.enr || !cam.uid || !host) throw new Error("the Wyze device list is missing enr, P2P id or IP for this camera");
  if (cam.dtls !== 1) log("Note: this camera does not have the dtls flag; the DTLS step may not apply to it.");

  const session = new Session({ host, port, uid: cam.uid, authKey: calculateAuthKey(cam.enr, cam.mac), enr: cam.enr });
  let av = null;
  try {
    log("1. Discovery and session ...");
    await session.connect(TIMEOUT_MS);
    log(`   ok (${session.isCC51 ? "CC51" : "IOTC"} form)`);

    log("2. DTLS handshake (ECDHE-PSK, ChaCha20-Poly1305) ...");
    const dtls = new DtlsClient((d) => session.sendDtls(d), derivePsk(cam.enr));
    session.attach(dtls);
    dtls.start();
    await Promise.race([dtls.done, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: DTLS handshake")), TIMEOUT_MS))]);
    log("   ok");

    log("3. AV login ...");
    av = new AvChannel(dtls, cam.enr);
    const login = await av.login(TIMEOUT_MS);
    log(`   ok (two-way audio: ${login.twoWay})`);

    log("4. K10000 to K10003 authentication ...");
    const auth = await av.authenticate(TIMEOUT_MS);
    log(`   ok (challenge status ${auth.status})`);
    if (auth.info) {
      const basic = auth.info.cameraInfo && auth.info.cameraInfo.basicInfo;
      log("   camera replied with keys:", Object.keys(auth.info).join(", "));
      if (basic) log(`   firmware ${basic.firmware}, model ${basic.model}`);
    }
    const queryArg = opt("query", null);
    if (typeof queryArg === "string") {
      log("5. Read-only queries ...");
      for (const code of queryArg.split(",").map((x) => Number(x.trim().replace(/^K/i, "")))) {
        if (!READ_ONLY_COMMANDS[code]) { log(`   K${code}: refused, not a read-only get command`); continue; }
        try {
          const payload = await av.query(code, Number(opt("query-timeout", 4000)));
          log(`   K${code} ${READ_ONLY_COMMANDS[code]}: ${describePayload(payload)}`);
        } catch (e) {
          log(`   K${code} ${READ_ONLY_COMMANDS[code]}: ${e.message}`);
        }
      }
      log("\nREAD ONLY: nothing was written to the camera.");
      return 0;
    }
    const setArg = opt("set", null);
    if (setArg !== null && !(typeof setArg === "string" && NV_VALUES[setArg.toLowerCase()])) {
      throw new Error("--set needs on, off or auto");
    }
    if (args.includes("--night-vision") || setArg !== null) {
      log("5. Night vision (K10040) ...");
      const before = await av.getNightVision(TIMEOUT_MS);
      log(`   currently ${before} (${NV_NAMES[before] || "unknown value"})`);
      if (setArg !== null) {
        const target = NV_VALUES[setArg.toLowerCase()];
        log(`6. Setting night vision to ${setArg.toLowerCase()} (K10042) ...`);
        const result = await av.setNightVision(target, TIMEOUT_MS);
        log(`   camera answered ${result}`);
        const after = await av.getNightVision(TIMEOUT_MS);
        log(`   read back ${after} (${NV_NAMES[after] || "unknown value"}) ${after === target ? "- matches" : "- DOES NOT MATCH"}`);
        if (args.includes("--restore") && before !== after) {
          log(`7. Restoring the previous value (${NV_NAMES[before] || before}) ...`);
          await av.setNightVision(before, TIMEOUT_MS);
          const restored = await av.getNightVision(TIMEOUT_MS);
          log(`   read back ${restored} (${NV_NAMES[restored] || "unknown value"}) ${restored === before ? "- restored" : "- NOT RESTORED, set it in the Wyze app"}`);
        }
        return after === target ? 0 : 1;
      }
      log("\nREAD ONLY: nothing was written to the camera.");
      return 0;
    }
    log("\nAUTHENTICATED. Nothing was written to the camera.");
    return 0;
  } finally {
    if (av) av.close();
    session.close();
  }
}

main().then((code) => process.exit(code), (e) => {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
});
