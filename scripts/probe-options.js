// Manual, read-only OPTIONS probe of Wyze endpoints the library does not call.
// Not part of `npm test` (no network access there) — run explicitly:
//   node scripts/probe-options.js [outFile]
//
// Sends an HTTP OPTIONS request to each URL and records the status and any
// method-related headers (Allow, Access-Control-Allow-Methods). OPTIONS does
// not change server state. A server that does not answer OPTIONS tells us
// nothing about whether POST, PUT or DELETE are accepted, so this is a hint,
// not a proof. Nothing here sends POST, PUT, PATCH or DELETE.

const fs = require("fs");
const path = require("path");
const https = require("https");
const agent = require("../src/httpsAgent");

const outFile = process.argv[2] || path.join(process.cwd(), "options-probe.json");

const HOSTS = {
  api: "https://api.wyzecam.com",
  platform: "https://wyze-platform-service.wyzecam.com",
  scale: "https://wyze-scale-service.wyzecam.com",
  pluto: "https://wyze-pluto-service.wyzecam.com",
  earth: "https://wyze-earth-service.wyzecam.com",
  sirius: "https://wyze-sirius-service.wyzecam.com",
};

// Paths the SDK lists that neither wyze-api nor the plugin calls.
const TARGETS = [
  ["api", "app/user/change_password"],
  ["api", "app/user/logout"],
  ["api", "app/device/get_device_info"],
  ["api", "app/v2/device_group/timer/get"],
  ["api", "app/v2/device_event/set_read_state_list"],
  ["api", "app/v2/device_list/get_property_list"],
  ["api", "openapi/v1/device"],
  ["platform", "app/v2/platform/get_variable"],
  ["platform", "app/v2/platform/update_user_profile"],
  ...[
    "get_device_setting", "update_device_setting", "get_device_member", "get_family_member",
    "get_user_device_relation", "get_user_preference", "get_latest_record", "get_record_range",
    "get_goal_weight", "delete_goal_weight", "get_heart_rate_record_list", "add_heart_rate_record",
    "add_record", "delete_record", "get_token",
  ].map((m) => ["scale", `plugin/scale/${m}`]),
  ...[
    "device_info", "device_info/batch", "get_iot_prop", "get_iot_prop/batch", "set_iot_prop",
    "set_iot_prop_by_topic", "get_sub_device",
  ].flatMap((m) => [["earth", `plugin/earth/${m}`], ["sirius", `plugin/sirius/${m}`]]),
  ...["device_info", "get_device_member", "get_device_setting", "get_family_member",
    "get_goal_weight", "get_heart_rate_record_list", "get_latest_record", "get_record_range",
    "get_user_device_relation", "get_user_preference", "update_device_setting"]
    .map((m) => ["pluto", `plugin/pluto/${m}`]),
];

function options(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: "OPTIONS", agent, timeout: 15000 }, (res) => {
      res.resume();
      resolve({
        status: res.statusCode,
        allow: res.headers["allow"] || null,
        acam: res.headers["access-control-allow-methods"] || null,
        server: res.headers["server"] || null,
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "timeout" });
    });
    req.on("error", (e) => resolve({ error: e.code || e.message }));
    req.end();
  });
}

(async () => {
  const report = [];
  for (const [host, p] of TARGETS) {
    const url = `${HOSTS[host]}/${p}`;
    const result = await options(url);
    report.push({ host, path: p, ...result });
    const summary = result.error
      ? `error ${result.error}`
      : `status ${result.status}${result.allow ? ` allow=${result.allow}` : ""}${result.acam ? ` acam=${result.acam}` : ""}`;
    console.log(`${host.padEnd(9)} ${p.padEnd(46)} ${summary}`);
  }
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outFile}`);
})();
