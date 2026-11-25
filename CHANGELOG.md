# wyze-api

## Releases

### Unreleased

**Fixed**
- **The camera test page's night vision change never finished inside Homebridge.** The page queued the change on the camera's queue and `setCameraNightVision` queued it again behind itself, so neither could finish and the page's one-test-at-a-time lock was never released (every later test got 409 until a restart). Present in 2.0.0-beta.4. The change is now queued once.
- **A card's id stays with its device.** Ids were positions in the device list, so a list that was reordered or changed under an open page could point a button at another camera. They are now fixed to the device for as long as the server runs.
- **The device report no longer drops keys that only contain a private pattern inside an ordinary word** (`capacity`, `microphone`, `velocity`).

**New**
- **The camera test page shows a snapshot of each camera.** Wyze's last saved picture opens with the page, **Live snapshot** takes a frame from the live stream, and a night vision change waits five seconds and then shows a new snapshot next to the one from before (`GET /api/cameras/<id>/snapshot`, `?live=1` for a fresh frame; JPEG only, one per camera at a time, the token required). `getCameraSnapshotImage(mac, { cloudOnly: true })` returns Wyze's saved thumbnail or throws, and never starts a live capture; the page uses it for the picture shown on opening.
- **"What may it support?"** on each camera's card (and in the Other devices results): a read-only scan listed as seen on this device, likely for the model, or not seen, with what shows each (`POST /api/cameras/<id>/support`, `src/web/support.js`). It joins what Test found over the network.
- **Prefilled report links everywhere.** A camera test, a support scan and a device report all open the plugin's form with the "What are you reporting?" answer preselected from the result and the support list in the device information; the footer's "Report an issue" is the bug form with the versions filled in (`buildBugUrl`). A link only ever names a real option of the form.
- **The camera test page saves a scan.** A device's report is kept for ten minutes (memory only) and its capability groups until the firmware changes, also on disk in the client's persist path (`device-scan-cache.json`, owner-only, group names only, no MAC), so pressing Test again, or restarting, does not read Wyze again; the card says when the saved scan was made and has a **Scan again** button. The device list is kept for a minute for both tabs. `scanCacheDir` on `createCameraTestServer` moves the file, `null` keeps it in memory. The issue link built from a saved scan is the same as from a fresh one, and a link no longer breaks on a report whose discovery is in an older shape.
- **Rate-limit history.** `getRateLimitHistory()` in `src/util/rateLimit.js` keeps the last 100 answers with rate-limit headers per host and path, with a count of all answers, to show whether Wyze limits per account, host or endpoint. Memory only; no device ids.
- **Capability discovery is gentler.** A 300 ms wait between the asks for one device, and one log line per device with its number of reads.
- **`getCameraAlarmSettings(mac)`** returns `{ smoke, co }` (`"on"`, `"off"` or `"unknown"`): the camera's smoke and CO alarm sound settings, the two toggles on the Wyze app's Alarm Settings page. Read only, over the local network like night vision (`K10020` params 17 and 18). There is no setter yet.
- **Capability discovery in the device report, when asked for.** `node scripts/device-report.js --discovery`, or the box "Also find which capability groups it has" on a device's card in the camera test page's Other devices tab, adds a `capabilityDiscovery` section: which devicemgmt groups (`device-info`, `iot-device`, `wifi`, `battery`, `floodlight`, ...) come back with a value, by name only. A device that rejects groups, such as the Doorbell v2's chime, is asked again without the group it names. It is off by default (one to eleven more reads per device), and the prefilled issue link carries the result. `_deviceMgmtGetIotProp` takes an optional list of capability groups as a fourth argument, and logs a rejection at debug level when it is used.

**Changed (read before upgrading; the dependency, constant and export changes are measured against upstream's `2.0.0-beta.2`)**
- **The scripts, samples and wiki log in with `WYZE_USERNAME`, `WYZE_PASSWORD`, `WYZE_KEY_ID` and `WYZE_API_KEY`.** A bare `USERNAME` is the operating system's login on Windows, and the `.env` loader never overrides a variable that is already set, so a script logged in as the wrong account. A `.env` file with the old names still works (read from the file only, with a message saying what to rename).
- **`totpSecret` is deprecated and ignored.** Wyze accounts log in with the API key (`keyId` and `apiKey`). If Wyze asks for a code, pass the current 6-digit `mfaCode`. A `totpSecret` still in a config is accepted and logs a warning once.
- **Node.js 22 or newer.** The `koffi` and `querystring` dependencies are gone, with `aws-sdk`, `crypto-js`, `urllib`, `base64-js` and `colorsys`.
- **The `WyzeCamOGTelephoto3x` constant is `"GW_GC2"`** (it was `"GW_GC"`), and the `olive_create_signature` and `ford_create_signature` exports are removed.
- **Thermostat setpoints are whole degrees Fahrenheit**, not tenths: a caller that passes `680` now gets an error. A setpoint is sent as text, as the Wyze app does, and as a number only if Wyze answers the text with an HTTP error; a write that times out is not sent twice.
- **`new WyzeAPI()` no longer throws without a `username`.** 1.x did not either. The first login says clearly that it is needed.
- **`cameraPrivacy` on a camera that uses the devicemgmt API takes `power_on` or `power_off`** and throws on anything else. Any other value used to switch the camera off.

**Fixed after review**
- **A request held for a 429 is built again after the wait** (new timestamp or nonce, signed again, current token), for every kind of signed request: the standard body, camera stream info, Venus, DeviceMgmt, Olive and Earth, Ford, IoT3 and HMS. A test fails on any new request that is signed and has no way to be built again.
- **Audio gaps are filled for Wyze cameras.** They answer PCMU on payload type 96, which the buffer did not recognise, so the crackle fix never ran. The negotiated codec decides now. The buffer also restarts on a new SSRC or on restarted numbering instead of dropping every packet as late.
- **A device's address from Wyze is only used when it is on the local network:** the local camera session, and the local bulb command (which falls back to the cloud).
- **The cloud thumbnail is only fetched from an https address that is not on the local network,** with at most three redirects, each checked the same way.
- **Cam Plus plan expiry can be in seconds or milliseconds;** read as milliseconds only, every plan whose date was in seconds looked expired.
- **Camera connection details fetched ahead of use are dropped when unused,** as the comment said they were.
- **The device report drops generic names, rooms, locations, labels, titles and passwords under their short names.**

### v2.0.0-beta.4

Everything since the last published beta, **2.0.0-beta.3**. An earlier `2.0.0-beta.4` was tagged on GitHub (2026-11-02) but its publish was never approved on npm, so it never reached npm. That GitHub release and tag were deleted and the number is used for this release; the changes the first attempt carried are listed below the new ones. Pairs with `homebridge-wyze-smart-home` 2.0.0-beta.4.

**New**
- **Night vision over the local network.** `getCameraNightVision(mac)` returns `"on"`, `"off"` or `"auto"`, and `setCameraNightVision(mac, value)` sets it and reads it back (`{ before, after, matches }`). The Wyze cloud does not expose this setting for these cameras, so the library talks to the camera directly, with a pure-JavaScript client in `src/tutk/client.js` (no native library). It needs to run on the same network as the camera, and works for cameras the device list marks with the `dtls` flag and gives an IP and keys (the Cam v2, Cam v3 and Doorbell v2 are tested). One conversation per camera at a time.
- **A browser page for testing cameras.** `createCameraTestServer()` (and `validateWebPort()`) start a small web page, and `npm run camera-test` runs it by itself. It lists the account's cameras, tests each one over the home network (read only), and sets night vision after a confirm. It serves only the local network, needs a random token, refuses requests through a proxy, and keeps one test running at a time. A host program can give it a read-only view of its settings and sensors, and a list of the devices it does not support. The sidebar carries the Wyze Smart Home logo, links to the project home and the issue chooser, and the plugin, `wyze-api` and Node versions the page runs with.
- **A report for devices that are not supported.** The page's Other devices tab and the new `src/deviceReport.js` collect what Wyze knows about a device (the property list, device info, and for a camera the devicemgmt answer and, on request, a read-only local session), name the endpoint each answer came from, and remove addresses, names, ids and keys. The page turns the result into a link that opens the issue form with it filled in.
- **`scripts/device-report.js`** does the same from the command line for anyone with a checkout, with `--local` for a read-only ask of each camera on the home network.
- **Deprecated: `totpSecret`.** The option that generated a 2FA code from the authenticator secret is no longer used: the API key is what logs in, and a login with no code worked on a 2FA account. A value is still accepted (it is not cleaned, checked or sent), and the client logs a warning once. `mfaCode` is unchanged: a one-time code, for when Wyze asks for one. The code for the generator (`generateTotp` and its helpers in `src/util/totp.js`) is removed; they were not exported from the package's entry point and are not in 1.x. An error for a missing code now says to provide `mfaCode`.
- **Thermostat setpoints are sent as text first, like the Wyze app does (`"70"`), and as a number if that fails.** An experiment for [homebridge-wyze-smart-home#317](https://github.com/wyze-smart-home/homebridge-wyze-smart-home/issues/317), where a `CO_EA1` on firmware 1.2.8 wakes up but keeps its old setpoint after a number was written. A fallback is logged (`heat_sp as text failed ...`) and counted in `thermostatSetpointFallbacks`. It only runs when Wyze rejects the text; a unit that silently ignores a value looks the same as one that applied it. Not tried on a real thermostat: nobody here owns one.
- **Floodlight v2 (`HL_CFL2`): the light is switched through the devicemgmt API first** (an experiment for [plugin issue #16](https://github.com/identd113/homebridge-wyze-smart-home/issues/16), where the old `set_property` `P1056` write was accepted and did nothing). If the devicemgmt call fails, the old write is used and a warning is logged. Only the light write changed; state still comes from `get_property_list`. Not tried on a real Floodlight v2: nobody here owns one, and the reporter has not tested it yet.
- **The files ffmpeg reads (SDP) are written inside the client's `persistPath` (`<persistPath>/tmp`), not the OS temp folder,** so a host such as Homebridge keeps everything the library writes inside its own storage folder. Leftovers older than an hour from a killed run are removed when the client starts. If that folder cannot be made, the OS temp folder is used as before.
- **The lock access-code encryption secret is no longer written to debug logs.** The `crypt_secret` answer was logged unredacted, and that secret encrypts door PINs; `secret` and `crypt_secret` are now redacted like the other credentials.
- **A refresh refused with an access-token error no longer hangs the client.** The refresh call itself answered with error 2001 was handled as an expired access token, which started another refresh: it waited on the one already running and never settled, so every request waiting on the refresh hung until a restart. The refresh now fails, and the fresh-login fallback runs.
- **A refused token refresh is not retried, and a low-remaining sleep holds the host.** A refresh answered with 2001 went on to wait 2 seconds and send the same dead token again; it now falls back to a fresh login at once. The sleep for a low `X-RateLimit-Remaining` also holds other requests to that host, as a 429 wait does, instead of letting them run into the limit.
- **Rate-limit headers are read more carefully.** A small `X-RateLimit-Reset` (under about 1e9) is seconds from now, not a Unix time in 1970, which made the new 429 retry wait 0. The older low-remaining check also no longer sleeps on a missing or malformed reset time (it logged `NaN`) and caps a long one at 2 minutes.
- **The device report reads Wyze's real property-list answer** (an envelope with `data.property_list` and rows that carry `value`), so the report lists each property and the issue form's property count is right.
- **A rate limit (HTTP 429) is waited out.** Every request to a Wyze host that gets a 429, or a 503 with a `Retry-After`, is held for the time Wyze gives (`Retry-After` in seconds or as a date, else `X-RateLimit-Reset`: seconds from now when under 1e9, otherwise a Unix time) and sent again, up to twice; with no time given it waits 5 seconds, then 10. A wait over 2 minutes is not served: the error is thrown at once with `retryAfterMs` on it. While one request waits, other requests to the same host wait too, because it is not known whether Wyze limits per account, per endpoint or per host. `getRateLimitObservations()` (in `src/util/rateLimit.js`) lists the rate-limit headers last seen per host and path, to find out. The login-time and body-code limits (`3044`) are unchanged.
- **Pictures are captured from one whole keyframe** piped to ffmpeg, not from UDP packets, so a picture no longer depends on a free local port.

**Fixed (found in a full code audit before this release)**
- **Stopping a stream whose ffmpeg could not start no longer kills the host process on Node 22.** `kill()` on a child that failed to spawn (no pid yet, handle still open) signalled the process's own group there, so a missing ffmpeg ended Homebridge's child bridge, and the CI test run, instead of just the stream. Children are now only killed once they have a pid (`killChild`).
- **A failed login or token refresh now says why.** The error text was built from a whole HTTP response, which cannot be turned into text, so a wrong password or a rate limit showed up as a "circular structure" TypeError and the real message was lost.
- **A disk that cannot be written no longer fails a login.** The new tokens work from memory; the refresh used to be retried with the already-used token, then a fresh login, which a one-time 2FA code cannot do twice. The log says the login could not be saved.
- **The stream address, token and TURN credentials stay out of errors and logs.** An unexpected get-streams answer put them in the error text and in the debug log; `auth_token`, `signaling_url` and `credential` are also redacted in any log line.
- **A missing or broken ffmpeg now fails a picture at once with the reason,** instead of every picture waiting 20 seconds for "capture timed out".
- **A picture uses the stream's own SPS/PPS first,** then the answer's, which can be stale after a resolution change. A warm session gives no picture from a keyframe more than a minute old.
- **Audio gaps are only filled with silence for G.711 (PCMU and PCMA).** Opus and other codecs were given invalid made-up packets.
- **A bulb command to the local network times out after 10 seconds** instead of waiting forever.
- **The device report hides a server address (`server`, `dns_server`) and any IPv6 address,** and keeps firmware versions.

**Carried over from the first 2.0.0-beta.4 attempt (tagged 2026-11-02, never on npm)**

- **Development: `npm run lint`** (ESLint on `src`, `scripts` and `tests`) and a lint job in CI. Nothing about the published package changes.
- **Fix: concurrent logins.** Several callers finding the access token missing at once (parallel requests at start-up) each started their own login. They now share one. A second login could also run unawaited, so a failure became an unhandled rejection that crashes a default Node process, and a one-shot 2FA code failed on the repeat.
- **Fix: a missing or broken ffmpeg no longer crashes the host process.** Starting a HomeKit stream with an ffmpeg that cannot start (binary missing or not executable) threw an unhandled `error` event. The stream now ends and logs why; audio failure carries on without audio.
- **`cameraWarmUp` leaves a camera alone while a live stream of it is open.** It used to take the camera's single connection slot and close the stream. It now does nothing and resolves `false`.
- **Requests to Wyze time out after 30 seconds** when the caller set no timeout, so a stalled connection no longer hangs login and every poll that waits on it. The camera thumbnail download has its own 15 second timeout and a 20 MB size cap.
- **`cameraGetEvents` and `cameraGetEventsMulti` throw on an unknown `types` or `tags` name.** They used to drop it quietly, and an empty filter means "everything", so a typo returned every event. (These options are new in 2.x.)
- **Login tokens are saved to `~/.wyze-api` when you give no `persistPath`** (or to `$WYZE_API_PERSIST_PATH`). A client built without one used to fail at login. The folder is created owner-only. An explicit `persistPath` works as before. The probe scripts now use this default instead of their own folder, so they no longer leave a token file inside the package; the package also excludes `scripts/wyze-*.json`.
- **`getCamPlusPlans()` lists the account's Cam Plus plans** with their status, end date, seats and the cameras each one covers. `getPlanBindingListByUser(groupId = "hms")` takes the plan group, so `"cam-plus"` returns the camera plans; the default is unchanged.
- **2.x is checked against 1.1.15 on every test run.** `tests/compat-1x.test.js` fails if a public method, its parameter order, an export or a pure helper's result changes from 1.x. The differences that are on purpose are listed in `docs/downstream.md`, which also lists the projects still on 1.x.
- **The TUTK and GUTES code is no longer in the package.** `src/tutk/` and `src/gutes/` moved to `future/`, which is tracked in the repository but not published. Nothing in the library used them. Anything that imported `wyze-api/src/tutk/...` must now take it from the repository. `npm run test:future` runs their tests.
- **`koffi` and `querystring` are no longer dependencies.** Nothing in the package used `querystring`, and `koffi` was needed only by the TUTK code, which now declares it in `future/tutk/package.json`.
- **`startCameraHKStream` no longer lists a `bitrate` option.** The video is stream-copied, never re-encoded, so a requested bitrate was always ignored. Passing one is still harmless.
- **`getPropertyListForDevices(devices, pids)` reads the properties of many devices in one request** (`app/v2/device_list/get_property_list`). It returns a `Map` from MAC to `{ pid, value, ts }` rows, and throws if `devices` or `pids` is empty, on a Wyze error, or if Wyze returns a different number of rows than devices asked about, so a caller can fall back to `getDevicePID` per device. Wyze rejects the whole request if it names a device the account may not read. Checked against a live account: 4 cameras, one request, every value equal to the per-device read.
- **`cameraGetEvents` and `cameraGetEventsMulti` take `types`**, a list of `EventAlarmType` names such as `["SOUND"]`, to ask Wyze for only those events. Without it every type still comes back. **`tags`** (`AiEventTag` names such as `["PACKAGE"]`) asks only for events that carry one of those AI labels; Wyze filters them, so a rare label is found even when the 20 newest events do not carry it. One request returns at most 20 events in total, so asking for one type or tag keeps a busy camera's motion events from crowding the others out.
- **Each event has `ageMs`**, its age by Wyze's own clock (the time Wyze put on the reply minus the event's time), so an age is right even when the host clock is off.
- **The Cam OG Telephoto 3x is `GW_GC2`, not `GW_GC`.** Wyze reports `GW_GC2` (docker-wyze-bridge, ha-wyzeapi and Wyze's own community table agree), so a real Telephoto camera was never matched. It is now a camera on the devicemgmt API like the OG, using the OG's property list until it has been checked on hardware.

### v2.0.0-beta.3

Consolidates the fork's post-beta.2 fixes onto the 2.0.0 line.

- **Thermostat setpoints are whole degrees °F.** `setThermostatHeatingSetpoint` and `setThermostatCoolingSetpoint` documented and required tenths (`680` for 68 °F), but the Homebridge plugin has always read and written `heat_sp` / `cool_sp` as whole degrees, so a caller following the docs would send ten times the setpoint. The setters now take whole degrees and reject anything outside 40-100 °F with a message that says so, which also stops a value written in tenths. The wiki is corrected. Units of `temperature` and of Room Sensor (`CO_TH1`) readings are not re-checked; reports from thermostat owners are welcome.
- **Login and token errors no longer carry raw Wyze responses.** The "Invalid credentials", "Failed to refresh access token", unsupported-MFA and bad-request errors put the response (and, for a bad request, the request body) into `err.message`, outside the logger's redaction. A caller that logged `err.message` could write tokens or an email address to its log. The text now goes through the same redaction as the log.
- **A picture capture is tried once more** when ffmpeg loses a race for its local UDP port ("Address already in use"), with fresh connection details.
- **Open connections (`cameraWarmUp`).** A WebRTC connection to a camera can be opened ahead of a stream and kept for a while; a live stream of that camera takes it over (nothing left to connect), and `cameraWarmSnapshot` makes a JPEG from its latest keyframe. Keyframe detection now sees fragmented IDR slices, and a keyframe handed to a stream gets the camera's SPS/PPS in front of it when it has none.
- **Faster first picture on a live stream.** The camera's first keyframe is held until ffmpeg is running instead of being lost (which used to cost a second keyframe request), each camera's SPS/PPS are remembered so ffmpeg can start before the camera's first packets arrive, and `prefetchCameraConnection` lets the caller fetch the connection details ahead of time. A debug `timing:` line per live stream shows where the time went. `getCameraSnapshotImage` also accepts `deviceModel` to skip a device-list request, and `cameraGetEventsMulti` reads the event list for several cameras in one request.
- **Smoother camera audio on lossy links.** Audio packets that arrive late or out of order are put back in sequence, and packets that never arrive are replaced with silence for that 20 ms slot, so ffmpeg no longer sees holes ("RTP: missed N packets") that were heard as crackle. In-order audio is unchanged and adds no delay. Each stream logs a one-line audio summary (packets, reordered, filled, late) when it ends. In a lab test with 3% loss and 60 ms jitter, the "missed packets" warnings dropped from 15 to 0.
- **Quieter default log.** The "API rate limit remaining" count (one line per request) and the video ffmpeg's own messages (for example "Non-monotonous DTS") are now logged at `debug`, not `info` and `warn`. The warning for a nearly exhausted rate limit is unchanged.
- **Breaking:** the constructor now throws when `username` is empty (previously it failed later at login). Callers that build a client without credentials must handle the error.
- **Requires Node.js 22 or newer** (`engines.node` is now `>=22`). `werift` is upgraded to `^0.25.1`, which needs Node 22 and clears the `ip` (SSRF) and `uuid` audit findings; `npm audit --omit=dev` is now clean. Homebridge 2.x already requires Node 22+.
- **Wyze Cam Pan v4 (`HL_PAN4`) support**, ported from SecKatie/wyzeapy: uses the devicemgmt API for power, siren, spotlight and state. Also registered in the camera model lists.
- **Bulb Cam (`HL_BC`) light now works**: wyzeapy switches it with `run_action` (`floodlight_on` / `floodlight_off`); writing `P1056` is accepted but does nothing (#293). Reading state is unchanged.
- **devicemgmt state reads** (`cameraGetDeviceMgmtState`, per-model property lists ported from wyzeapy) so Floodlight Pro, Battery Cam Pro, OG and Pan v4 report light, siren, motion and power state.
- The raw-value camera methods the plugin calls (`cameraSpotLight`, `cameraFloodLight`, `cameraSiren`, `cameraPrivacy`, `cameraNotifications`) now route devicemgmt cameras to the right API; other models behave as before. Previously they sent `P1056` / `run_action` to cameras that ignore them.
- Floodlight v2 (`HL_CFL2`) is registered as a camera model. Its light still uses `set_property P1056`, exactly as wyzeapy does; the toggle reported in [#264](https://github.com/wyze-smart-home/homebridge-wyze-smart-home/issues/264) has no known fix yet.
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

Full library documentation at https://github.com/wyze-smart-home/wyze-api/wiki — every module covered.

#### 🔍 Internal

- 178/178 tests pass.
- Production npm audit: 4 issues remain, all from the `werift` WebRTC chain (transitive `ip` SSRF + `uuid` bounds); no upstream fix available, deferred.
- Two GitHub Actions workflows: `npm-publish-stable.yml` and `npm-publish-beta.yml`.

### v1.1.15
- Fix `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` TLS errors on Node 24.18.0+. Node's NSS 3.123.1 root store update dropped the legacy DigiCert Global Root CA, breaking `api.wyzecam.com` and `yd-saas-toc.wyzecam.com` (the host behind `getLockInfo`/`controlLock`). All axios requests now go through a shared `https.Agent` (`src/httpsAgent.js`) that pins the DigiCert roots Wyze depends on alongside Node's default trust store. See [docs/FIX-node24-tls-cert.md](docs/FIX-node24-tls-cert.md) for the root-cause writeup. Fixes [homebridge-wyze-smart-home#307](https://github.com/wyze-smart-home/homebridge-wyze-smart-home/issues/307).

### v1.1.14
- Fix Ford API signing for original Wyze Lock (YD.LO1). Two bugs caused `PARAM_SIGN_INVALID` (`controlLock`) and `PARAM_TIMESTAMP_INVALID` (`getLockInfo`): `fordCreatePayload` signed over the original payload only instead of the full augmented payload (including `accessToken`/`key`/`timestamp`), and GET requests need `access_token` (snake_case) while POST requests need `accessToken` (camelCase). Fixes [homebridge-wyze-smart-home#300](https://github.com/wyze-smart-home/homebridge-wyze-smart-home/issues/300).

### v1.1.13
- Fix `getLockInfo` sending unsigned params to the Ford API. `config.params` was assigned before `fordCreatePayload` was called, so the `GetLockInfo` GET request went out without `key`/`timestamp`/`sign`/`accessToken`, causing error 17001 `PARAM_TIMESTAMP_INVALID` on the original Wyze Lock (YD.LO1). Fixes [homebridge-wyze-smart-home#300](https://github.com/wyze-smart-home/homebridge-wyze-smart-home/issues/300).

### v1.1.12
- Fix runtime crashes: replace `moment().valueOf()` with `Date.now()`; fix missing `this.` context on the `runActionList()` fallback call; replace global `print(token)` with `this.log.info(token)`.
- Lazy-load `cameraStreamCapture` so requiring `werift`/`ffmpeg-static` at module parse time no longer crashes consumers (e.g. homebridge plugins running in Docker) that don't have those optional deps installed.
- Remove the unused `moment` dependency.

### v1.1.11
- Add Wyze Robot Vacuum support (model `JA_RO2`) via the Venus service. Resolves [#4](https://github.com/wyze-smart-home/wyze-api/issues/4). Patterned after [shauntarves/wyze-sdk](https://github.com/shauntarves/wyze-sdk/blob/master/wyze_sdk/api/devices/vacuums.py).
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
- Add camera WebRTC stream support. Port of [wyzeapy#230](https://github.com/SecKatie/wyzeapy/pull/230) plus production-ready helpers ported from the `camera-stream` reference branch (kept as the [`archive/cameraStream`](https://github.com/wyze-smart-home/wyze-api/tree/archive/cameraStream) tag).
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
- Refactor Wyze Auth & Core Api Fetching https://github.com/wyze-smart-home/wyze-api/pull/12
- Fix turnOn/turnOff methods for plugs and lights https://github.com/wyze-smart-home/wyze-api/pull/14

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
