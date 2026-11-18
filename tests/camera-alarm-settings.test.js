/**
 * The camera's smoke and CO alarm sound settings (K10020 params 17 and 18, over the local session): the parser, the
 * plain-words errors, and that reads on one camera never overlap.
 */
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
// a K10021 payload: some header bytes, then the JSON of numbered params, as the camera sends it
const answer = (params) => Buffer.concat([Buffer.from([0x3c, 0x00]), Buffer.from(JSON.stringify(params), "latin1")]);

test("param 17 is the smoke alarm sound and 18 the CO alarm sound: 1 is on, 2 is off", () => {
  assert.deepStrictEqual(tutk.parseAlarmSettings(answer({ 15: 2, 16: 5, 17: 1, 18: 1 })), { smoke: "on", co: "on" });
  assert.deepStrictEqual(tutk.parseAlarmSettings(answer({ 17: 2, 18: 2 })), { smoke: "off", co: "off" });
  assert.deepStrictEqual(tutk.parseAlarmSettings(answer({ 17: 1, 18: 2 })), { smoke: "on", co: "off" }, "the two are independent");
});

test("a value that is not 1 or 2, or a param that is missing, is unknown, not a guess", () => {
  assert.deepStrictEqual(tutk.parseAlarmSettings(answer({ 17: 0, 18: 7 })), { smoke: "unknown", co: "unknown" });
  assert.deepStrictEqual(tutk.parseAlarmSettings(answer({ 1: 2 })), { smoke: "unknown", co: "unknown" });
});

test("an answer that is not the settings JSON is an error, not an empty result", () => {
  assert.throws(() => tutk.parseAlarmSettings(Buffer.from([1, 2, 3])), /did not answer with its settings/);
  assert.throws(() => tutk.parseAlarmSettings(Buffer.from("{not json", "latin1")), /did not answer with its settings/);
});

test("the alarm settings ask for a camera that is not on the account, or cannot be reached locally, in plain words", async () => {
  const api = client([{ mac: "BB", enr: "e", device_params: { ip: "10.0.0.8", p2p_id: "U" } }]);
  await assert.rejects(() => api.getCameraAlarmSettings("AA"), /no such camera/);
  await assert.rejects(() => api.getCameraAlarmSettings("BB"), /the alarm settings cannot be reached: the camera does not report the dtls flag/);
});

test("reading the alarm settings passes the camera's address and keys to the local client, and returns its answer", async () => {
  const api = client([good]);
  const original = tutk.readAlarmSettings;
  let seen;
  tutk.readAlarmSettings = async (target) => { seen = target; return { smoke: "on", co: "off" }; };
  try {
    assert.deepStrictEqual(await api.getCameraAlarmSettings("AA"), { smoke: "on", co: "off" });
    assert.deepStrictEqual(seen, { host: "10.0.0.9", uid: "UID", enr: "enr", mac: "AA" });
  } finally { tutk.readAlarmSettings = original; }
});

test("two reads of one camera do not overlap, and a failed one does not stop the next", async () => {
  const api = client([good]);
  const original = tutk.readAlarmSettings;
  let active = 0;
  let overlapped = false;
  let calls = 0;
  tutk.readAlarmSettings = async () => {
    calls += 1; active += 1; if (active > 1) overlapped = true;
    await new Promise((r) => setTimeout(r, 30));
    active -= 1;
    if (calls === 1) throw new Error("camera busy");
    return { smoke: "on", co: "on" };
  };
  try {
    const results = await Promise.allSettled([api.getCameraAlarmSettings("AA"), api.getCameraAlarmSettings("AA")]);
    assert.strictEqual(results[0].status, "rejected");
    assert.deepStrictEqual(results[1].value, { smoke: "on", co: "on" });
    assert.strictEqual(overlapped, false);
  } finally { tutk.readAlarmSettings = original; }
});

test("the read sends only K10020, which is on the read-only list", () => {
  const src = require("node:fs").readFileSync(require.resolve("../src/tutk/client"), "utf8");
  const body = src.slice(src.indexOf("async function readAlarmSettings"), src.indexOf("/** Reads night vision"));
  assert.ok(/query\(10020,/.test(body) && !/setNightVision|\.hl\(/.test(body), "only the K10020 query");
});
