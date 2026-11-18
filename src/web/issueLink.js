"use strict";

/**
 * Builds the link that opens a GitHub issue form with some of its fields already filled in, from the result of
 * a camera test. Nothing is sent: GitHub shows the form with the values in it, and the person reads, edits and
 * submits it (or closes it). Only what the test already shows is used: the model, the firmware, which steps
 * passed and how many commands were answered. It never holds an address, id or key.
 *
 * GitHub allows a link of about 8000 characters, so the long parts are left out first if it would not fit.
 */

const MAX_URL = 7000;
const NIGHT = { 1: "on", 2: "off", 3: "auto" };

/**
 * @param {object} form  { url, template, origin, plugin, kind, deviceLabel(model) }, from the host program
 * @param {{model: string, firmware?: string}} camera
 * @param {object} [result] what probeCamera returned
 * @returns {string|null} null when the host gave no form
 */
function buildIssueUrl(form, camera, result) {
  if (!form || !form.url || !/^https:\/\/github\.com\//.test(form.url)) return null;
  const label = typeof form.deviceLabel === "function" ? form.deviceLabel(camera.model) : undefined;
  const fields = [["template", form.template || "new-device.yml"]];
  if (label) fields.push(["device", label]);
  else fields.push(["model", camera.model]); // a model the form's list does not have
  if (form.kind) fields.push(["kind", form.kind]);
  if (form.plugin) fields.push(["plugin", form.plugin]);
  if (form.origin) fields.push(["origin", form.origin]);

  const long = [];
  if (result) {
    const answers = result.answers || {};
    const asked = Object.keys(answers).length;
    const answered = Object.values(answers).filter((a) => a.answer).length;
    const night = answers.K10040 && answers.K10040.answer && answers.K10040.answer.value;
    const test = {
      reachable: !!result.reachable,
      sessionForm: result.sessionForm || null,
      dtlsHandshake: !!result.dtlsHandshake,
      avLogin: !!result.avLogin,
      authenticated: !!result.authenticated,
      ...(asked ? { answered: `${answered} of ${asked}` } : {}),
      ...(NIGHT[night] ? { nightVision: NIGHT[night] } : {}),
      ...(result.error ? { error: String(result.error).slice(0, 200) } : {}),
    };
    // product_model first: the issue form's check looks for the model code in this text
    const blob = { product_model: camera.model, product_type: "Camera", ...(camera.firmware ? { firmware_ver: camera.firmware } : {}), camera_test_page: test };
    const steps = result.authenticated
      ? `reached the camera (${result.sessionForm} form), opened the secure session, logged in and authenticated`
      : result.error ? `stopped: ${String(result.error).slice(0, 200)}` : "did not authenticate";
    const sentence = `Tested with the camera test page (read only): ${steps}${asked ? `; ${answered} of ${asked} read-only commands answered` : ""}${NIGHT[night] ? `; night vision is ${NIGHT[night]}` : ""}.`;
    long.push(["details", sentence], ["blob", JSON.stringify(blob)]);
  }

  const make = (extra) => `${form.url}?${[...fields, ...extra].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
  let url = make(long);
  if (url.length > MAX_URL) url = make(long.filter(([k]) => k !== "details"));
  if (url.length > MAX_URL) url = make([]);
  return url;
}

// The issue form's "What kind of device is it?" options, picked from the product type Wyze gives.
function kindOf(type) {
  const t = String(type || "").toLowerCase();
  if (/camera|doorbell|cam/.test(t)) return "Camera or doorbell";
  if (/light|bulb/.test(t)) return "Light, bulb or light strip";
  if (/plug|outlet|switch/.test(t)) return "Plug, outlet or switch";
  if (/thermostat|roomsensor/.test(t)) return "Thermostat or room sensor"; // before "sensor", which would match a room sensor
  if (/sensor|contact|motion|leak|climate|gateway/.test(t)) return "Sensor (contact, motion, leak, climate)";
  if (/lock|keypad/.test(t)) return "Lock or keypad";
  if (/vacuum|sprinkler|irrigation|purifier|appliance/.test(t)) return "Vacuum, sprinkler or other appliance";
  return "Something else";
}

/**
 * The link for a device the host does not support, from what the report on it found (src/deviceReport.js: the
 * property list, device info and, for a camera, the devicemgmt read, already scrubbed of addresses and ids). The
 * report goes into the form's device information box when it fits in a link; if not, a short summary of it does,
 * and the person attaches the downloaded file. Nothing is sent: GitHub shows the form and the person submits it.
 * @param {object} form  as for buildIssueUrl
 * @param {{model: string, type?: string, firmware?: string}} device
 * @param {object} [report] one entry of the device report
 * @returns {string|null}
 */
function buildDeviceIssueUrl(form, device, report) {
  if (!form || !form.url || !/^https:\/\/github\.com\//.test(form.url)) return null;
  const label = typeof form.deviceLabel === "function" ? form.deviceLabel(device.model) : undefined;
  const fields = [["template", form.template || "new-device.yml"], ["report", "It is not supported yet"]];
  if (label) fields.push(["device", label]);
  else fields.push(["model", device.model]);
  fields.push(["kind", (typeof form.kindFor === "function" && form.kindFor(device.type)) || kindOf(device.type)]);
  if (form.plugin) fields.push(["plugin", form.plugin]);
  if (form.origin) fields.push(["origin", form.origin]);

  // product_model first: the issue form's check looks for the model code in this text
  const head = { product_model: device.model, ...(device.type ? { product_type: device.type } : {}), ...(device.firmware ? { firmware_ver: device.firmware } : {}) };
  const make = (extra) => `${form.url}?${[...fields, ...extra].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
  if (!report) return make([]);

  const endpoints = report.endpoints || null;
  const props = report.propertyList && !report.propertyList.error ? Object.keys(report.propertyList).length : 0;
  const caps = report.devicemgmt && report.devicemgmt.answered ? Object.keys(report.devicemgmt.capabilities || {}) : [];
  const found = report.capabilityDiscovery && !report.capabilityDiscovery.stopped ? report.capabilityDiscovery : null;
  const sentence = `Wyze lists it as type ${device.type || "unknown"}, model ${device.model}${device.firmware ? `, firmware ${device.firmware}` : ""}. Collected with the camera test page (read only${endpoints && endpoints.propertyList ? `, from ${endpoints.propertyList.replace(/^POST /, "")} and ${(endpoints.deviceInfo || "").replace(/^POST /, "")}` : ""}): ${props ? `${props} properties in the property list` : "no property list"}`
    + `${report.deviceInfo && !report.deviceInfo.error ? "; device info answered" : "; device info did not answer"}`
    + `${report.devicemgmt ? (report.devicemgmt.answered ? `; devicemgmt answered with ${caps.length} capabilities` : "; devicemgmt did not answer") : ""}`
    + `${found ? `; devicemgmt has values for ${found.withValues.length ? found.withValues.join(", ") : "no group"}${found.rejected.length ? ` and rejected ${found.rejected.length} groups` : ""}` : ""}.`;
  const summary = {
    ...head,
    ...(endpoints ? { endpoints } : {}),
    device_report: {
      property_count: props,
      device_info_answered: !!(report.deviceInfo && !report.deviceInfo.error),
      ...(report.devicemgmt ? { devicemgmt_answered: !!report.devicemgmt.answered, devicemgmt_capabilities: caps } : {}),
      ...(found ? { devicemgmt_groups_with_values: found.withValues, devicemgmt_groups_rejected: found.rejected } : {}),
      note: "the full report is a downloaded file: drag it into the 'What the device does' box",
    },
  };
  const candidates = [
    [["details", sentence], ["blob", JSON.stringify({ ...head, ...(endpoints ? { endpoints } : {}), device_report: report })]],
    [["details", sentence], ["blob", JSON.stringify(summary)]],
    [["blob", JSON.stringify(summary)]],
    [["blob", JSON.stringify(head)]],
  ];
  for (const extra of candidates) {
    const url = make(extra);
    if (url.length <= MAX_URL) return url;
  }
  return make([]);
}

module.exports = { buildIssueUrl, buildDeviceIssueUrl, kindOf, MAX_URL };
