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

test("cameraGetEventsMulti asks once for several cameras and groups the events by camera", async () => {
  const calls = [];
  const w = stub([
    { event_id: "b2", device_mac: "B", event_ts: "30", event_value: "13" },
    { event_id: "a1", device_mac: "A", event_ts: "20", event_value: "13" },
    { event_id: "b1", device_mac: "B", event_ts: "10", event_value: "2" },
    { event_id: "zz", device_mac: "NOT_ASKED", event_ts: "5", event_value: "13" },
  ], calls);
  const grouped = await w.cameraGetEventsMulti(["A", "B", "C", "A"]);
  assert.strictEqual(calls.length, 1, "one request for all the cameras");
  assert.deepStrictEqual(calls[0][1].device_mac_list, ["A", "B", "C"], "duplicates removed");
  assert.deepStrictEqual(Object.keys(grouped), ["A", "B", "C"]);
  assert.deepStrictEqual(grouped.A.map((e) => e.id), ["a1"]);
  assert.deepStrictEqual(grouped.B.map((e) => e.id), ["b2", "b1"], "newest first, as returned");
  assert.deepStrictEqual(grouped.C, [], "a camera with no events is present and empty");
});

test("cameraGetEventsMulti with no cameras makes no request", async () => {
  const calls = [];
  const w = stub([], calls);
  assert.deepStrictEqual(await w.cameraGetEventsMulti([]), {});
  assert.strictEqual(calls.length, 0);
});

test("an event with no camera on it is ignored when several cameras were asked for", async () => {
  const w = stub([{ event_id: "x", event_ts: "1", event_value: "13" }]);
  assert.deepStrictEqual(await w.cameraGetEventsMulti(["A", "B"]), { A: [], B: [] });
});

test("each event carries its age by Wyze's own clock, not this host's", async () => {
  const w = Object.create(WyzeAPI.prototype);
  // Wyze says it is 1_000_050; the event happened at 1_000_000, so it is 50 ms old, whatever Date.now() says.
  w.request = async () => ({
    ok: true,
    data: { code: 1, ts: 1_000_050, data: { event_list: [{ event_id: "e", event_ts: "1000000", event_value: "2" }] } },
  });
  const [event] = await w.cameraGetEvents("MAC");
  assert.strictEqual(event.ageMs, 50);
  assert.strictEqual(event.time, 1_000_000);
});

test("without Wyze's time on the reply the age falls back to this host's clock", async () => {
  const w = Object.create(WyzeAPI.prototype);
  const before = Date.now();
  w.request = async () => ({
    ok: true,
    data: { code: 1, data: { event_list: [{ event_id: "e", event_ts: String(before - 5_000), event_value: "2" }] } },
  });
  const [event] = await w.cameraGetEvents("MAC");
  assert.ok(event.ageMs >= 5_000 && event.ageMs < 6_000, `age ${event.ageMs}`);
});

test("types asks Wyze for only those event types, by name; none asks for every type", async () => {
  const calls = [];
  const w = stub([], calls);
  await w.cameraGetEvents("MAC", { types: ["SOUND"] });
  await w.cameraGetEvents("MAC", { types: ["SOUND", "MOTION"] });
  await w.cameraGetEvents("MAC");
  assert.deepStrictEqual(calls[0][1].event_value_list, [2]);
  assert.deepStrictEqual(calls[1][1].event_value_list, [2, 1, 6, 7, 13]);
  assert.deepStrictEqual(calls[2][1].event_value_list, []);
});

test("tags asks Wyze only for events carrying those AI tags, by name", async () => {
  const calls = [];
  const w = stub([], calls);
  await w.cameraGetEvents("MAC", { tags: ["PACKAGE"] });
  await w.cameraGetEvents("MAC", { tags: ["PERSON", "PET"] });
  await w.cameraGetEvents("MAC");
  assert.deepStrictEqual(calls[0][1].event_tag_list, [AiEventTag.PACKAGE]);
  assert.deepStrictEqual(calls[1][1].event_tag_list, [AiEventTag.PERSON, AiEventTag.PET]);
  assert.deepStrictEqual(calls[2][1].event_tag_list, []);
});

test("an unknown event type or tag is an error, not a request with no filter", async () => {
  const calls = [];
  const w = stub([], calls);
  await assert.rejects(() => w.cameraGetEvents("MAC", { types: ["MOTON"] }), /unknown event type "MOTON"/);
  await assert.rejects(() => w.cameraGetEvents("MAC", { tags: ["PEOPLE"] }), /unknown event tag "PEOPLE"/);
  await assert.rejects(() => w.cameraGetEventsMulti(["MAC"], { types: ["SOUND", "NOPE"], tags: ["PERSON", "NOPE"] }), /type "NOPE", tag "NOPE"/);
  assert.strictEqual(calls.length, 0, "nothing was sent to Wyze");
  // the real names still work
  await w.cameraGetEvents("MAC", { types: ["SOUND"], tags: ["PERSON", "PACKAGE"] });
  assert.strictEqual(calls.length, 1);
});
