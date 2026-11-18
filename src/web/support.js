"use strict";

/**
 * What a camera (or another device) appears to support, from what has been read about it: the device list entry,
 * a device report entry (src/deviceReport.js: property list, devicemgmt, capability discovery) and, for a camera,
 * what it answered over the local session (src/tutk/client.js). Pure: it reads nothing itself.
 *
 * Each feature is one of
 *   "yes"      something read from THIS device shows it (the property, the group with a value, the camera's answer);
 *   "likely"   the model is known to have it (a model list in src/types.js), nothing here confirms it;
 *   "notSeen"  nothing read shows it. It may still have it: a missing scan is not a "no".
 * `how` says what shows it, in words and names only, never a value of the device.
 */

const types = require("../types");
const tutk = require("../tutk/client");

const M = types.DeviceModels;

// What a camera is checked for, in the order shown.
const CAMERA_CHECKLIST = [
  ["nightVision", "Night vision (set over your network)"],
  ["irLed", "Infrared LED"],
  ["floodlight", "Floodlight"],
  ["spotlight", "Spotlight"],
  ["siren", "Siren"],
  ["motionDetection", "Motion detection setting"],
  ["soundDetection", "Sound detection setting"],
  ["alarmSounds", "Smoke and CO alarm sound listening (read only)"],
  ["doorbell", "Doorbell button"],
  ["sdCard", "SD card status"],
  ["wifiSignal", "Wi-Fi signal strength"],
  ["battery", "Battery"],
];

const has = (list, model) => Array.isArray(list) && list.includes(model);

// group name -> names of the properties that came back with a value, from a report entry. Capability discovery has
// them for every group it asked about; the plain devicemgmt read has them for the model's own list.
function groupsOf(entry) {
  const out = {};
  const dm = entry && entry.devicemgmt && entry.devicemgmt.answered && entry.devicemgmt.capabilities;
  if (dm && typeof dm === "object") {
    for (const [group, props] of Object.entries(dm)) {
      const names = Object.entries(props || {}).filter(([, v]) => v !== null && v !== undefined).map(([k]) => k);
      if (names.length) out[group] = names;
    }
  }
  const found = entry && entry.capabilityDiscovery && entry.capabilityDiscovery.accepted;
  if (found && typeof found === "object") {
    for (const [group, names] of Object.entries(found)) if (Array.isArray(names) && names.length) out[group] = names;
  }
  return out;
}

// K10020 camera params, from a local probe result: { "13": 1, ... } or null
function paramsOf(local) {
  const answer = local && local.answers && local.answers.K10020 && local.answers.K10020.answer;
  return answer && typeof answer === "object" && !Array.isArray(answer) ? answer : null;
}

const answered = (local, code) => Boolean(local && local.answers && local.answers[code] && local.answers[code].answer);

/**
 * @param {object} input
 * @param {object} input.device the device list entry (product_model, product_type, device_params)
 * @param {object|null} [input.entry] one entry of a device report
 * @param {object|null} [input.local] what probeCamera returned for it
 * @returns {{ features: {key: string, label: string, state: string, how: string}[], backends: string[], notes: string[] }}
 */
function describeSupport({ device, entry = null, local = null }) {
  const model = device && device.product_model;
  const params = (device && device.device_params) || {};
  const groups = groupsOf(entry);
  const k20 = paramsOf(local);
  const props = entry && entry.propertyList && !entry.propertyList.error ? entry.propertyList : null;
  const features = [];
  const add = (key, label, state, how) => features.push({ key, label, state, how });

  // night vision: only the camera itself has it (the Wyze cloud does not)
  const skip = tutk.cameraLocalSkipReason(device || {});
  if (answered(local, "K10040")) add("nightVision", "Night vision (set over your network)", "yes", "the camera answered the night vision read");
  else if (!skip) add("nightVision", "Night vision (set over your network)", "likely", "it has the dtls flag, an address and its keys; run Test to confirm");
  else add("nightVision", "Night vision (set over your network)", "notSeen", skip);

  if ((k20 && [1, 2].includes(k20["50"])) || answered(local, "K10044")) add("irLed", "Infrared LED", "yes", "the camera answered the infrared LED read");

  // lights
  const dongle = params.dongle_product_model;
  const accessory = local && local.answers && local.answers.K10720 && local.answers.K10720.answer && local.answers.K10720.answer.accessoriesInfo;
  if (groups.floodlight) add("floodlight", "Floodlight", "yes", `devicemgmt floodlight has values (${groups.floodlight.join(", ")})`);
  else if (dongle) add("floodlight", "Floodlight", "yes", `the device list shows an accessory (${dongle})`);
  else if (accessory && String(accessory.status) === "1") add("floodlight", "Floodlight", "yes", "the camera reports an accessory of its own");
  else if (has(M.CAMERA_DEVICEMGMT, model) || has(M.CAMERA_LIGHT_DEVICEMGMT_TRY, model)) add("floodlight", "Floodlight", "likely", "the library treats this model as a floodlight camera");
  if (groups.spotlight) add("spotlight", "Spotlight", "yes", `devicemgmt spotlight has values (${groups.spotlight.join(", ")})`);
  else if (has(M.CAMERA_DEVICEMGMT_SPOTLIGHT, model)) add("spotlight", "Spotlight", "likely", "the library treats this model as having a spotlight");

  // siren
  if (props && Object.prototype.hasOwnProperty.call(props, "P1049")) add("siren", "Siren", "yes", "the property list has the siren (P1049)");
  else if (groups.siren) add("siren", "Siren", "yes", `devicemgmt siren has values (${groups.siren.join(", ")})`);

  // detection settings the camera keeps
  if (k20 && [1, 2].includes(k20["13"])) add("motionDetection", "Motion detection setting", "yes", "the camera's own settings have it (params 13 and 14)");
  if (k20 && [1, 2].includes(k20["15"])) add("soundDetection", "Sound detection setting", "yes", "the camera's own settings have it (param 15)");
  else if (Object.prototype.hasOwnProperty.call(params, "audio_alarm_switch")) add("soundDetection", "Sound detection setting", "likely", "the device list has audio_alarm_switch; run Test to confirm on the camera");
  if (k20 && [1, 2].includes(k20["17"]) && [1, 2].includes(k20["18"])) add("alarmSounds", "Smoke and CO alarm sound listening (read only)", "yes", "the camera's own settings have them (params 17 and 18)");

  if (has(M.DOORBELL, model)) add("doorbell", "Doorbell button", "likely", "the library treats this model as a doorbell");

  // status the cloud gives
  if (groups["memory-card-management"]) add("sdCard", "SD card status", "yes", `devicemgmt memory-card-management has values (${groups["memory-card-management"].join(", ")})`);
  if (groups.wifi && groups.wifi.includes("signal-strength")) add("wifiSignal", "Wi-Fi signal strength", "yes", "devicemgmt wifi has signal-strength");
  if (groups.battery) add("battery", "Battery", "yes", `devicemgmt battery has values (${groups.battery.join(", ")})`);
  else if (answered(local, "K10448")) add("battery", "Battery", "yes", "the camera answered the battery read");
  if (groups["motion-detection"]) add("motionSettings", "Motion alert settings", "yes", `devicemgmt motion-detection has values (${groups["motion-detection"].join(", ")})`);

  // devicemgmt groups with values that nothing above names
  const named = new Set(["floodlight", "spotlight", "siren", "memory-card-management", "wifi", "battery", "motion-detection"]);
  for (const [group, names] of Object.entries(groups)) {
    if (named.has(group) || group === "iot-device" || group === "device-info") continue;
    add(`devicemgmt:${group}`, `devicemgmt ${group}`, "yes", `values for ${names.join(", ")}`);
  }

  // a camera is listed against the full checklist, so what is missing shows too
  if (String((device && device.product_type) || "").toLowerCase() === "camera") {
    const present = new Set(features.map((f) => f.key));
    const why = entry || local ? "nothing read from it shows this" : "not scanned yet";
    for (const [key, label] of CAMERA_CHECKLIST) if (!present.has(key)) add(key, label, "notSeen", why);
  }

  const order = new Map(CAMERA_CHECKLIST.map(([k], i) => [k, i]));
  features.sort((a, b) => (order.has(a.key) ? order.get(a.key) : 99) - (order.has(b.key) ? order.get(b.key) : 99));

  const backends = [];
  if (props) backends.push(`classic Wyze API (${Object.keys(props).length} properties)`);
  const groupNames = Object.keys(groups);
  if (groupNames.length) backends.push(`devicemgmt (values for ${groupNames.join(", ")})`);
  if (local && local.authenticated) {
    const asked = Object.keys(local.answers || {}).length;
    const got = Object.values(local.answers || {}).filter((a) => a && a.answer).length;
    backends.push(`the camera itself over your network (${local.sessionForm || "session"}, ${got} of ${asked} reads answered)`);
  }

  const notes = [];
  if (!entry) notes.push("Nothing has been scanned yet: this shows only what the device list and the model tell. Scan it for more.");
  else if (!entry.capabilityDiscovery && !entry.devicemgmt) notes.push("The scan did not include capability discovery, so the newer Wyze API groups are not shown.");
  if (!local) notes.push("The camera itself has not been asked over your network. Run Test on its card to add what only the camera knows (night vision, the infrared LED, alarm settings).");
  notes.push("A feature that is not listed may still exist: not seen only means nothing read here shows it.");

  return { features, backends, notes };
}

module.exports = { describeSupport, groupsOf, CAMERA_CHECKLIST };
