/**
 * Cam Plus plans: which cameras a plan covers.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");

const stub = (response) => {
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info: () => {}, error: () => {}, warn: () => {}, warning: () => {}, debug: () => {} };
  w.calls = [];
  w._oliveSignedGet = async (url, params) => {
    w.calls.push({ url, params });
    return response;
  };
  return w;
};

const DAY = 86400000;

test("getPlanBindingListByUser asks for hms by default and for another group when told to", async () => {
  const w = stub({ data: [] });
  await w.getPlanBindingListByUser();
  await w.getPlanBindingListByUser("cam-plus");
  assert.strictEqual(w.calls[0].params.group_id, "hms");
  assert.strictEqual(w.calls[1].params.group_id, "cam-plus");
  assert.match(w.calls[1].url, /get_plan_binding_list_by_user$/);
});

test("getCamPlusPlans names the cameras each plan covers and which plans are live", async () => {
  const w = stub({
    data: [
      { pid: "cam-plus-yearly", plan_name: "Annual Plan", service_status: "RENEW", expired_date: Date.now() + DAY, quantity: 1, used: 1, deviceList: [{ device_id: "AABBCCDDEEFF" }] },
      { pid: "cam-plus-yearly", plan_name: "Annual Plan", service_status: "EXPIRED", expired_date: Date.now() - DAY, quantity: 1, used: 0, deviceList: [] },
      { pid: "cam-plus-monthly", plan_name: "Monthly Plan", service_status: "RENEW", expired_date: Date.now() - DAY, quantity: 1, used: 1, deviceList: [{ device_id: "BBCCDDEEFF00" }] },
    ],
  });
  const plans = await w.getCamPlusPlans();
  assert.strictEqual(w.calls[0].params.group_id, "cam-plus");
  assert.deepStrictEqual(plans.map((plan) => plan.active), [true, false, false]); // a past date is not live whatever the status says
  assert.deepStrictEqual(plans[0].macs, ["AABBCCDDEEFF"]);
  assert.strictEqual(plans[0].name, "Annual Plan");
  assert.strictEqual(plans[0].used, 1);
});

test("getCamPlusPlans returns an empty list for an answer with no list", async () => {
  assert.deepStrictEqual(await stub({ data: null }).getCamPlusPlans(), []);
  assert.deepStrictEqual(await stub(undefined).getCamPlusPlans(), []);
});
