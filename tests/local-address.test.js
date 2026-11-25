/**
 * Anything sent straight to a device goes to an address that Wyze's device list supplied, so it is only sent to when
 * that address is on the local network. The class of mistake is any code that uses a device's address, so a sweep checks
 * every place that reads one.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { isPrivateAddress } = require("../src/util/network");
const { cameraLocalSkipReason } = require("../src/tutk/client");
const WyzeAPI = require("../src/index");

const camera = (ip) => ({ mac: "AA", enr: "enr", device_params: { dtls: 1, ip, p2p_id: "UID" } });

test("isPrivateAddress: the local ranges are, public addresses and rubbish are not", () => {
  for (const ok of ["10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.9", "169.254.1.1", "127.0.0.1", "::1", "fd12:3456::1", "fe80::1", "::ffff:192.168.1.9"]) {
    assert.ok(isPrivateAddress(ok), ok);
  }
  for (const no of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "11.0.0.1", "2001:db8::1", "::ffff:8.8.8.8", "", undefined, null, "cam.local", "192.168.1.9.evil.example"]) {
    assert.ok(!isPrivateAddress(no), String(no));
  }
});

test("the local camera session is not opened to an address that is not on the local network", () => {
  assert.strictEqual(cameraLocalSkipReason(camera("192.168.1.20")), "");
  assert.match(cameraLocalSkipReason(camera("203.0.113.7")), /not on the local network/);
  assert.match(cameraLocalSkipReason(camera("evil.example")), /not on the local network/);
  assert.match(cameraLocalSkipReason(camera("")), /no IP address/);
});

test("a local bulb command is refused for an address that is not on the local network, and sends nothing", async () => {
  const api = Object.create(WyzeAPI.prototype);
  api.log = { debug() {}, warn() {}, error() {}, info() {} };
  await assert.rejects(
    () => api.localBulbCommand("AA", "WLPA19C", "0123456789abcdef", "203.0.113.7", "P3", "1"),
    /not an address on the local network/
  );
});

test("a bulb whose address is not local is controlled through the cloud instead", async () => {
  const api = Object.create(WyzeAPI.prototype);
  api.log = { debug() {}, warn() {}, error() {}, info() {} };
  const calls = [];
  api.runActionList = async (...args) => { calls.push(args); return "cloud"; };
  const result = await api.bulbLocalOrCloud({ mac: "AA", product_model: "WLPA19C", enr: "0123456789abcdef", device_params: { ip: "203.0.113.7" } }, "P3", "1", "power_on");
  assert.strictEqual(result, "cloud");
  assert.strictEqual(calls.length, 1);
});

// ---- the sweep ----

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

// Files that read a device's address and why that is safe.
const ONLY_READS = {
  "src/devices/cameras.helpers.js": "returns the address to the caller; nothing is sent",
  "src/shared/accessors.js": "returns the address to the caller; nothing is sent",
  "src/devices/bulbs.helpers.js": "sends through localBulbCommand, which refuses a non-local address",
};

test("every place that uses a device's address checks that it is on the local network", () => {
  const root = path.join(__dirname, "..");
  const reads = /device_params\??\.ip\b|\bdp\.ip\b|\bp\.ip\b|\.ipaddr\b/;
  const guarded = /isPrivateAddress|cameraLocalSkipReason|localSkipReason/;
  const offenders = [];
  let found = 0;
  for (const file of sourceFiles(path.join(root, "src"))) {
    const rel = path.relative(root, file);
    const text = fs.readFileSync(file, "utf8");
    if (!reads.test(text)) continue;
    found += 1;
    if (guarded.test(text) || ONLY_READS[rel]) continue;
    offenders.push(rel);
  }
  assert.ok(found >= 5, `the sweep only found ${found} files that read an address`);
  assert.deepStrictEqual(offenders, []);
});
