# TODO

## General device report: one read-only script anyone can run (2026-11-13)

Goal: when someone reports a device that is missing or only partly works, we ask them to run one command and paste the result, instead of writing a new probe for each model. `scripts/probe-camera-properties.js` already does part of this for cameras (property list and device info, MACs replaced by `camera-1`, `camera-2`).

Done and committed on `2.x`, not pushed (2026-11-13): `scripts/device-report.js` and `scripts/device-report-lib.js`, `tests/device-report.test.js`, the section in `scripts/README.md`, and a "Reporting a device" section in `docs/README.md`. `_deviceMgmtGetIotProp` takes an optional third argument, the model whose property list to use. A live read-only run on this account covered 10 devices, and a check against the device list found no MAC, name, IP, Wi-Fi name, serial or P2P id in the output.

Still to do:
- Add a line to the next release's `CHANGELOG.md` section and release notes (the script and the new argument). It ships in the release after beta.4.
- Link it from the plugin's new-device issue form (`.github/ISSUE_TEMPLATE/new-device.yml`) and from the bot's reply, in the plugin repo.
- Run it against a model nobody here owns, when a reporter does, and fix anything it shows in the output that should have been removed.
- Decide whether `npx` access is worth it: the report needs the repo's `src/`, so people run it from a checkout for now.

## Floodlight v2 (`HL_CFL2`): the light switch does nothing (plugin issue #16, 2026-11-13)

Reporter: [identd113/homebridge-wyze-smart-home#16](https://github.com/identd113/homebridge-wyze-smart-home/issues/16). `set_property` on `P1056` returns `SUCCESS` but the light does not act, and the next poll still reads the old value. The Wyze app and Wyze Rules control the light, so the device works. We have no Floodlight v2 to test with.

Cause is a guess: `HL_CFL2` is in `CAMERA` but not in `CAMERA_DEVICEMGMT` or `CAMERA_LIGHT_RUN_ACTION` (`src/types.js`), so `_cameraLightSet` (`src/devices/cameras.helpers.js`) falls through to the plain `P1056` write. The Floodlight Pro (`LD_CFP`) had the same symptom until it moved to the devicemgmt API. The reporter already tried `run_action` (several names), `run_action_list`, sirius and iot3, and none worked. They have not tried devicemgmt. SecKatie/wyzeapy also writes `P1056` for `HL_CFL2` and does not list it under devicemgmt, so the Pro's property list may not fit.

Waiting on the reporter: plugin and `wyze-api` versions, a debug log, and whether they will run a test build (we asked in the issue's comment of 2026-11-13).

1. Use the general device report above here (for `HL_CFL2` it adds the devicemgmt `get_iot_prop` read, with the `LD_CFP` property list).
2. Post the steps on the issue and ask the reporter to run it.
3. If the device answers, add `HL_CFL2` to `CAMERA_DEVICEMGMT` with the capability names it reports (and a `devicemgmtProps.js` entry), plus tests, then ask the reporter to confirm the light switches. Note in `docs/camera-properties.md` what `P1056` does on this model.
4. If it does not answer, ask for a capture of the Wyze app's traffic for one light toggle and look for the call it makes.
5. In the plugin, once the library change ships: bump `wyze-api`, run `npm run known-models`, check the README row for `HL_CFL2`, and close #16 when the reporter confirms.

## Night vision: ask an owner of a devicemgmt camera (2026-11-14)

The Doorbell v2 (`HL_DB2`) does not report night vision anywhere in the cloud (`docs/camera-properties.md`). The devicemgmt property lists for the Floodlight Pro (`LD_CFP`), Battery Cam Pro (`AN_RSCW`), OG (`GW_GC1`, `GW_GC2`) and Pan v4 (`HL_PAN4`) do name `night-shot`, `night-shot-state` and `infrared-mode`, but nobody here owns one to test.

- When an owner reports one of those models, ask them to run `scripts/device-report.js` with night vision set to Off, then On, then Auto, and compare the three reports for `night-shot`, `night-shot-state` and `infrared-mode`.
- If one of them changes, add night vision reading (and a setting, if `run_action` takes it) for that model.
- If none changes, night vision stays on the camera and needs TUTK (`K10040` / `K10042`), which only runs on Linux.

## TUTK in JavaScript: what is left (2026-11-14)

Phase 1 and 2 work: `future/tutk/spike/tutk-spike.js` authenticates against all four cameras (pure JavaScript, no native library) and reads and sets night vision. See `docs/camera-properties.md`.

- Read the two Cam v3s with `--query` (they answered the same way for night vision, but `K10020` and the others are unread), and add anything new to the doc.
- Set night vision on a Cam v3, once, with `--restore` (only the Doorbell v2 and the Cam v2 have had a write).
- Ask an owner of a battery camera (Outdoor v1/v2, Battery Cam Pro) to run `--query 10448,10446,10020`: the wired cameras give no battery data, so battery is untested.
- Build the module: a `wyze-api` method (`getStats`, night vision get/set), keeping the spike as the reference. Decide how the plugin exposes night vision (HomeKit has no standard Off/Auto/On control).
- Map the rest of the `K10020` params by changing one setting in the Wyze app at a time and diffing.
- Not built: the pre-DTLS session (cameras without the `dtls` flag), local video and audio, and cameras on the Gwell protocol (OG, Pan v4).
- Licence: the spike credits go2rtc (MIT). Our older `future/tutk/lib` was ported from docker-wyze-bridge (AGPL-3.0); check what that means before a release.
