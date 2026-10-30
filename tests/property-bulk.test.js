/**
 * Bulk property read (app/v2/device_list/get_property_list).
 * Network is stubbed via request().
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");

const stub = (response) => {
  const w = Object.create(WyzeAPI.prototype);
  w.calls = [];
  w.request = async (url, data) => {
    w.calls.push({ url, data });
    if (response instanceof Error) throw response;
    return response;
  };
  return w;
};

const devices = [{ mac: "AAA" }, { mac: "BBB" }];

test("getPropertyListForDevices sends one request and matches rows by position", async () => {
  const w = stub({
    data: {
      device_list: [
        { device_property_list: [{ pid: "P3", value: "1", ts: 10 }] },
        { device_property_list: [{ pid: "P3", value: "0", ts: 20 }] },
      ],
    },
  });
  const out = await w.getPropertyListForDevices(devices, ["P3"]);

  assert.strictEqual(w.calls.length, 1);
  assert.strictEqual(w.calls[0].url, "app/v2/device_list/get_property_list");
  assert.deepStrictEqual(w.calls[0].data, {
    device_list: ["AAA", "BBB"],
    target_pid_list: ["P3"],
  });
  assert.strictEqual(out.get("AAA")[0].value, "1");
  assert.strictEqual(out.get("BBB")[0].value, "0");
});

test("getPropertyListForDevices rejects empty pids without a request", async () => {
  const w = stub({ data: {} });
  await assert.rejects(() => w.getPropertyListForDevices(devices, []), /pids/);
  assert.strictEqual(w.calls.length, 0);
});

test("getPropertyListForDevices rejects empty devices without a request", async () => {
  const w = stub({ data: {} });
  await assert.rejects(() => w.getPropertyListForDevices([], ["P3"]), /devices/);
  assert.strictEqual(w.calls.length, 0);
});

test("getPropertyListForDevices throws on a row-count mismatch", async () => {
  const w = stub({ data: { device_list: [{ device_property_list: [] }] } });
  await assert.rejects(() => w.getPropertyListForDevices(devices, ["P3"]), /expected 2 rows, got 1/);
});

test("getPropertyListForDevices propagates request errors for fallback", async () => {
  const w = stub(new Error("boom"));
  await assert.rejects(() => w.getPropertyListForDevices(devices, ["P3"]), /boom/);
});

test("getDevicePID is unchanged and still reads one device", async () => {
  const w = stub({ data: { property_list: [] } });
  await w.getDevicePID("AAA", "WYZEC1-JZ");
  assert.strictEqual(w.calls[0].url, "app/v2/device/get_property_list");
  assert.deepStrictEqual(w.calls[0].data, { device_mac: "AAA", device_model: "WYZEC1-JZ" });
});
