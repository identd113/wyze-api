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

module.exports = { buildIssueUrl, MAX_URL };
