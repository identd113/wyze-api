/**
 * A live capture needs the camera's model. Callers that know it pass it in, which saves
 * a full device-list request on every picture.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");

function stub() {
  const w = Object.create(WyzeAPI.prototype);
  w.lookups = 0;
  w.captured = [];
  w.getCamera = async (mac) => { w.lookups += 1; return { mac, product_model: "LOOKED_UP" }; };
  w.cameraCaptureSnapshot = async (mac, model) => { w.captured.push([mac, model]); return Buffer.from("jpg"); };
  return w;
}

test("with deviceModel given, no device-list lookup is made", async () => {
  const w = stub();
  const r = await w.getCameraSnapshotImage("AA", { skipCloud: true, deviceModel: "WYZE_CAKP2JFUS" });
  assert.strictEqual(w.lookups, 0);
  assert.deepStrictEqual(w.captured, [["AA", "WYZE_CAKP2JFUS"]]);
  assert.strictEqual(r.source, "capture");
});

test("without deviceModel the camera is looked up as before", async () => {
  const w = stub();
  await w.getCameraSnapshotImage("AA", { skipCloud: true });
  assert.strictEqual(w.lookups, 1);
  assert.deepStrictEqual(w.captured, [["AA", "LOOKED_UP"]]);
});

test("an unknown camera still fails clearly when no model was given", async () => {
  const w = stub();
  w.getCamera = async () => undefined;
  await assert.rejects(() => w.getCameraSnapshotImage("ZZ", { skipCloud: true }), /Camera not found: ZZ/);
});
