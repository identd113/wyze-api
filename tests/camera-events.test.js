/**
 * Cloud events for cameras (get_event_list). Shapes taken from a real Doorbell v2
 * reply: event_value is a string, and a press starts as motion (13) and is later
 * flipped to "Doorbell rang" (10).
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");
const { EventAlarmType, AiEventTag, DeviceModels } = require("../src/types");

const stub = (eventList, calls = []) => {
  const w = Object.create(WyzeAPI.prototype);
  w.request = async (url, data) => { calls.push([url, data]); return { ok: true, data: { code: 1, data: { event_list: eventList } } }; };
  return w;
};

test("cameraGetEvents posts the event-list query and normalizes the reply", async () => {
  const calls = [];
  const w = stub([
    { event_id: "e2", event_ts: "1792868688354", event_value: "10", tag_list: [101, 102], event_params: { beginTime: "1" } },
    { event_id: "e1", event_ts: "1792868560000", event_value: "13", tag_list: [] },
    { event_id: "e0", event_ts: "1792868500000", event_value: "2" },
    { event_id: "ex", event_ts: "1792868400000", event_value: "99" },
  ], calls);

  const events = await w.cameraGetEvents("MAC", { sinceMs: 120000, count: 5 });

  assert.deepStrictEqual(events.map((e) => [e.id, e.type, e.value]), [
    ["e2", "DOORBELL_RANG", 10],
    ["e1", "MOTION", 13],
    ["e0", "SOUND", 2],
    ["ex", null, 99],
  ]);
  assert.deepStrictEqual(events[0].tags, [AiEventTag.PERSON, AiEventTag.VEHICLE]);
  assert.deepStrictEqual(events[2].tags, []);
  assert.strictEqual(events[0].time, 1792868688354);

  const [url, data] = calls[0];
  assert.strictEqual(url, "app/v2/device/get_event_list");
  assert.deepStrictEqual(data.device_mac_list, ["MAC"]);
  assert.strictEqual(data.count, 5);
  assert.ok(data.end_time - data.begin_time >= 120000);
  assert.strictEqual(data.sv, "bdcb412e230049c0be0916e75022d3f3");
});

test("cameraGetEvents tolerates an empty reply and clamps the count", async () => {
  const calls = [];
  const w = stub(undefined, calls);
  assert.deepStrictEqual(await w.cameraGetEvents("MAC", { count: 500 }), []);
  assert.strictEqual(calls[0][1].count, 20);
});

test("the Doorbell v2 is a doorbell; other cameras are not", () => {
  const w = Object.create(WyzeAPI.prototype);
  assert.ok(DeviceModels.DOORBELL.includes("HL_DB2"));
  assert.strictEqual(w.cameraIsDoorbell("HL_DB2"), true);
  assert.strictEqual(w.cameraIsDoorbell("WYZE_CAKP2JFUS"), false);
  assert.ok(EventAlarmType.DOORBELL_RANG.includes(10));
});
