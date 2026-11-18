/**
 * getCameraSnapshotImage({ cloudOnly }): Wyze's saved thumbnail or an error, and never a live capture.
 */
const test = require("node:test");
const assert = require("node:assert");
const WyzeAPI = require("../src/index");

function client({ cloud }) {
  const api = new WyzeAPI({ username: "u", password: "p", keyId: "k", apiKey: "a", logLevel: "error" });
  api.getCameraSnapshot = async () => cloud;
  api.cameraCaptureSnapshot = async () => { throw new Error("a live capture must not start"); };
  return api;
}

test("cloudOnly with no saved thumbnail is an error and starts no capture", async () => {
  await assert.rejects(() => client({ cloud: null }).getCameraSnapshotImage("AA", { cloudOnly: true, deviceModel: "X" }), /no saved picture/);
  await assert.rejects(() => client({ cloud: { url: null } }).getCameraSnapshotImage("AA", { cloudOnly: true, deviceModel: "X" }), /no saved picture/);
});

test("cloudOnly together with skipCloud is refused, and without cloudOnly the capture is still the fallback", async () => {
  await assert.rejects(() => client({ cloud: null }).getCameraSnapshotImage("AA", { cloudOnly: true, skipCloud: true }), /cannot both be set/);
  await assert.rejects(() => client({ cloud: null }).getCameraSnapshotImage("AA", { deviceModel: "X" }), /live capture must not start/, "unchanged: it falls back to a capture");
});
