# Cameras — Controls

Power, siren, lights, motion detection, notifications, and recording for Wyze Cam devices. For live video, see **[Camera Streaming](Camera-Streaming.md)** and **[Snapshot Capture](Snapshot-Capture.md)**.

## Power / privacy

```js
const cam = await wyze.getDeviceByName("Front Porch");

await wyze.cameraTurnOn(cam.mac, cam.product_model);
await wyze.cameraTurnOff(cam.mac, cam.product_model);
await wyze.cameraPrivacy(cam.mac, cam.product_model, "power_on");  // generic action key
```

| Method | Wraps |
|---|---|
| `cameraTurnOn(mac, model)` | `runAction(mac, model, "power_on")` |
| `cameraTurnOff(mac, model)` | `runAction(mac, model, "power_off")` |
| `cameraPrivacy(mac, model, value)` | `runAction(mac, model, value)` — pass any action key the camera supports |

## Siren

| Method | Notes |
|---|---|
| `cameraSirenOn(mac, model)` | Trigger siren |
| `cameraSirenOff(mac, model)` | Stop siren |
| `cameraSiren(mac, model, value)` | Generic — pass `"siren_on"` or `"siren_off"` |

## Floodlight

For cameras with integrated floodlights (Cam Floodlight, etc.).

| Method | Notes |
|---|---|
| `cameraFloodLightOn(mac, model)` | Sets property `P1056` to `"1"` |
| `cameraFloodLightOff(mac, model)` | Sets property `P1056` to `"2"` |
| `cameraFloodLight(mac, model, value)` | Set `P1056` to a custom value |

## Spotlight

For cameras with a spotlight (Cam v3, etc.).

| Method | Notes |
|---|---|
| `cameraSpotLightOn(mac, model)` | Sets property `P1056` to `"1"` |
| `cameraSpotLightOff(mac, model)` | Sets property `P1056` to `"2"` |
| `cameraSpotLight(mac, model, value)` | Set `P1056` to a custom value |

> Note: floodlight and spotlight share property `P1056`. The actual hardware behavior depends on the camera model.

### Models that don't use `P1056`

The same methods route automatically by model:

- **devicemgmt cameras** (Floodlight Pro `LD_CFP`, Battery Cam Pro `AN_RSCW`, OG `GW_GC1`, Pan v4 `HL_PAN4`): the light, siren and notifications are set through the devicemgmt API (`run_action`). `AN_RSCW` and `HL_PAN4` use the "spotlight" capability, the others "floodlight".
- **Bulb Cam** (`HL_BC`): the light is switched with `run_action` `floodlight_on` / `floodlight_off`; writing `P1056` is accepted but does nothing.
- **Floodlight v2** (`HL_CFL2`) still uses `P1056`; the toggle is reported not to work and has no known fix.

`cameraUsesDeviceMgmt(model)` tells you which path a model takes. Ported from SecKatie/wyzeapy; not yet verified on real hardware.

## Wyze Cam Doorbell v2 (`HL_DB2`)

Registered as a camera in 2.0.0-beta.3. Probed against real hardware (firmware `4.51.3.6791`):

- **Video:** the WebRTC (Kinesis) stream is **640x480 at 15 fps**, H.264 Main profile (level 5.0), whether or not `substream` is requested. Wyze cameras such as the v3 send 1920x1080. Snapshot capture works (`getCameraSnapshotImage(mac, { skipCloud: true })`). The sensor is marketed as 2K; a higher-resolution feed is not reachable through WebRTC, and the Tutk module here is Linux-only and doesn't list this model.
- **Stream info:** `cameraGetStreamInfo` returns a signaling URL for it, but no `iot-device::iot-power` property, so only an explicit `0` is treated as "camera is off".
- **State (device list):** `power_switch`, `motion_alarm_switch`, `records_event_switch`, `power_saving_mode_switch`, `audio_alarm_switch`, `accessory_switch`.
- **Property IDs seen:** `P1` notification, `P1001` motion detection, `P1047` motion recording, `P1048` sound recording, `P1049`/`P1050` siren state and timestamp, `P1013` Wi-Fi signal, plus others with no known name.
- **devicemgmt reads answer** for `iot-device` (online, power, push), `siren`, `motion-detection`, `wifi` (signal) and `memory-card-management` (storage status). `camera.resolution`, `frame-rate`, `bit-rate`, `microphone`, `night-shot` and `infrared-mode` are named but report no value, so they can't be read or restored. Battery and solar report nothing: it is wired.
- **No LAN services:** none of 20 common TCP ports (including 554) is open. Control and video go through the Wyze cloud.
- **Not verified:** power on/off, siren and notification writes, and a doorbell-press (ring) event.

## Cloud events (`cameraGetEvents`)

`cameraGetEvents(mac, { sinceMs, count })` reads Wyze's cloud event list (motion, sound, doorbell rang), newest first, with `type`, `tags` and `time`. It is read-only.

- **A free-plan camera only records one motion event every ~5 minutes.** Measured on two Cam v3 (no subscription): the shortest gap between motion events was 5.0 and 5.2 minutes, and none carried AI tags. A camera with a plan (a Doorbell v2 here) showed events 20 seconds apart, every one tagged person/vehicle/package. So motion read from this list is coarse on a free plan, and a doorbell press on a doorbell without a plan could be swallowed by the same cooldown (not verified).
- **Events change after they appear.** A doorbell press is first recorded as motion (13), then flipped to "Doorbell rang" (10) within seconds; AI tags arrive a few seconds late. Compare by `id` on every poll.
- **Lag:** a new event was visible within about 10-12 seconds of the motion.
- Live view and snapshots do not use this list and are not affected by the plan.

## Motion detection

| Method | Notes |
|---|---|
| `cameraMotionOn(mac, model)` | Enables motion detection (`P1001` = `1`) |
| `cameraMotionOff(mac, model)` | Disables motion detection (`P1001` = `0`) |

## Sound notifications

| Method | Notes |
|---|---|
| `cameraSoundNotificationOn(mac, model)` | `P1048` = `"1"` |
| `cameraSoundNotificationOff(mac, model)` | `P1048` = `"0"` |

## Push notifications

| Method | Notes |
|---|---|
| `cameraNotificationsOn(mac, model)` | Enable push (`P1` = `"1"`) |
| `cameraNotificationsOff(mac, model)` | Disable push (`P1` = `"0"`) |
| `cameraNotifications(mac, model, value)` | Set `P1` to a custom value |

## Motion recording

Cloud recording on motion events.

| Method | Notes |
|---|---|
| `cameraMotionRecordingOn(mac, model)` | `P1047` = `"1"` |
| `cameraMotionRecordingOff(mac, model)` | `P1047` = `"0"` |
| `cameraMotionRecording(mac, model, value)` | Set `P1047` to a custom value |

## Garage door

For cameras configured with a Wyze garage-door controller.

```js
await wyze.garageDoor(cam.mac, cam.product_model);
```

Triggers `garage_door_trigger` — the camera's controller decides open vs. close based on the current door state.

## Reading status

Camera state is in `device.device_params`:

```js
const cam = await wyze.getDeviceByName("Front Porch");
const status = await wyze.getDeviceStatus(cam);
// status.power_switch, status.signal_strength, status.ip, etc.
```

For a single property:

```js
const motionEnabled = await wyze.getDeviceStatePID(cam.mac, cam.product_model, "P1001");
```

For the full list:

```js
const props = await wyze.getDevicePID(cam.mac, cam.product_model);
console.log(props.data.property_list);
```

### devicemgmt cameras

For `LD_CFP`, `AN_RSCW`, `GW_GC1` and `HL_PAN4`, property IDs don't apply. Use:

```js
const state = await wyze.cameraGetDeviceMgmtState(cam.mac, cam.product_model);
// { motion, floodlight, siren, notify, on, available } (booleans; missing fields are undefined)
```

## See also

- **[Camera Streaming](Camera-Streaming.md)** — fetch WebRTC credentials for live video
- **[Snapshot Capture](Snapshot-Capture.md)** — JPEG images (cloud or live)
- **[Browser Viewer Example](Browser-Viewer-Example.md)** — runnable end-to-end demo
