# TODO

Last reviewed 2026-11-16. Items that were finished have been removed or moved to "Done" lines; what is left is below.

## Release 2.0.0-beta.4 (re-versioned from 2.1.0-beta.1, 2026-11-16)

The first `2.0.0-beta.4` (GitHub pre-release 2026-11-02) never reached npm. Its GitHub release, tag and `release/2.0.0-beta.4` branch were deleted, and the number is reused for this release. The version, changelog and release notes already say `2.0.0-beta.4`. The notes of the first attempt are kept in `docs/releases/2.0.0-beta.4-first-attempt.md`. Nothing has been published.

Before publishing:
- On npmjs.com, or with `npm login` then `npm stage list wyze-api` and `npm stage list homebridge-wyze-smart-home`, look for a staged publish of the first `2.0.0-beta.4` still waiting, and reject it (`npm stage reject <stage-id>`). If it were approved it would publish the old contents under this number. (npm on this machine is not logged in, so this has not been checked.)
- Push `2.0.0` in both repos (`wyze-api` first) and fast-forward `release/2.0.0-beta.4` to it. Then retarget the draft GitHub release `v2.0.0-beta.4` (it targets `2.x` for now) to `release/2.0.0-beta.4`.
- The plugin's CI fails at `npm install` until `wyze-api` `2.0.0-beta.4` is on npm (its range is `^2.0.0-beta.4`). Re-run it after publishing.
- Getting the release upstream, and the tags: see "Getting the release into the upstream repository" in `docs/releasing.md`. In short: merge commit (no squash or rebase), then `git fetch upstream --tags`, push our `v2.0.0-beta.3` to upstream, and push the upstream tags our fork lacks (`v0.1.1.9` to `v1.1.12`, `v2.0.0-beta.1`, `v2.0.0-beta.2`; in the plugin `v0.5.46`, `v0.5.47`, `v0.5.54`, `v0.5.56`, `v0.5.61`, `v2.0.0-beta.1`, `v2.0.0-beta.2`). Pushing branches or merging does not delete tags.
- After publishing: install both from the registry into a scratch Homebridge, start it and read the log.
- `npm audit` on the plugin flags axios 1.19.0 in the local install only (`package-lock.json` is ignored). Re-run it after `wyze-api` is published and fix if it is still there.

## Review of the merge PRs by jfarmer08 (2026-11-23)

His review of wyze-api #53 and of homebridge-wyze-smart-home #316 is answered by commits on `2.0.0` (the branch our `2.x` is renamed to), one commit per concern, each with tests. Nothing was run on a camera or a thermostat for the library items; the test bridge (`~/homebridge-test`) is the place for that. What is still open:

Decisions for the owner
- **Licensing of `src/util/devicemgmtProps.js`.** The header says "Ported verbatim" from SecKatie/wyzeapy (`payload_factory.py`, 557 lines). wyzeapy is GPL-3.0-only and this package is MIT. The property names are API facts, so the risk may be small, but the choice is: rewrite it independently, ask the wyzeapy authors, or accept it. Same decision for `_deviceMgmtParseState` and the spotlight model list, which mirror wyzeapy's `CameraService`.
- **Publishing.** `npm stage publish` has not been tried with the stage-only `NPM_TOKEN`; do a dry run of a staged release before the next release depends on it. Confirm the package owners and publish rights with jfarmer08, who is the only maintainer on npm.
- **Comments on an issue are not scanned for credentials.** That needs the plugin's issue workflows to run on `issue_comment`, which widens what they read. A maintainers' decision.

Limits that stay
- **A spoofed LAN address can disrupt the local camera session.** The session takes the source port of whatever packet arrives from the camera's IP, and an unauthenticated DTLS alert record can fail the handshake. The address is now only used when it is local, but anyone on the LAN who can spoof the camera's IP can still interfere. A protocol limit; the session only reads and, on request, sets night vision.
- **`setTempDirectory` is module-wide.** With two `WyzeAPI` instances that have different `persistPath`, the last one created decides where the short-lived SDP files go. Passing the folder down to each capture would fix it; nothing uses two instances today.
- **The sprinkler duration unit is unchecked.** HomeKit's `SetDuration` is seconds and is passed through unchanged to Wyze's quick run; it has not been tried against a controller.
- **Thermostat setpoints are whole degrees.** A half degree set from HomeKit is rounded.
- **CI skips Markdown-only changes** (`paths-ignore: **.md`), so the verify-device pull requests get no CI status; if branch protection requires checks, they stay pending. Actions are pinned to tags, not commits. The plugin has no lockfile, so a new `wyze-api` model can turn the known-models test red on an unrelated pull request.
- **The cloud thumbnail is tried first on purpose** (`0a96e61`), so the 30 s refresh and Quick Live View run only when it fails.

## Upstream repositories (`wyze-smart-home` org)

Plan: PR `2.0.0` (our branch, renamed from `2.x`) into upstream `2.0.0` as a merge commit (not a squash, or the histories diverge), then make `2.0.0` the default branch, then point the issue and template links there. Our `2.0.0` is 0 behind and 159 (`wyze-api`) / 190 (plugin) commits ahead of upstream `2.0.0`.

Checked 2026-11-16 (read only):
- Default branch is `main` (the old 0.5.x / 1.x line) in both. No branch protection or rulesets on `main` or `2.0.0`. Issues are on in both; Discussions only in the plugin.
- Upstream has only the old issue templates (`bug-report.md`, `feature-request.md`, `support-request.md`); `wyze-api` has none. Our `new-device.yml` and the triage, origin-label and verify-device workflows exist only in our fork, and issue events run workflows from the default branch.
- Actions: enabled, default token permission is read, and "Allow GitHub Actions to create and approve pull requests" is **off** (`verify-device` needs it on). A secret named `NPM_TOKEN` exists in both; its value and whether it works for `npm stage publish` are unknown.
- Upstream has old workflows (`greetings.yml`, `npm_publish.yml` / `npm-publish.yml`, and in `wyze-api` `label.yml`, `njsscan.yml`, `wiki-sync.yml`) that a merge of our tree would remove.
- To do: tell the maintainers (plugin issue #315 is the place), turn on the Actions setting above, check the `NPM_TOKEN`, then switch the default branch, then change the issue, template and discussion links (README, `.github/ISSUE_TEMPLATE/config.yml`, `src/plannedDevices.js`, `src/WyzeSmartHome.js`, `config.schema.json`, both `package.json` `bugs` URLs, the test fixtures). Leave the fork's own `repository`, `homepage`, badge and clone links.

## Homebridge verification (https://github.com/homebridge/plugins/wiki/Verified-Plugins)

Checked against the plugin on 2026-11-16: dynamic platform, no install scripts of its own, settings screen, files kept under Homebridge's storage folder, and no analytics all hold. Open:
- Done: CI tests Node 22, 24 and 26 in both repos (`wyze-api`'s `engines` stays `>=22`).
- The plugin installs process-wide `uncaughtException` and `unhandledRejection` handlers that only log. They were added on purpose (a bad accessory must not kill the child bridge) but they also swallow other plugins' errors. About 100 async entry points rely on them. Removing them needs a pass that finds the uncaught paths first.
- `ffmpeg-static` (a dependency of `wyze-api`) runs `node install.js` at install to download a binary into `node_modules`. `ffmpeg-for-homebridge`, which Homebridge camera plugins use, does the same. Ask Homebridge whether a dependency's install script counts, or make ffmpeg optional with the system `ffmpeg` as the fallback (`wyze-api` already falls back to it).
- Done: `engines.homebridge` is `^1.8.5 || ^2.0.0` (plugin commit `0bfaf36`), the README says so, and on 2026-11-16 the plugin and `wyze-api` 2.0.0-beta.4 (packed tarballs) were installed with `homebridge@1.11.4` on Node 22.23.5 in a scratch folder: the plugin loaded, registered its platform and logged its versions. Not run with real credentials there.
- Release notes are written for every published 2.x version (`docs/releases/`, in both repos). Still to do: create the GitHub releases for `2.0.0-beta.1` and `2.0.0-beta.2` in both repos, and for the plugin's `2.0.0-beta.4`.

## Login: `totpSecret` is deprecated (2026-11-16)

`totpSecret` is accepted, warned about once and never used; `mfaCode` still works as a one-time code. A fresh login with only the API key succeeded on this account, which has an authenticator app turned on. A 2024 report (plugin issue #306) shows some 2FA accounts did get a challenge, so one account is not proof for all.
- Watch for reports of a 2FA account that cannot log in; if they come, `mfaCode` is the only way in.
- Decide whether to remove the `totpSecret` field from the plugin's settings and the migrator in a later release. Today the field is kept, marked deprecated, so existing configs work.

## Rate limits (2026-11-16)

A 429, or a 503 with `Retry-After`, to a Wyze host is waited out (`src/util/rateLimit.js`). Nobody has measured how Wyze limits: per account, per endpoint or per host.
- Run against a real account with a debug log, then read `getRateLimitObservations()` (headers per host and path). If the numbers differ by path, change the shared per-host gate to a per-endpoint one.
- Done (2026-11-18): `app.wyzecam.com` answers the same `/app` calls as `api.wyzecam.com` (device list, property list and device info for all nine devices; the answers are identical except the expiring thumbnail URLs). And `api.wyzecam.com` now presents a chain through DigiCert Root G5 and Global Root G2, which Node 22.23.5, 24.18.0, 24.22.3 and 26.13.1 all trust with their default store, so the pin is not needed today on those versions (see `docs/FIX-node24-tls-cert.md`). Keep the pin: it costs nothing and covers a chain that reverts. Recheck from another network, since Wyze may serve different chains by region.

## New devices

- **Solar Cam Pan (`ME_WCO3`):** in the plugin's catalog and README as unsupported. wyzeapi's open PR 336 reads it through devicemgmt (like `AN_RSCW`), but its live view uses Agora ("lake"), not the Kinesis WebRTC stream the library uses. Nobody here owns one.
- **Solar Cam (October 2026):** no model code known yet; listed in the plugin README only.
- **Duo Cam Doorbell (`GW_DBD`), Window Cam (`GW_WC`), Battery Video Doorbell (`ME_DB1`, maybe `MR_BVD`):** in the catalog as unsupported; nothing is known about how they are controlled.
- Keep watching wyzeapy (0.8.1, 2026-11-05) and ha-wyzeapi (0.1.41) for new model codes. ha-wyzeapi's thermostat fix (setpoints must turn on the furnace or AC) may apply to our thermostat writes; not checked.

## General device report: one read-only script anyone can run

Goal: when someone reports a device that is missing or only partly works, we ask them to run one command and paste the result, instead of writing a new probe for each model.

Done and pushed to `2.x`: `scripts/device-report.js` and `src/deviceReport.js`, `tests/device-report.test.js`, the section in `scripts/README.md`, a "Reporting a device" section in `docs/README.md`, the changelog entry, and the camera test page's Other devices tab, which fills in the plugin's new-device form. A live read-only run on this account covered 10 devices with no MAC, name, IP, Wi-Fi name, serial or P2P id in the output.

Still to do:
- The plugin's new-device form and the triage bot's reply point to the camera test page, but not to the command-line script (`scripts/device-report.js`), which is what someone without the test page can run.
- Run it against a model nobody here owns, when a reporter does, and fix anything in the output that should have been removed.
- Decide whether `npx` access is worth it: the report needs the repo's `src/`, so people run it from a checkout for now.

## Floodlight v2 (`HL_CFL2`): the light switch does nothing (plugin issue #16, 2026-11-13)

Reporter: [identd113/homebridge-wyze-smart-home#16](https://github.com/identd113/homebridge-wyze-smart-home/issues/16). `set_property` on `P1056` returns `SUCCESS` but the light does not act, and the next poll still reads the old value. The Wyze app and Wyze Rules control the light, so the device works. We have no Floodlight v2 to test with.

Cause is a guess: `HL_CFL2` is in `CAMERA` but not in `CAMERA_DEVICEMGMT` or `CAMERA_LIGHT_RUN_ACTION` (`src/types.js`), so `_cameraLightSet` (`src/devices/cameras.helpers.js`) falls through to the plain `P1056` write. The Floodlight Pro (`LD_CFP`) had the same symptom until it moved to the devicemgmt API. The reporter already tried `run_action` (several names), `run_action_list`, sirius and iot3, and none worked. They have not tried devicemgmt. SecKatie/wyzeapy also writes `P1056` for `HL_CFL2` and does not list it under devicemgmt, so the Pro's property list may not fit.

**The reporter answered on 2026-11-14** (the issue's last comment): they attached a Homebridge log, said they redacted what needed it, and are willing to try a test build. It is now waiting on us; nobody has read the log yet.

1. ~~Read the attached log.~~ Done 2026-11-16: it covers startup only. `get_property_list` for `HL_CFL2` answers `SUCCESS`, the plugin reads `light=off, power=on`, and `get-streams` shows `iot-device::iot-state` and `iot-power`; the log line with the property list is cut off at about 2,000 characters before `P1056`, and the log holds no light toggle, so it neither confirms nor rules out devicemgmt.
1a. **Done in code, uncommitted (2026-11-16):** `CAMERA_LIGHT_DEVICEMGMT_TRY` in `src/types.js` makes `_cameraLightSet` try the devicemgmt `floodlight` capability first and fall back to `P1056` with a warning (tests in `tests/camera-lights.test.js`). A guess until the reporter confirms; if the light switches but the plugin's next poll flips it back, the state read (`P1056`) is stale for this model and needs the devicemgmt read too (`CAMERA_DEVICEMGMT` plus a `devicemgmtProps.js` entry). Ask the reporter for a debug log of one light toggle on this build.
2. Run the device report for `HL_CFL2` (it adds the devicemgmt `get_iot_prop` read, with the `LD_CFP` property list), or send the reporter a test build that does.
3. If the device answers, add `HL_CFL2` to `CAMERA_DEVICEMGMT` with the capability names it reports (and a `devicemgmtProps.js` entry), plus tests, then ask the reporter to confirm the light switches. Note in `docs/camera-properties.md` what `P1056` does on this model.
4. If it does not answer, ask for a capture of the Wyze app's traffic for one light toggle and look for the call it makes.
5. In the plugin, once the library change ships: bump `wyze-api`, run `npm run known-models`, check the README row for `HL_CFL2`, and close [#16](https://github.com/identd113/homebridge-wyze-smart-home/issues/16) when the reporter confirms.

## Night vision on other cameras (updated 2026-11-16)

Night vision now ships: `getCameraNightVision` and `setCameraNightVision` talk to the camera over the local network with a pure-JavaScript client (`src/tutk/client.js`), and the plugin has Night Vision and Night Vision Auto switches. It works for cameras the device list marks with the `dtls` flag (Cam v2, Cam v3, Doorbell v2 tested). The Wyze cloud does not report night vision for the Doorbell v2 (`docs/camera-properties.md`).

Not tested, because nobody here owns one: the devicemgmt property lists for the Floodlight Pro (`LD_CFP`), Battery Cam Pro (`AN_RSCW`), OG (`GW_GC1`, `GW_GC2`) and Pan v4 (`HL_PAN4`) name `night-shot`, `night-shot-state` and `infrared-mode`.
- When an owner reports one of those models, ask them to run `scripts/device-report.js` with night vision set to Off, then On, then Auto, and compare the three reports for those three names.
- If one changes, add night vision reading (and a setting, if `run_action` takes it) for that model.
- If none changes, the local client may be the only way, and it does not cover the Gwell protocol (OG, Pan v4); whether the Floodlight Pro and Battery Cam Pro carry the `dtls` flag is not known.

## Local camera client (TUTK in JavaScript): what is left

Done: the pure-JavaScript client ships in `src/tutk/client.js`, with night vision get and set and the plugin's switches. The older, wider native-library work stays parked in `future/`, unpublished.

- Set night vision on a Cam v3, once, and on a battery camera (the release notes list both as not verified; only the Doorbell v2 and the Cam v2 have had a write).
- Read the Cam v3s' `K10020` and other commands that are still unread, and add anything new to `docs/camera-properties.md`.
- Ask an owner of a battery camera (Outdoor v1/v2, Battery Cam Pro) for `--query 10448,10446,10020`: the wired cameras give no battery data, so battery is untested.
- Map the rest of the `K10020` params by changing one setting in the Wyze app at a time and diffing.
- Not built: the pre-DTLS session (cameras without the `dtls` flag), local video and audio, and cameras on the Gwell protocol (OG, Pan v4).
- Licence: the client credits go2rtc (MIT). Our older `future/tutk/lib` was ported from docker-wyze-bridge (AGPL-3.0); check what that means before it is ever published.

## Smoke and CO alarm sound settings on the camera (2026-11-18)

Found on the backyard Cam v3 (floodlight) by toggling "Smoke Alarm sound" and "CO Alarm sound" in the Wyze app's Alarm Settings and reading the camera's own settings (`K10020`, `device-report.js --local`): param 18 is the CO setting (toggling only CO moved 18 from 1 to 2 and left 17 alone), param 17 is Smoke by elimination. 1 is on, 2 is off. The cloud properties `smoke_alarm_switch` and `co_alarm_switch` did not move in four runs, so they are something else; the values live on the camera only. The first `K10020` read of a Cam v3.
- Done (2026-11-18): recorded in `docs/camera-properties.md`, and `getCameraAlarmSettings(mac)` reads them (`src/tutk/client.js`).
- Toggle Smoke alone once, to confirm 17.
- Detect a change: poll `getCameraAlarmSettings` (the camera does not push changes, and the cloud list never shows them). Local network only, seconds per read. Nothing polls it yet.
- Set them: not possible today. The client's only write is night vision (`K10042`), and it refuses commands outside the read-only list. Find the write command in docker-wyze-bridge's source first (it may be a general set-params command or none for these two), then add it the way night vision was done: read before, write, read back, and a switch that is opt-in and off by default, because turning these off silently stops smoke and CO alerts.
- Same method for other `K10020` params: change one setting in the app, read before and after.

### Smoke and CO sensors for the plugin (idea, 2026-11-18)

The params above are the setting (is the camera listening for T3 and T4 alarm tones), not a detection. A detection is an event: Wyze records an alert and sends a push. Event value 4 is smoke (`SMOKE: [4]` in `src/types.js`), 5 is probably CO. Lag is fine, as for the Motion and Sound sensors, which already come from the event list.
- **Create the sensors when the setting is on.** A Smoke Sensor and a Carbon Monoxide Sensor service on the camera, from the camera's own `getCameraAlarmSettings` answer, in the "Sensors" list like the other sensor types.
- **If the user turns it off in the Wyze app,** do not delete the accessory (that would drop its HomeKit automations and rooms): report `StatusActive` false so Home shows it as not responding, which is the "missing device" the user would expect, and log one line saying why. It comes back when the setting is on again.
- **If the setting cannot be read** (the camera is not on this network, has no `dtls` flag, or is a Gwell model), say so once in the log. Decide then whether to create the sensors anyway.
- **Needed first:** the real event shape. The smoke and CO event lists were empty over 7 days (`docs/endpoints.md`), so nobody has seen one: confirm that type 5 is CO and what a smoke or CO event holds (a sample from an owner, Wyze support, or a real test of a camera's alarm). Do not build the sensors against a guess.
- **Safety wording:** HomeKit treats these as critical alerts. Say "not a safety device" in the sensor name's help text and the docs: the camera only listens for a tone, and a poll adds delay.

## Which devices use which backend (framework mapping, 2026-11-18)

Goal: guess how a new model is controlled from what we know about similar ones. A first read-only probe of the 9 devices on one account (classic list, devicemgmt, iot3):

| Device | Classic list | devicemgmt | iot3 |
|---|---|---|---|
| Cam v2, Doorbell v2, two Cam v3 | answers (37 to 45 properties) | answers | nothing |
| Palm Lock (`DX_PVLOC`) | 5 properties | 12 values (device info, power, Wi-Fi) | lock status, online state |
| Chime sensors (`CHIME`) | 5 properties | 4 values (firmware, timezone, hardware version, online) | nothing |
| Doorbell v2's chime (`GW_CHI`) | nothing | answers, but only without the `camera` and `camera-ai` groups (device info, IP, power state) | nothing |
| Scale X (`WL_SC3`) | nothing | accepts the request, 0 values | nothing |

What it shows:
- devicemgmt is not camera-only. It answers a per-capability list and rejects the first group a device lacks (HTTP 400 "unsupported capability <name>"). Every list we ship (`src/util/devicemgmtProps.js`) includes `camera`, so `GW_CHI` is rejected with them. A trimmed list works.
- iot3 returns "success" for every device and only has values for locks, so judge it by values, not by the code.
- A device can answer on several backends. The classic list returning 0 properties means look elsewhere (`GW_CHI`, `WL_SC3`).
- The `GW_` model prefix is not a protocol family: `GW_CHI` is a chime, `GW_GC1` and `GW_GC2` are the Gwell-protocol OG cameras. `GW_CHI` was bound 13 minutes after the Doorbell v2 on the same account, so it is probably its chime (not proved; `parent_device_enr` is empty on all devices).

To do:
- Done (2026-11-18): `--discovery` (and a box on the camera test page's Other devices cards) adds a `capabilityDiscovery` section for every device (devicemgmt groups with a value, by name). Only some devices reject a group they lack (`GW_CHI`); most accept all and answer null, so judge by `withValues`. Still to add: iot3 for locks, and the Venus, Earth, Ford, Lockwood and Olive reads where the model could use them. Record which answered and how many values, never the values themselves.
- Support the doorbell's chime (`GW_CHI`) through devicemgmt (read only to start with: model, firmware, power state). Nothing in the library reads it today.
- Find out where the Scale X (`WL_SC3`) answers (probably Olive or Earth); the classic list and devicemgmt give nothing.
- Collect reports from other accounts (an OG, Pan v4, Duo Cam Doorbell, Window Cam) and build a model to backend table in `docs/`. Check the model-prefix guess against it (`HL_`, `GW_`, `AN_`, `LD_`, `DX_`, `CO_`, `JA_`, `BS_`, `WL_`, `YD.`).
- The devicemgmt answers for the Palm Lock and chimes include IP, MAC and Wi-Fi fields: scrub them in any saved report.

## Found on 2026-11-18, to follow up (read only, one account)

Details are in `docs/camera-properties.md` ("What the Cam v3 answered") and `docs/endpoints.md` ("Checked on 2026-11-18").
- **Floodlight settings on the camera (`K10720`):** the Cam v3 with the floodlight answers `brightness`, `mode`, `durations`, PIR sensitivity and more. The plugin has an on/off floodlight only. To expose brightness or duration we need the scale of `brightness` (226 is above 100), what `mode` 3 means, and a write command (same research as the alarm toggles). Check the app's floodlight settings against the values by changing one at a time.
- **Sound detection:** `K10020` param 15 and the cloud `audio_alarm_switch` agree on both Cam v3s. Turn Sound detection off and on in the app, read both, and if they move together add a `soundDetection` reading (and a switch once there is a write).
- **`K10020` params 19, 23, 24, 25** differ between the two Cam v3 (0 and 1380, 104 and 224, 40 and 254, 0 and 1); unmapped.
- **`K10620` night check:** its third byte follows the IR LED on the two Cam v3; the rest is unknown.
- **devicemgmt `floodlight::on` is not the light's state** (it read true while the light was off and did not change when the light was switched). That weakens the Floodlight v2 devicemgmt guess: do not read it as state.
- **Rate limit:** the history is recorded now (`getRateLimitHistory()` in `src/util/rateLimit.js`: the last 100 answers per path, and a count of all). Still to do: run a few hundred calls and read it to see whether `remaining` is per account, host or endpoint. `devicemgmt-service-beta` sends no rate-limit headers.
- **Palm Lock** gets a `battery` group through devicemgmt (four values); check whether the plugin's battery reading already has the same data.

## Code review since beta.3 (2026-11-18, `wyze-api` only; the plugin's is separate)

Fixed on `2.x` (commit after `0a96e61`): the camera test page's night vision change waited on its own queue forever when run inside Homebridge, and kept the page's one-test lock (it is in the `release/2.0.0-beta.4` code too); card ids are now fixed to their device instead of their place in the list; `scrub` no longer drops keys like `capacity` and `microphone`.

Open, none urgent:
- **Thermostat setpoints go out as text first for every thermostat** (`src/devices/thermostat.js`), with no opt-in. If Wyze accepts the text and the unit ignores it, nothing falls back and nothing is logged. Consider a `thermostatSetpointAsText` option, or checking the answer, once someone with a `CO_EA1` reports on #317.
- **Floodlight v2 (`HL_CFL2`) light write:** `_deviceMgmtRunAction` returns the body without checking `code`, so a non-success answer skips the P1056 fallback, and each failed devicemgmt call logs an error before the warning. Check the code once there is a device to see what a failure looks like.
- **Module-level state in `src/index.js`:** `setTempDirectory` and the rate-limit logger are shared by every client in the process (the last constructed wins). Pass them per client if a host ever runs two.
- **A DTLS alert after the handshake** (`src/tutk/client.js`) does not reject the pending reads, so a dropped session waits out every command's 2 second timeout (about 38 seconds for a full probe). Reject the waiters on an alert.
- **The same `.env` loader is copied into seven scripts**, and a CRLF `.env` leaves a `\r` on the password in all of them. Move it to one `scripts/lib/loadEnv.js` and trim.
- **A 429 hold releases every waiting request at once** (`src/util/rateLimit.js`), which can trigger the next 429. Release them one at a time or with a little jitter.

## Housekeeping

- The `wyze-api` wiki sync workflow (`wiki-sync.yml`) checks that the wiki repository exists and skips with a notice if it does not, so it no longer fails. Wikis are on in `wyze-smart-home/wyze-api`; run the workflow once after the first page exists.
- Issues are disabled on `identd113/wyze-api`; problems and new devices go to the plugin repository.
- Look at the camera test page's sidebar (logo, links, versions) in a real browser; only the unit tests have checked it.

## Cutover to upstream's `2.0.0` as the default branch

Audited 2026-11-18. The ordered checklist is in `docs/releasing.md` ("Making `2.0.0` the default branch"), and the same section is in the plugin's. Done on `2.x` so far: CI and wiki-sync also run on `2.0.0`; the plugin's install action also tries `2.0.0`; wiki page for the local camera settings and the test page, and the rate-limit text in Troubleshooting. Not done: everything in the checklist from step 1. Do steps 3 to 5 as one commit after the merge, not before: until then the upstream pages they point to do not exist.

## Backlog: a device picker that writes the config, with product images

Asked for 2026-11-18. A page where a user picks their devices, chooses what to enable for each and how (for a camera: the extra HomeKit switches, sensors, snapshot refresh, night vision), and gets a config block to paste into Homebridge. Product pictures next to each device where possible.
- **Where it can live.** A GitHub wiki page cannot run JavaScript (scripts are stripped), so the picker needs another home: the plugin's settings screen (`homebridge-ui`, which already saves config the way Homebridge expects), the camera test page (it already lists the account's devices, so the pick is real, not typed), or a static page on GitHub Pages for people who have not installed anything. The first two know the real device list; the third needs the user to choose from the supported-model table.
- **Source of truth.** The model list and each model's options already exist in the plugin (`.github/scripts/known-models.json`, `device-names.json`, `config.schema.json`). Generate the picker's data from those, as `npm run known-models` does for the README, so it cannot drift.
- **Images.** Wyze's product pictures are Wyze's: check the licence before copying any into a repository, and prefer linking to a picture Wyze already serves for the device (the device list carries picture URLs for some models) over bundling one. Needs a look at what the device list gives per model, and a plain icon per kind as the fallback (`kind:camera`, `kind:light` and so on already exist).
- **Output.** Valid for both the flat and the nested config shapes (`configMigrator.js`), never containing a login; show a diff against the user's current config if the page can read it.

