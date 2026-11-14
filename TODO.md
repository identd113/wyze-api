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
