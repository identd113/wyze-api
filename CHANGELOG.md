# wyze-api

## Releases

### v2.0.0-beta.3

Consolidates the fork's post-beta.2 fixes onto the 2.0.0 line.

- **Open connections (`cameraWarmUp`).** A WebRTC connection to a camera can be opened ahead of a stream and kept for a while; a live stream of that camera takes it over (nothing left to connect), and `cameraWarmSnapshot` makes a JPEG from its latest keyframe. Keyframe detection now sees fragmented IDR slices, and a keyframe handed to a stream gets the camera's SPS/PPS in front of it when it has none.
- **Faster first picture on a live stream.** The camera's first keyframe is held until ffmpeg is running instead of being lost (which used to cost a second keyframe request), each camera's SPS/PPS are remembered so ffmpeg can start before the camera's first packets arrive, and `prefetchCameraConnection` lets the caller fetch the connection details ahead of time. A debug `timing:` line per live stream shows where the time went. `getCameraSnapshotImage` also accepts `deviceModel` to skip a device-list request, and `cameraGetEventsMulti` reads the event list for several cameras in one request.
- **Smoother camera audio on lossy links.** Audio packets that arrive late or out of order are put back in sequence, and packets that never arrive are replaced with silence for that 20 ms slot, so ffmpeg no longer sees holes ("RTP: missed N packets") that were heard as crackle. In-order audio is unchanged and adds no delay. Each stream logs a one-line audio summary (packets, reordered, filled, late) when it ends. In a lab test with 3% loss and 60 ms jitter, the "missed packets" warnings dropped from 15 to 0.
- **Breaking:** the constructor now throws when `username` is empty (previously it failed later at login). Callers that build a client without credentials must handle the error.
- **Requires Node.js 22 or newer** (`engines.node` is now `>=22`). `werift` is upgraded to `^0.25.1`, which needs Node 22 and clears the `ip` (SSRF) and `uuid` audit findings; `npm audit --omit=dev` is now clean. Homebridge 2.x already requires Node 22+.
- **Wyze Cam Pan v4 (`HL_PAN4`) support**, ported from SecKatie/wyzeapy: uses the devicemgmt API for power, siren, spotlight and state. Also registered in the camera model lists.
- **Bulb Cam (`HL_BC`) light now works**: wyzeapy switches it with `run_action` (`floodlight_on` / `floodlight_off`); writing `P1056` is accepted but does nothing (#293). Reading state is unchanged.
- **devicemgmt state reads** (`cameraGetDeviceMgmtState`, per-model property lists ported from wyzeapy) so Floodlight Pro, Battery Cam Pro, OG and Pan v4 report light, siren, motion and power state.
- The raw-value camera methods the plugin calls (`cameraSpotLight`, `cameraFloodLight`, `cameraSiren`, `cameraPrivacy`, `cameraNotifications`) now route devicemgmt cameras to the right API; other models behave as before. Previously they sent `P1056` / `run_action` to cameras that ignore them.
- Floodlight v2 (`HL_CFL2`) is registered as a camera model. Its light still uses `set_property P1056`, exactly as wyzeapy does; the toggle reported in #264 has no known fix yet.
- **`totpSecret` option**: generates the 2FA code from the authenticator secret on every login (RFC 6238), waits out near-expiry/reused codes and retries once with the next window. `mfaCode` still works; `totpSecret` takes precedence. Secret is redacted from logs.
- `totpSecret` and `mfaCode` are cleaned and validated: spaces, newlines, dashes, quotes, invisible copy/paste characters and a pasted `otpauth://` URI are tolerated, and a malformed value fails login with a clear message (without echoing it).
- The `totpSecret` retry only happens when Wyze answers without issuing a token. A throttled response no longer spends a second code and fires another login immediately, and network errors and Wyze error codes are not retried.
- **Snapshot capture no longer times out on cameras that don't repeat their H.264 parameter sets**: `captureStreamFrame` now holds the incoming RTP until the camera's SPS/PPS are known (from the answer SDP, or read from the RTP), starts ffmpeg with them in its SDP, replays the held packets and keeps asking the camera for a keyframe until it has them. Previously ffmpeg failed with "non-existing PPS 0 referenced" / "Output file does not contain any stream" and the HomeKit tile never got a picture. Checked on real hardware: the old code failed on both werift 0.20.1 and 0.25.1 (so the werift upgrade is not the cause); the new code produced a JPEG in about 4 s on 6 of 6 tries on two cameras.
- **Wyze Cam Doorbell v2 (`HL_DB2`) is recognized as a camera**, so snapshots and live video work for it. `cameraGetStreamInfo` no longer reports a camera as off when the model doesn't report `iot-device::iot-power` (only an explicit `0` does), and its "offline"/"off" errors no longer include the signed stream URL and auth token. The doorbell's WebRTC stream is 640x480 at 15 fps. Power, siren and notification writes for it are not verified yet.
- The Doorbell v2 can't be powered off through the API: `run_action power_off` is answered with `result: 3`, and the devicemgmt `sleep` is acknowledged with success while the camera keeps streaming (checked on real hardware). `cameraSupportsPowerControl(model)` is false for it (`DeviceModels.CAMERA_NO_POWER_CONTROL`) so a caller can avoid offering a switch that does nothing.
- **Live streams and snapshots no longer collide on local UDP ports**: ports for ffmpeg were picked by opening and releasing a socket, so two requests could be handed the same number, and the audio port could sit on the RTCP port ffmpeg binds next to the video port ("bind failed: Address already in use", costing a reconnect and several seconds before video). Ports are now remembered for two minutes and only handed out when the RTCP neighbour is free.
- **Camera WebRTC sessions are exclusive and closed cleanly.** A camera (the Doorbell v2 at least) serves one viewer, and sessions used to be dropped abruptly: `pc.close()` was never awaited, signaling was closed first, a failed or timed-out negotiation left its peer connection and sockets open, and nothing closed live sessions on shutdown. Now there is at most one session per camera, a new session waits until the previous one has fully closed (peer connection first, awaited), a snapshot capture never preempts a live stream (a stream that replaces a capture ends it at once), and a failed start releases everything. `closeAllCameraSessions()` closes every open session.
- The handle returned by `startCameraHKStream` has `isAlive()`, false once it is stopped or has given up reconnecting, so a caller that never receives a stop request (the Home app killed, the network dropped) can tell nothing is streaming any more.
- **A live stream whose reconnect fails is retried instead of being abandoned.** When the video stalled and the plugin reconnected, a camera that never answered the new session (it can keep holding the old viewer for a while) ended the stream for good, because only an ffmpeg exit scheduled a retry. Reconnecting now retries with a growing delay (up to 4 attempts), and a connection that stays up for 30 seconds starts with a fresh budget.
- **Camera audio reaches HomeKit.** Wyze cameras answer PCMU/8000 under a dynamic payload type (96), but the SDP given to ffmpeg only declared types 0 and 111, so every audio packet was ignored. The audio SDP now names the payload type the camera negotiated (`extractAudioCodec`), and a camera that negotiates audio but sends none (microphone off in the Wyze app) continues video-only instead of restarting its audio process. Verified with the Doorbell v2; a v3 sent no audio with its microphone off.
- **Live streams and snapshots no longer degrade the longer Homebridge runs.** The H.264/audio codec objects were shared by every WebRTC session, and werift numbers payload types by mutating them, so after a stream with audio had run, later sessions got video payload type 98 instead of 96. The SDP handed to ffmpeg hardcoded 96, so ffmpeg silently ignored every packet: a snapshot taken while a stream was open timed out, and live views that worked right after a restart turned into "video idle" and a still picture. Codec objects are now created per session, and the video SDP names the payload type the camera actually negotiated. A fresh local port is also chosen for every stream (re)connect attempt, and snapshot captures keep asking the camera for a keyframe until a frame has come out.
- **Restored 2FA/MFA login** (TOTP via the `mfaCode` option). MFA handling was accidentally dropped in the Feb 2024 "Clean up MFA" commit; see `FIX-mfa-login.md`. Not yet verified against a live 2FA account.
- **Fixed the persisted-token loop** that permanently blocked re-login after a stale/invalid token file (see `BUG-persisted-token-loop.md`).
- **Username validated at construction** instead of failing cryptically later.
- Refresh timer fired every ~2.9 minutes (seconds passed where milliseconds were required); now 48 hours. Added `destroy()` to stop the timer.
- Concurrent `refreshToken()` calls now share one in-flight refresh instead of racing.
- Removed dead duplicate `olive_create_signature` / `ford_create_signature` and the unused `querystring` import.
- `setIotProp` parameter renamed `product_model` -> `deviceModel` for consistency.
- Added live and structural tests for the pinned TLS CA fix (`scripts/verify-tls-pin.js`, `scripts/verify-live.js`).
- Saved tokens are no longer deleted when a refresh fails for a transient reason (network error, timeout, 5xx); they are cleared only when Wyze actually rejects them. A one-shot `mfaCode` cannot redo a full login, so wiping good tokens on a blip could lock the plugin out.
- **Security**: the persisted token file is now written owner-only (`0600`), since it holds the access and refresh tokens and an existing token file saved by an older version (which may have been readable by other users) is tightened to `0600` the next time it is loaded or saved.
- Dependency updates from `npm audit fix` (axios, ws, follow-redirects, form-data and others); production vulnerabilities down from 8 to 3. The remaining 3 sit in the `werift` WebRTC chain and need a breaking upgrade.

### v2.0.0-beta.2

Merges `main`'s unreleased fixes (since the 2.0.0 branch's last sync at v1.1.11) into the 2.0.0 line. `main` and `2.0.0` had structurally diverged — `main` kept the monolithic `index.js`, `2.0.0` had already split into `src/devices/`/`src/services/` — so this was a manual reconciliation, not a mechanical merge.

- **TLS root-pinning fix** (`src/httpsAgent.js` + bundled DigiCert roots) — fixes `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` on Node 24.18.0+, where the NSS 3.123.1 root-store update dropped the legacy DigiCert Global Root CA that `api.wyzecam.com` and `yd-saas-toc.wyzecam.com` depend on. Wired via `axios.defaults.httpsAgent` rather than `axios.create()` so it applies to every file that independently `require`s axios (devices/services/util), not just `index.js`.
- **Ford API lock-signing fixes** for the original Wyze Lock (YD.LO1) — `getLockInfo` was sending unsigned GET params, and the token field name needs to differ by HTTP method (`access_token` for GET, `accessToken` for POST). Resolves `PARAM_SIGN_INVALID` / `PARAM_TIMESTAMP_INVALID`. (This branch's `src/utils/payloadFactory.js` already had equivalent logic independently — confirmed identical behavior, no functional change needed there.)
- Camera-streaming bug fixes: replaced `moment().valueOf()` with `Date.now()`, fixed a missing `this.` context on a `runActionList` fallback call, removed the unused `moment` dependency.
- **Fixed the `DX_PVLOC` (Palm Lock) dual-registration bug**: it was registered in both `LockBoltV2Models` and `CommonModels` in `types.js`, which could route Palm Lock devices to the generic switch handler instead of the lock accessory depending on dispatch order. Now only in `LockBoltV2Models`.
- Typo fix in `package.json` description (`unoficial` → `unofficial`).

### v2.0.0-beta.1

First 2.0 beta. Available on npm only via `npm install wyze-api@beta`. Stable users on the default `latest` tag are unaffected. Pairs with `homebridge-wyze-smart-home@2.0.0-beta.1`.

48 commits since the last stable. Major reorganization, new device support, security hardening, full HomeKit camera streaming primitives, and a custom logger.

#### 🏗️ Major reorganization

The monolithic `index.js` was split into per-family modules:
- `src/devices/cameras.js`, `bulbs.js`, `locks.js`, `sensors.js`, `vacuum.js`, `irrigation.js`, `hms.js`, `thermostat.js`
- Each family has a companion `*.helpers.js` for device-object wrappers and pure accessors (the API used by homebridge accessory classes).
- Service primitives extracted to `src/services/` (`olive.js`, `ford.js`, `iot3.js`, `venus.js`, `devicemgmt.js`, `hms.js`).
- Crypto and payload signing moved to `src/utils/`.

The public surface (`require('wyze-api')`) is unchanged — every method that worked before still works, and many new ones now exist as named exports.

#### 🎥 HomeKit camera streaming primitives

Everything a HomeKit `CameraController` needs to drive Wyze cameras end-to-end:

- **`getCameraWebRTCConnectionInfo(mac, model, options)`** — returns `{signalingUrl, iceServers, authToken, clientId, mac, model, substream, cached}` with ICE servers normalized for `RTCPeerConnection`. 60s in-memory cache per `(mac, substream)`.
- **`getCameraWebRTCConnectionInfoWithReconnect`** + **`cameraStreamWithReconnect`** — exponential-backoff retry wrappers.
- **Lower-level**: `cameraGetStreamInfo`, `cameraGetSignalingUrl`, `cameraGetIceServers` (all accept `{substream}`).
- **`startRtpForwarding`** + **`cameraStartRtpForwarding`** — bridges a Wyze WebRTC session into a HAP-compatible SRTP stream.
- **`cameraCaptureSnapshot(mac, model, [options])`** — headless WebRTC capture: negotiates a session, grabs one JPEG via bundled ffmpeg, tears down. 10s per-mac cache.
- **`getCameraSnapshotImage(mac, [options])`** — unified getter; cloud thumbnail first, falls back to live capture. Returns `{buffer, source}`.
- **Camera lookup helpers**: `getCameras`, `getOnlineCameras`, `getOfflineCameras`, `getCamera(mac)`, `getCameraByName(nickname)`, `getCameraSnapshot(mac)`, `getCameraSnapshotUrl(mac)`, `getCameraSummaries`.
- **Pure device-object helpers**: `cameraIsOnline`, `cameraGetThumbnail`, `cameraGetSnapshot`, `cameraToSummary`, `cameraGetSignalStrength`, `cameraGetIp`, `cameraGetFirmware`, `cameraGetTimezone`, `cameraGetLastSeen`.
- **Audio**: Opus codec support end-to-end (16/24 kHz).
- **`StreamStatus`** lifecycle constants (numeric values mirror docker-wyze-bridge).
- **New deps**: `werift` (WebRTC), `ws` (signaling), `ffmpeg-static` (bundled binary, no system install).

#### 🎯 `shared/homekit.js` — single source of truth for converters

All Wyze ↔ HomeKit value conversions live in one module that bridges import directly:
- Color converters: `wyzeColorToHomeKit`, `homeKitColorToWyze`
- Brightness / color temperature with proper clamping (`checkBrightnessValue`, `checkColorTemp`, `kelvinToMired`, `miredToKelvin`)
- Temperature: `fahrenheitToCelsius`, `celsiusToFahrenheit`
- Garage door state mapping (`wyzeGarageDoorStateToHomeKit`)
- Vacuum: `parseVacuumMode`, `wyzeVacuumModeIsCleaning`, `wyzeVacuumSuctionToHomeKit`, `homeKitRotationSpeedToWyzeSuction`
- HMS state: `wyzeHmsStateToHomeKit`, `homeKitHmsStateToWyze`
- Wyze Room Sensor (CO_TH1) battery enum → HomeKit StatusLowBattery
- Lock Bolt V2 device helpers
- Battery: `checkLowBattery` (honors per-instance `lowBatteryPercentage`)

#### 📦 `WyzeAccessoryModels` — exported model maps

Shipping a frozen `WyzeAccessoryModels` object as the source of truth for product-code → device-class routing. Bridges import this and shallow-clone into per-category maps that can be extended at runtime via user config (`deviceTypeOverrides`). One place to add a new model code; all consumers pick it up.

Categories: `CameraModels`, `OutdoorPlugModels`, `PlugModels`, `LightModels`, `MeshLightModels`, `LightStripModels`, `ContactSensorModels`, `MotionSensorModels`, `LockModels`, `LockBoltV2Models`, `TemperatureHumidityModels`, `LeakSensorModels`, `CommonModels`, `S1GatewayModels`, `ThermostatModels`, `ThermostatRoomSensor`, `VacuumModels`, `IrrigationModels`.

#### 🔐 New `WyzeLogger`

`@ptkdev/logger` removed. New custom logger in `src/util/wyzeLogger.js`:
- Format matches Homebridge style (timestamp, cyan prefix, color-coded level tag).
- Constructor option `logLevel: "error" | "warn" | "info" | "debug"`. Legacy `apiLogEnabled: true` still works (maps to `debug`).
- New `redact: false` option to bypass log redaction for self-debugging.
- ANSI colors on by default (homebridge stdout isn't a TTY but handles ANSI fine).
- Honors `NO_COLOR` env var.

#### 🛡️ Security hardening consolidated

`src/util/redact.js` and `src/securityHardening.js` merged into `src/util/security.js`. Single module covers:
- Log redaction (bearer tokens, credentials, GPS, addresses, emails, MACs)
- Secrets-file loader (mode-600 enforcement, env-var fallback for every credential field)
- Base URL validator (HTTPS-only, no IP literals, no `.local` / `.localhost`)
- Hostname allowlist (auto-derived from `*BaseUrl` constants in `constants.js`)
- Axios redirect guard (refuses 3xx on Wyze hosts)
- Device-name sanitization for HomeKit (length + control chars)

All hardcoded URLs removed from `services/`, `devices/hms.js`, and `index.js`. Adding a new endpoint in `constants.js` automatically allowlists its hostname.

#### 🆕 New device support / parity

- **Wyze Robot Vacuum (`JA_RO2`)** via the Venus service: `getVacuumDeviceList`, `getVacuum`, `getVacuumInfo` (combined snapshot), `vacuumClean`, `vacuumPause`, `vacuumDock`, `vacuumStop`, `vacuumSweepRooms(mac, [roomId])`, `vacuumSetSuctionLevel`, plus device-object helpers and pure accessors (`vacuumGetMode`, `vacuumGetFault`, `vacuumIsCharging`, etc.).
- **`getVacuumRooms(mac)`** — current map's room list as plain JSON `[{ id, name, mapId, mapName }]`. Backs the bridge's per-room sweep switches.
- **Wyze Sprinkler Controller (`BS_WK1`)**: `irrigationGetIotProp`, `irrigationGetDeviceInfo`, `irrigationGetZones`, `irrigationQuickRun`, `irrigationStop`, `irrigationGetScheduleRuns`.
- **Wyze Lock Bolt V2 (`DX_LB2`)** + **Palm Lock (`DX_PVLOC`)** via IoT3 API: `lockBoltV2GetProperties`, `lockBoltV2Lock`, `lockBoltV2Unlock`, `palmLockGetProperties`, plus general `iot3GetProperties` / `iot3RunAction`.
- **Wyze Lock V1 full read parity** with wyze-sdk — exposes battery, door state, lock state, RSSI, all the metadata wyze-sdk reads.
- **DeviceMgmt API** for newer cameras (Floodlight Pro / Battery Cam Pro / OG cam) that don't respond to the standard `run_action`: `_deviceMgmtRunAction`, `_deviceMgmtSetToggle`, `_deviceMgmtBuildCapability`. Routes camera commands automatically based on model.
- **Light Strip Pro per-subsection colors** — 16-subsection HEX support; closes the rest of #42.
- **Music mode**, **bulb effects**, **mesh-bulb sun-match**, **push notification info**, **bulb local-or-cloud routing fallback** — large parity batch with wyzeapy.
- **Camera event list** (`getEventList`), **motion-detection bug fixes**, **enum supplements** for new product codes.

#### 🐛 Reliability fixes

- **Refresh-token failure falls back to fresh `login()`.** Wyze invalidates refresh tokens server-side faster than the documented TTL; the previous behavior left consumers broken until host process restart. Now: clear tokens, re-login transparently, single warn line.
- **`mkdir -p` token persist directory before write.** HOOBS doesn't pre-create its persist dir; the first write threw `ENOENT` and the consumer never recovered. (homebridge-wyze-smart-home#201, #236)
- **`wyzeColorToHomeKit` guards bad input.** Wyze occasionally returns `null` / `""` / non-hex for `PID_COLOR` during state transitions; the previous parse threw. Now returns neutral `{hue:0, saturation:0}` on bad input.
- **V1 lock signing fix** — Ford API `PARAM_SIGN_INVALID` resolved by augmenting payload before signing + using snake_case for GET, camelCase for POST.
- **Olive-signed call consolidation** — single source of truth for olive signature generation across earth/sirius/platform/membership/lockwood.
- **`getVacuumInfo`** always fetches position + map (was gated behind unused `includeMap` flag).

#### 🚀 Breaking

- **Logger replaced** (see above).
- **Security utilities consolidated** into `src/util/security.js`. Re-exports preserved for the public surface (`installRedirectGuard`, `sanitizeLogMessage`, `WYZE_ALLOWED_HOSTNAMES`) — most call sites unaffected.
- **All base URLs centralized** in `constants.js`. Allowlist auto-derives.
- **Unused dependencies removed**: `aws-sdk`, `base64-js`, `colorsys`, `crypto-js`, `moment`, `urllib`. Cleared the critical `crypto-js` PBKDF2 advisory and the `aws-sdk` → `ip` SSRF chain.
- `axios` floor bumped to `^1.12.0`.

#### 📚 Wiki

Full library documentation at https://github.com/jfarmer08/wyze-api/wiki — every module covered.

#### 🔍 Internal

- 178/178 tests pass.
- Production npm audit: 4 issues remain, all from the `werift` WebRTC chain (transitive `ip` SSRF + `uuid` bounds); no upstream fix available, deferred.
- Two GitHub Actions workflows: `npm-publish-stable.yml` and `npm-publish-beta.yml`.

### v1.1.15
- Fix `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` TLS errors on Node 24.18.0+. Node's NSS 3.123.1 root store update dropped the legacy DigiCert Global Root CA, breaking `api.wyzecam.com` and `yd-saas-toc.wyzecam.com` (the host behind `getLockInfo`/`controlLock`). All axios requests now go through a shared `https.Agent` (`src/httpsAgent.js`) that pins the DigiCert roots Wyze depends on alongside Node's default trust store. See [FIX-node24-tls-cert.md](FIX-node24-tls-cert.md) for the root-cause writeup. Fixes [homebridge-wyze-smart-home#307](https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/307).

### v1.1.14
- Fix Ford API signing for original Wyze Lock (YD.LO1). Two bugs caused `PARAM_SIGN_INVALID` (`controlLock`) and `PARAM_TIMESTAMP_INVALID` (`getLockInfo`): `fordCreatePayload` signed over the original payload only instead of the full augmented payload (including `accessToken`/`key`/`timestamp`), and GET requests need `access_token` (snake_case) while POST requests need `accessToken` (camelCase). Fixes [homebridge-wyze-smart-home#300](https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/300).

### v1.1.13
- Fix `getLockInfo` sending unsigned params to the Ford API. `config.params` was assigned before `fordCreatePayload` was called, so the `GetLockInfo` GET request went out without `key`/`timestamp`/`sign`/`accessToken`, causing error 17001 `PARAM_TIMESTAMP_INVALID` on the original Wyze Lock (YD.LO1). Fixes [homebridge-wyze-smart-home#300](https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/300).

### v1.1.12
- Fix runtime crashes: replace `moment().valueOf()` with `Date.now()`; fix missing `this.` context on the `runActionList()` fallback call; replace global `print(token)` with `this.log.info(token)`.
- Lazy-load `cameraStreamCapture` so requiring `werift`/`ffmpeg-static` at module parse time no longer crashes consumers (e.g. homebridge plugins running in Docker) that don't have those optional deps installed.
- Remove the unused `moment` dependency.

### v1.1.11
- Add Wyze Robot Vacuum support (model `JA_RO2`) via the Venus service. Resolves [#4](https://github.com/jfarmer08/wyze-api/issues/4). Patterned after [shauntarves/wyze-sdk](https://github.com/shauntarves/wyze-sdk/blob/master/wyze_sdk/api/devices/vacuums.py).
- Venus auth/signing: new `venusGenerateDynamicSignature` and `venusRequestId` crypto helpers; new `venusBaseUrl`, `venusAppId`, `venusSigningSecret`, `vacuumModels`, `venusPluginVersion`, `vacuumFirmwareVersion`, `vacuumEventTrackingUuid` constants.
- Lookup: `getVacuumDeviceList`, `getVacuum(mac)`, `getVacuumInfo(mac)` (combined: list entry + iot props + device info + status + position + map; tolerant of partial sub-fetch failures).
- Reads: `getVacuumIotProp`, `getVacuumDeviceInfo`, `getVacuumStatus`, `getVacuumCurrentPosition`, `getVacuumCurrentMap`, `getVacuumMaps`, `getVacuumSweepRecords`.
- Controls (mac/model API): `vacuumControl` (low-level), `vacuumClean`, `vacuumPause`, `vacuumDock`, `vacuumStop`, `vacuumCancel`, `vacuumSweepRooms`, `vacuumSetSuctionLevel`, `setVacuumCurrentMap`.
- Device-object helpers (homebridge-style): `vacuumStartCleaning(device)`, `vacuumPauseCleaning(device)`, `vacuumReturnToDock(device)`, `vacuumCleanRooms(device, ids)`, `vacuumQuiet/Standard/Strong(device)`, `vacuumInfo(device)`.
- Pure info accessors: `vacuumGetBattery` (handles the Wyze `battary` typo), `vacuumGetMode`, `vacuumGetFault`, `vacuumIsCharging`, `vacuumIsCleaning`, `vacuumIsDocked`.
- Opt-in event tracking: `vacuumEventTracking(mac, type, value, args)` — mirrors the analytics ping the Wyze app sends. Not required for controls to take effect.
- Exports on `WyzeAPI`: `VacuumControlType`, `VacuumControlValue`, `VacuumStatus`, `VacuumSuctionLevel`, `VacuumPreferenceType`, `VacuumModeCodes`, `parseVacuumMode`, `VacuumFaultCode`, `VacuumIotPropKeys`, `VacuumDeviceInfoKeys`, `VenusDotArg1/2/3`, `VacuumControlTypeDescription`.
- New example: `example/vacuum.js` + `npm run vacuum` script.
- `src/types.js` now properly exports its constants (was previously dead code).

### v1.1.10
- Add camera WebRTC stream support. Port of [wyzeapy#230](https://github.com/SecKatie/wyzeapy/pull/230) plus production-ready helpers ported from the [`camera-stream`](https://github.com/jfarmer08/wyze-api/tree/camera-stream) reference branch.
- Primary: `getCameraWebRTCConnectionInfo(mac, model, options)` — returns `{signalingUrl, iceServers, authToken, clientId, mac, model, substream, cached}`. ICE servers are normalized to `{urls, ...}` for `RTCPeerConnection`; signaling URL is decoded and (optionally) has the generated client ID injected as `X-Amz-ClientId`. 60s in-memory cache per `(mac, substream)`.
- Convenience: `getCameraWebRTCConnectionInfoWithReconnect` (exponential-backoff retry), `cameraStreamWithReconnect` (general retry wrapper).
- Lower-level: `cameraGetStreamInfo`, `cameraGetSignalingUrl`, `cameraGetIceServers` — all accept `{substream}` option.
- Helpers: `createCameraStreamClientId`, `normalizeCameraSignalingUrl`, `setCameraSignalingClientId`, `sanitizeCameraIceServers`, `parseCameraStatus`, `clearCameraStreamCache`.
- `WyzeAPI.StreamStatus` lifecycle constants (numeric values mirror docker-wyze-bridge).
- Add `cameraCaptureSnapshot(mac, model, [options])` — headless WebRTC frame capture (negotiates a session, grabs one JPEG via ffmpeg, tears down). 10s per-mac cache. New deps: `werift`, `ws`, `ffmpeg-static` (bundled ffmpeg binary — no system install needed).
- Add `getCameraSnapshotImage(mac, [options])` — unified image getter; tries cloud thumbnail first, falls back to live capture. Returns `{buffer, source}`.
- Add camera lookup helpers: `getCameras`, `getOnlineCameras`, `getOfflineCameras`, `getCamera(mac)`, `getCameraByName(nickname)`, `getCameraSnapshot(mac)`, `getCameraSnapshotUrl(mac)`, `getCameraSummaries`.
- Add pure device-object helpers: `cameraIsOnline`, `cameraGetThumbnail`, `cameraGetSnapshot`, `cameraToSummary`, `cameraGetSignalStrength`, `cameraGetIp`, `cameraGetFirmware`, `cameraGetTimezone`, `cameraGetLastSeen`.
- Add `web_create_signature` crypto helper and `webAppId`/`webAppInfo`/`webSigningSecret` constants for the `app.wyze.com` web API.
- New example: `example/viewer.js` + `example/public/viewer.html` — a browser-based WebRTC viewer that exercises all the new camera helpers end-to-end.

### v1.1.9
- Add IoT3 API support for Lock Bolt V2 (DX_LB2) and Palm lock (DX_PVLOC)
- Add `lockBoltV2GetProperties`, `lockBoltV2Lock`, `lockBoltV2Unlock` for Bolt V2
- Add `palmLockGetProperties` for Palm lock
- Add `iot3GetProperties` and `iot3RunAction` as general IoT3 methods
- Add `palm-state` to `getIotProp` property keys

### v1.1.8
- Add irrigation/sprinkler support: `irrigationGetIotProp`, `irrigationGetDeviceInfo`, `irrigationGetZones`, `irrigationQuickRun`, `irrigationStop`, `irrigationGetScheduleRuns`

### v1.1.7
- Change Logging

### v1.1.6
- Refactor Wyze Auth & Core Api Fetching https://github.com/jfarmer08/wyze-api/pull/12
- Fix turnOn/turnOff methods for plugs and lights https://github.com/jfarmer08/wyze-api/pull/14

### v1.1.5
- Adds check if code is not in the message

### v1.1.4
- Adds a check, log message, and refresh atttempt if the code of the response does not equal 1

### v1.1.3
- Clean Login api
- Add debounce for login api

### v1.1.2
- Change user aganet based on package version

### v1.1.1
- Chnage user agent to unofficial-wyze-api/1.0

### v0.1.1.0
- First Release
