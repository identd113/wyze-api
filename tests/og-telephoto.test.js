const test = require("node:test");
const assert = require("node:assert");
const { DeviceModels, WyzeAccessoryModels } = require("../src/types");
const props = require("../src/util/devicemgmtProps");

// Wyze reports the Cam OG Telephoto 3x as GW_GC2 (docker-wyze-bridge, ha-wyzeapi, Wyze's
// community table). It used to be listed as GW_GC, which no real camera sends.
test("the Cam OG Telephoto 3x is GW_GC2 and is handled as a devicemgmt camera", () => {
  assert.strictEqual(WyzeAccessoryModels.CameraModels.WyzeCamOGTelephoto3x, "GW_GC2");
  assert.ok(DeviceModels.CAMERA.includes("GW_GC2"));
  assert.ok(DeviceModels.CAMERA_DEVICEMGMT.includes("GW_GC2"));
  assert.ok(!Object.values(WyzeAccessoryModels.CameraModels).includes("GW_GC"));
});

test("GW_GC2 asks for the OG's properties until its own have been checked", () => {
  assert.deepStrictEqual(props.GW_GC2, props.GW_GC1);
});
