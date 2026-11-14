const test = require("node:test");
const assert = require("node:assert");
const WyzeAPI = require("../src/index");
const tutk = require("../src/tutk/client");

function client(devices) {
  const api = new WyzeAPI({ username: "u", password: "p", keyId: "k", apiKey: "a", logLevel: "error" });
  api.getDeviceList = async () => devices;
  return api;
}
const good = { mac: "AA", enr: "enr", device_params: { dtls: 1, ip: "10.0.0.9", p2p_id: "UID" } };

test("night vision asks for a camera that is not on the account, or cannot be reached locally, in plain words", async () => {
  const api = client([{ mac: "BB", enr: "e", device_params: { ip: "10.0.0.8", p2p_id: "U" } }]);
  await assert.rejects(() => api.getCameraNightVision("AA"), /no such camera/);
  await assert.rejects(() => api.getCameraNightVision("BB"), /cannot be reached: the camera does not report the dtls flag/);
  await assert.rejects(() => api.setCameraNightVision("BB", "bogus"), /on, off or auto/);
});

test("setting night vision reads the camera's local details from the device list and passes the value on", async () => {
  const api = client([good]);
  const original = tutk.setNightVision;
  let seen;
  tutk.setNightVision = async (args) => { seen = args; return { before: "off", after: "auto", matches: true }; };
  try {
    const result = await api.setCameraNightVision("AA", "AUTO");
    assert.deepStrictEqual(result, { before: "off", after: "auto", matches: true });
    assert.deepStrictEqual(seen, { host: "10.0.0.9", uid: "UID", enr: "enr", mac: "AA", value: "auto" });
  } finally { tutk.setNightVision = original; }
});

test("two night vision calls for one camera run one after the other, and a failure does not block the next", async () => {
  const api = client([good]);
  const originalRead = tutk.readNightVision;
  let active = 0;
  let overlapped = false;
  let calls = 0;
  tutk.readNightVision = async () => {
    calls += 1; active += 1; if (active > 1) overlapped = true;
    await new Promise((r) => setTimeout(r, 30));
    active -= 1;
    if (calls === 1) throw new Error("camera busy");
    return "auto";
  };
  try {
    const results = await Promise.allSettled([api.getCameraNightVision("AA"), api.getCameraNightVision("AA")]);
    assert.strictEqual(results[0].status, "rejected");
    assert.strictEqual(results[1].value, "auto");
    assert.strictEqual(overlapped, false);
  } finally { tutk.readNightVision = originalRead; }
});
