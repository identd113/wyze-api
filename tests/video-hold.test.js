const test = require("node:test");
const assert = require("node:assert");
const { VideoHold } = require("../src/devices/videoHold");

function make(max) {
  const out = [];
  return { hold: new VideoHold({ send: (p) => out.push(p.toString()), max }), out };
}

test("nothing before the first keyframe is kept, everything from it on is, in order", () => {
  const { hold, out } = make();
  hold.push(Buffer.from("p0"), false); // a P-frame before any keyframe: useless
  hold.push(Buffer.from("idr1"), true);
  hold.push(Buffer.from("p1"), false);
  assert.deepStrictEqual(out, [], "nothing is sent while holding");
  const r = hold.release();
  assert.strictEqual(r.hadKeyframe, true);
  assert.deepStrictEqual(out, ["idr1", "p1"]);
});

test("after release, packets pass straight through", () => {
  const { hold, out } = make();
  hold.push(Buffer.from("idr"), true);
  hold.release();
  hold.push(Buffer.from("p"), false);
  assert.deepStrictEqual(out, ["idr", "p"]);
});

test("releasing before any keyframe arrived reports that none was held", () => {
  const { hold, out } = make();
  hold.push(Buffer.from("p"), false);
  assert.deepStrictEqual(hold.release(), { hadKeyframe: false });
  assert.deepStrictEqual(out, []);
  hold.push(Buffer.from("later"), false);
  assert.deepStrictEqual(out, ["later"], "and later packets are passed on");
});

test("a second release does nothing more", () => {
  const { hold, out } = make();
  hold.push(Buffer.from("idr"), true);
  hold.release();
  hold.release();
  assert.deepStrictEqual(out, ["idr"]);
});

test("a hold that fills up releases itself rather than growing forever", () => {
  const { hold, out } = make(3);
  hold.push(Buffer.from("a"), true);
  hold.push(Buffer.from("b"), false);
  hold.push(Buffer.from("c"), false); // the third packet reaches the cap
  assert.deepStrictEqual(out, ["a", "b", "c"]);
  hold.push(Buffer.from("d"), false);
  assert.deepStrictEqual(out, ["a", "b", "c", "d"]);
});
