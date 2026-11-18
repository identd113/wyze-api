# Camera properties: what each Wyze setting means

Wyze describes a camera's settings as numbered properties (`P1056`, `P1048`, ...) and a list
of device parameters (`dongle_switch`, `audio_alarm_switch`, ...). Wyze does not publish what
they mean. This page records what we know, how we know it, and what we have only guessed.

**Status key**

- **Confirmed**: we changed it (or watched it change) and saw what happened.
- **Library**: the name comes from this library or from another project (listed under "What other projects say"); we have not tested it on our cameras.
- **Unknown**: only the values we have seen.

Observed values below were read on 2026-10-25 from a Cam Doorbell v2 (`HL_DB2`) and
two Cam v3 (`WYZE_CAKP2JFUS`), one with a floodlight accessory and one without.
A dash means the camera does not report that property.

## How to find out what a setting does

1. Read the camera's properties once to get a baseline.
2. Change **one** setting in the Wyze app.
3. Read them again and diff. The value that moved is the setting.

Floodlight cameras change `P1056` and `dongle_switch` by themselves whenever the motion light
fires, so ignore those two while testing something else. `P1050` looks like a timestamp and
changes on its own.

## Properties (`get_property_list`)

| Property | Meaning | Status | Evidence / notes | Doorbell v2 | Cam v3 + floodlight | Cam v3 |
|---|---|---|---|---|---|---|
| `P1` | Notifications | Library | wyzeapy, wyze-sdk | 1 | 1 | 1 |
| `P3` | Camera on (0 = privacy / off) | Library | The Doorbell cannot be switched off through the API. | 1 | 1 | 1 |
| `P5` | Online | Library | | 1 | 1 | 1 |
| `P1001` | Motion detection on (the toggle; `P1047` holds the state) | Library | wyzeapy | 1 | 1 | 1 |
| `P1047` | Motion event recording ("event recording motion record enabled") | Library | wyze-sdk, wyzeapy | 1 | 1 | 1 |
| `P1048` | Sound event recording ("event recording sound record enabled") | Library | wyze-sdk. Set 0 to 1 on the Cam v3 with the floodlight: the write was accepted and read back as 1. It did **not** make the camera send audio over a live stream (two 20-second streams). | 1 | 0 to 1 | 1 |
| `P1049` | Siren (1 = on, 2 = off) | Library | | 2 | 2 | 2 |
| `P1056` | Floodlight / spotlight / accessory state (1 = on, 2 = off) | **Confirmed** | wyzeapy calls it the state of camera accessories (garage doors, light sockets, floodlights). On the Cam v3 with the floodlight it flipped to 1 whenever the motion light came on and back to 2 when it went out (six changes, 18:49 to 19:11), together with `dongle_switch`. The cloud list updates within seconds. | - | 2 | 2 |
| `P1301` | Contact state (used for a garage door accessory) | Library | wyzeapy: contact state. Its sibling `P1302` is a motion state. | - | 0 | 0 |
| `P1002` | Unknown. Changed 0 to 1 on the Cam v3 with the floodlight at the same time as `audio_alarm_switch` after a setting was changed in the Wyze app (which one was not recorded). | Unknown | The Cam v3 without the floodlight has both at 1. Making them match did not bring audio. | 0 | 1 | 1 |
| `P1013` | Wi-Fi signal strength | **Confirmed** | Doorbell only. On 2026-11-14 it read 64, the same as the devicemgmt `wifi/signal-strength` (a unique match). On 2026-10-25 it was 56. The Cam v3 reports none. | 56 | - | - |
| `P1050` | Time the siren last went on (Unix seconds) | **Confirmed** | Equals the devicemgmt `siren/siren-on-ts` (both 1794584254 on the Doorbell, 2026-11-14). It changes when the siren runs, not on a clock. | 1792911873 | 1792735385 | 1792472060 |
| `P4` | Event switch | Library | wyze-sdk (`event_switch`) | 1 | 1 | 1 |
| `P1021` | Dongle (accessory) light switch | Library | wyze-sdk (`dongle_light_switch`). Not yet tested: the Cam v3 with the floodlight has a dongle and reads 1. | - | 1 | 1 |
| `P1003` `P1004` `P1005` | Unknown | Unknown | wyze-sdk lists them as "not used" (they exist in Wyze's app but nothing uses them). | 0 / 0 / 1 | 1 / 1 / 1 | 1 / 1 / 1 |
| `P1006` to `P1008`, `P1010`, `P1014`, `P1015`, `P1017` to `P1022`, `P1033`, `P1035` | Unknown | Unknown | Same values on both Cam v3s (`P1015` is 1 on the Doorbell, 0 on the Cam v3s). | | | |
| `P1306` to `P1312`, `P3000`, `P1901` | Unknown | Unknown | `P1310` is 300 on both Cam v3s. | - | | |
| `P18` `P19` `P20` `P30` `P2` | Unknown | Unknown | | | | |
| `P1078` | Motion-alert schedule (devicemgmt `motion-warning-schedule`) | **Confirmed** | The same JSON as devicemgmt `motion-detection/motion-warning-schedule` (2026-11-14). It is a schedule for motion alerts, not a night setting. Doorbell only. The value is a JSON schedule: `{"always":1,"startTime":"21:00:00","startTimeType":"CUSTOM","endTime":"06:00:00",…}`. | (object) | - | - |
| `P1054`, `P1055`, `P1058` to `P1061`, `P1064`, `P1075` to `P1077`, `P1079`, `P1622`, `P1623` | Unknown | Unknown | Doorbell only. `P1622` and `P1623` are 0.0 there. | | - | - |
| `P1073`, `P1074` | Unknown | Unknown | Cam v3s only. `P1073` is `T` on both; `P1074` is empty on both. The WYZEC1-JZ reports neither. | - | `T` | `T` |

## Device parameters (from the device list)

| Parameter | Meaning | Status | Evidence / notes | Doorbell v2 | Cam v3 + floodlight | Cam v3 |
|---|---|---|---|---|---|---|
| `power_switch` | Camera on | Library | | 1 | 1 | 1 |
| `motion_alarm_switch` | Motion alarm on | Library | | 1 | 1 | 1 |
| `records_event_switch` | Event recording on | Library | | 1 | 1 | 1 |
| `dongle_product_model` | The accessory plugged into the camera | **Confirmed** | `HL_CFL` is the floodlight on the Cam v3 with the floodlight. Blank on the Cam v3 without it. | "" | HL_CFL | "" |
| `dongle_switch` | Accessory light on (1 = on, 2 = off) | **Confirmed** | Moves with `P1056`. | 0 | 2 | 2 |
| `audio_alarm_switch` | Probably sound detection (the camera's `K10020` param 15) | Probable | Changed 0 to 1 together with `P1002` on the Cam v3 with the floodlight; no effect on live audio. On 2026-11-18 it matched `K10020` param 15 on the two Cam v3s (floodlight camera: 0 and 2, the other: 1 and 1), but not the Doorbell's older param 15 reading (2, read four days earlier, while the cloud value was 1 on 18 Nov). Not toggled on purpose yet: turn Sound detection off and on in the app and read both. | 0 | 1 | 1 |
| `smoke_alarm_switch`, `co_alarm_switch` | Unknown. **Not** the app's Smoke / CO Alarm sound toggles | Unknown | Both 1 on the Cam v3s, 0 on the Doorbell. On 2026-11-18, with the Wyze app's Alarm Settings toggles (Smoke Alarm sound, CO Alarm sound) turned off on the Cam v3 with the floodlight, both stayed 1, in the device list, the property list, device info and devicemgmt, over four reads. Those toggles are `K10020` params 17 and 18 (below). | 0 / 0 | 1 / 1 | 1 / 1 |
| `ai_notification_v2` | AI (person, vehicle, ...) notifications | Unknown | 0 on the Doorbell, 1 on the Cam v3s. | 0 | 1 | 1 |
| `spotlight_status`, `accessory_switch`, `power_saving_mode_switch`, `device_setting_channel`, `dtls`, `main_device_dtls`, `comfort_standard_level`, `power_source`, `is_link_toy_car`, `is_temperature_humidity`, `temp_humi_room_type`, `temperature`, `humidity`, `electricity`, `battery_charging_status` | Unknown | Unknown | | | | |

## What other projects say

- **[shauntarves/wyze-sdk](https://github.com/shauntarves/wyze-sdk)** (Python, cloud API) lists camera property names taken from the Wyze app's own code: `P4` event switch, `P1021` dongle light switch, `P1047` motion record, `P1048` sound record. It marks most of the rest (`P1001` to `P1020`, `P1301` to `P1329`, `P1501` to `P1506`) as "not used".
- **[SecKatie/wyzeapy](https://github.com/SecKatie/wyzeapy)** (Python, Home Assistant) uses `P1049` siren, `P1056` accessory state (garage door, light socket, floodlight), `P1301` contact state, `P1302` motion state, `P1001` / `P1047` motion detection, `P1029` for the outdoor cam.
- **[mrlt8/docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge)** controls the settings that are **not** in the cloud list, over the camera's own connection (TUTK / IOTC), not the Wyze cloud. That is where night vision lives. Its commands (`wyze_commands.py`): `K10040GetNightVisionStatus` / `K10042SetNightVisionStatus` with `on` = 1, `off` = 2, `auto` = 3; `K10044` / `K10046` infrared LED (param 50); `K10624` / `K10626` auto night-type switching. Night vision is camera param 2 in `K10020CheckCameraParams`.
- **[nblavoie/wyzecam-api](https://github.com/nblavoie/wyzecam-api)** (Java, 2022, an independent reverse engineering of the same camera protocol) sets night vision with `K10042` and the same 1 / 2 / 3. Its camera-settings reply names it `nightVision` (`"nightVision":"3"` under `settingParm`, next to `stateVision` (status light), `osd` and `tz`).
- **wyzeapy** requests `night-shot`, `night-shot-state` and `infrared-mode` in its devicemgmt list but does not read or write them. **wyze-sdk**, **noelportugal/wyze-node**, **Porkbutts/wyze-mcp-server** and **ClickCalickClick/Wyze-Control-for-Pebble** have no night vision; their `P` ids are the ones listed above.

## Settings the camera keeps itself (not in the cloud property list)

These are read and set with TUTK commands sent to the camera. Command numbers and values come
from docker-wyze-bridge. Tested on 2026-11-14 with the pure-JavaScript client in
`future/tutk/spike/tutk-spike.js`: night vision (`K10040` / `K10042`) on the Doorbell v2 and the
Cam v2, read on all four cameras, and the read-only commands listed under "What the cameras
answered". The rest are untested.

| Setting | Get / set command | Values |
|---|---|---|
| Night vision | `K10040` / `K10042` | 1 = on, 2 = off, 3 = auto |
| IR LED | `K10044` / `K10046` | brightness-style number |
| Status light | `K10030` / `K10032` | on / off |
| Night mode switching type | `K10624` / `K10626` | |
| Time stamp / logo overlay | `K10070` / `K10072`, `K10074` / `K10076` | |
| Motion tagging | `K10290` / `K10292` | |
| Floodlight / white light / spotlight | `K10788`, `K10820` / `K12060`, `K10646` | |
| Flip (horizontal / vertical) | `K10052` | |
| Pan / tilt, cruise, motion tracking (Pan cams) | `K11000` to `K11022` | |
| RTSP on/off | `K10604` / `K10600` | |

`wyze-api` carries two ports of this protocol in `future/tutk/`. The older one (`session.js`,
`loader.js`) needs Wyze's native IOTC library and only loads on Linux. The newer one,
`spike/tutk-spike.js`, is pure JavaScript (Node built-ins only), runs on macOS, and speaks the
DTLS form of the protocol that current firmware uses (ported from AlexxIT/go2rtc, MIT). Neither is
used by the plugin today.

### What the cameras answered (2026-11-14, read only)

Run `node future/tutk/spike/tutk-spike.js --model <model> --name <part of nickname> --query 10020,10448,...`.
Only get commands are accepted. Each response code is the request code plus 1.

All four cameras (Doorbell v2 `HL_DB2` fw 4.51.3.6791, Cam v2 `WYZEC1-JZ` fw 4.9.9.5575, two Cam v3
`WYZE_CAKP2JFUS` fw 4.36.17.21) report `dtls = 1` in the Wyze device list and authenticate
(`K10000` to `K10003`, challenge status 3). The Cam v2 answers in the IOTC (scrambled) form of the
session, the other three in the CC51 form.

| Command | Answer on the Doorbell v2 and the Cam v2 |
|---|---|
| `K10040` night vision | 1 byte: 1 on, 2 off, 3 auto. **Confirmed**: setting it with `K10042` changed the value read back on both, and the Cam v2 clicked (heard). |
| `K10044` IR LED | 1 byte, 1 on both |
| `K10030` status light | 1 byte: Doorbell 1, Cam v2 2 (matches `K10020` param 1) |
| `K10070` timestamp overlay | 1 byte, 1 on both |
| `K10074` logo overlay | 1 byte, 2 on both |
| `K10290` motion tagging | 1 byte: Doorbell 1, Cam v2 2 (matches `K10020` param 21) |
| `K10090` camera time | 4 bytes, a little-endian Unix time |
| `K10050` video params | 6 bytes, `1e 00 02 <fps> 01 01`; the fps byte (20 Doorbell, 15 Cam v2) matches `K10020` param 5 |
| `K10624` auto night switch type | Doorbell: 1 byte, 2. No answer from the Cam v2. |
| `K10020` camera params | JSON of numbered params (below) |
| `K10446` connection status, `K10448` battery usage | **No answer** from either wired camera. They are the outdoor / battery camera commands; not tried on a battery camera. |
| `K10632` alarm flashing, `K10640` spotlight, `K10720` accessories, `K10604` RTSP params | No answer from either camera |

The Cam v3s were first read on 2026-11-18 (`K10020` and the alarm settings; the other commands above are still to do there).

### `K10020` camera params

`K10020` returns the camera's own settings as `{"1": ..., "2": ..., ...}`. Names come from
docker-wyze-bridge (`PARAMS`) and nblavoie/wyzecam-api (`PARAM_*`). **Cross-checked** means the same
value came back from a dedicated get command on the same camera.

| Param | Setting | Doorbell v2 | Cam v2 | Status |
|---|---|---|---|---|
| 1 | Status (network) light | 1 | 2 | Cross-checked with `K10030` |
| 2 | Night vision (1 on, 2 off, 3 auto) | 3 | 2 | Cross-checked with `K10040` |
| 3 | Bitrate | 192 | 120 | Name from the other projects only |
| 4 | Resolution | 1 | 2 | Name from the other projects only |
| 5 | Frame rate | 20 | 15 | Cross-checked with `K10050` |
| 6, 7 | Horizontal / vertical flip | 1, 1 | 1, 1 | Name from the other projects only |
| 8 | Timestamp overlay (OSD) | 1 | 1 | Cross-checked with `K10070` |
| 13, 14 | Motion alarm, motion level | 1, 65 | 1, 5 | Name from the other projects only |
| 15, 16 | Sound alarm, sound level | 2, 5 | 0, 5 | Name from the other projects only. On the two Cam v3s (2026-11-18) 15 was 2 (floodlight camera) and 1 (the other), level 5 on both; see `audio_alarm_switch` above. |
| 17 | Smoke alarm sound (the Wyze app's Alarm Settings page; 1 on, 2 off) | 2 | 1 | **Confirmed by elimination.** On a Cam v3 (floodlight), turning both Alarm Settings toggles off moved 17 and 18 from 1 to 2 and back; turning only CO off moved 18 alone. Read with `getCameraAlarmSettings(mac)`. |
| 18 | CO alarm sound (1 on, 2 off) | 2 | 1 | **Confirmed** (same test: it moved alone). The Doorbell reads 2, 2, which fits a camera with these off. |
| 21 | Motion tagging | 1 | 2 | Cross-checked with `K10290` |
| 22 | Time zone offset (hours) | -6 | -6 | Matches this location (CST) |
| 50 | IR LED (1 on, 2 off) | not in the answer | not in the answer | **Cross-checked** on the two Cam v3s (2026-11-18): 2 and 1, the same as `K10044` on each. The Doorbell v2 and the Cam v2 do not return param 50. |

The rest (9 to 12, 19, 20, 23 to 49, and the values above that came back) are unmapped. Reading
`K10020`, changing one setting in the Wyze app, and reading again shows which param it is. That is how 17 and 18 were found
(2026-11-18): nothing in the cloud lists moved when the toggles changed, and `K10020` showed both.

The library reads them with `getCameraAlarmSettings(mac)`, which returns `{ smoke, co }` (`"on"`, `"off"` or `"unknown"`), over the
local session like night vision. There is no setter: the camera's write command for these is not known (see `TODO.md`).

## What the Cam v3 answered (2026-11-18, read only)

First read of the two Cam v3 (`WYZE_CAKP2JFUS`, firmware 4.36.17.21, CC51 session form), one with the floodlight attachment and one without, with `scripts/device-report.js --local`.

| Command | Cam v3 with the floodlight | Cam v3 without |
|---|---|---|
| `K10030` status light | 2 | 2 |
| `K10040` night vision | 3 (auto) | 3 (auto) |
| `K10044` IR LED | 2 | 1 |
| `K10200` motion alarm | `01 05` (on, level 5; the same as `K10020` params 13 and 14) | `01 05` |
| `K10620` night check | `02 01 02 02 02` | `02 01 01 02 02`: the third byte is the same as `K10044`; meaning of the rest unknown |
| `K10632` alarm flashing, `K10640` spotlight | `02 02` and 3 | `02 02` and 3 |
| `K10720` accessories | the floodlight's own settings (below) | `{"status":"3"}` only: no accessory |
| `K10446`, `K10448`, `K10604`, `K10788`, `K10820` | no answer | no answer |

**`K10720` is the floodlight accessory's record**, and it only has content on the camera with the attachment. Fields seen (all strings): `realSwitch` 2 (the light, 1 on and 2 off, the same as `P1056`), `brightness` 226, `mode` 3, `durations` 15, `PIR` 1, `PIRSensitivity` 255, `PIRSilentTime` 1, `PIRChoose` 224, `PIRFilter` 1, `PIRMotionFilter` 1, `envDark` 1, `montionDark` 2, `soundDark` 2, `alarmSwitch` 1, `alarmLightType` 1, `alarmVolumeType` 1, `accessoriesVolume` 4, `sirenAlarm` 2 (the siren, 2 off like `P1049`), `type` 3, `status` 1. Only `realSwitch` and `sirenAlarm` are cross-checked against another source. The rest are names only: the brightness scale (226 is above 100), what `mode` 3 and `durations` 15 mean, and how the app's floodlight settings map to them are not known. They are not in the cloud lists, which is why the plugin has an on/off floodlight and no brightness. A write command for them is not known.

**`K10020` differences between the two Cam v3** (floodlight camera, then the other): param 15 (sound alarm) 2 and 1; param 19 0 and 1380; param 23 104 and 224; param 24 40 and 254; param 25 0 and 1; param 50 (IR LED) 2 and 1. Params 15 and 50 are explained above. 19, 23, 24 and 25 are unmapped: find them by changing one app setting and reading again.

**devicemgmt on the Cam v3** (neither is on the library's devicemgmt routing, and both answer): `wifi::signal-strength` (the classic list gives the Cam v3 no Wi-Fi value), `memory-card-management::storage-status` ("available"), `siren::state`, the `motion-detection` settings (including the motion-warning schedule), `iot-device` state and power, firmware and hardware versions, and `camera::motion-detect-recording` and `motion-push`. `floodlight::on` was true on the floodlight camera and absent on the other, while `P1056` and `K10720` `realSwitch` both read 2 (off) and did not change when the light was switched in between, so `floodlight::on` is not the light's state. It may say the camera has a floodlight, or something else.

**The smoke and CO toggles** are `K10020` params 17 and 18, not the cloud properties `smoke_alarm_switch` and `co_alarm_switch` (see the table above).

## Things we looked for and did not find

- **Night vision (Auto / Off / On) in the cloud list.** Cycled Auto, Off, On, Auto on the Back
  Yard Cam while watching every property and parameter: nothing changed. This matches the above:
  the camera keeps it, and the cloud list does not carry it. Two other projects agree (see
  "What other projects say"): both set it over the camera's own connection.
- **Night vision on the Doorbell v2 (`HL_DB2`), in the classic list and in devicemgmt.** Read the
  Front Doorbell with night vision Off, then On, then Auto (2026-11-13/14): the 39 classic
  properties and the device params did not change. The devicemgmt `get_iot_prop` answered with
  every model's property list (`LD_CFP`, `AN_RSCW`, `GW_GC1`, `GW_GC2`, `HL_PAN4`), and
  `night-shot`, `night-shot-state` and `infrared-mode` were `null` every time. Another 25 guessed
  names (`night-vision`, `night-mode`, `ir-cut`, `ir-led`, `infrared-light`, `day-night-mode`, and
  so on) under six capability names were also all `null`. The only values this model reports in
  devicemgmt are firmware, the iot switches, the motion-warning settings (`P1078` is the
  `motion-warning-schedule`, not a night setting), siren state, Wi-Fi strength and storage
  status. Its resolution, frame rate, bit rate and flip are `null` too, so this camera does not
  publish its camera settings to the cloud at all. Not yet tried on a model whose devicemgmt list
  is populated (see `TODO.md`).
- **Why the Cam v3 with the floodlight sends no audio over live view (unresolved).** The Wyze app plays this
  camera's sound, and its WebRTC answer says it will send audio (`port=9 direction=sendrecv`,
  with an `ssrc`), identical to the other Cam v3's answer, yet in nearly every stream since 17:53 on
  2026-10-25 no audio packets arrived. The other Cam v3 delivers about 26 packets a
  second every time. Tried without effect: `P1048` 0 to 1 (write accepted), matching `P1002` and
  `audio_alarm_switch` to the other Cam v3, a camera reboot. One exception: a single 10-second stream
  right after the reboot delivered 87 packets (about a third of the other Cam v3's rate) and nothing
  after that. It followed a snapshot capture that was cut short by the live stream, which may or
  may not matter. Parked; see the log below.

## Log

- 2026-11-18: Cam v3 (both) read over the local session for the first time: `K10720` holds the floodlight's own settings (brightness, mode, duration, PIR); `K10020` param 50 is the IR LED (cross-checked with `K10044`); param 15 and the cloud `audio_alarm_switch` agree on the two Cam v3s. devicemgmt answers for both Cam v3 (Wi-Fi, SD card, siren, motion schedule); its `floodlight::on` is not the light's state.

- 2026-11-18: the Wyze app's Smoke Alarm sound and CO Alarm sound toggles are `K10020` params 17 and 18 on the camera (1 on, 2 off); the cloud properties `smoke_alarm_switch` and `co_alarm_switch` are not them. First `K10020` read of a Cam v3. `getCameraAlarmSettings` added.

- 2026-11-14: pure-JavaScript TUTK client (`future/tutk/spike/tutk-spike.js`) authenticated against all four cameras; night vision read on all four and set on the Doorbell v2 and Cam v2; `K10020` params mapped (see above). Wired cameras give no battery data.
- 2026-11-14: Doorbell v2 night vision (Off, On, Auto) is not in the classic list or in devicemgmt (see above). Cross-checking the classic list against devicemgmt on the Doorbell confirmed `P1013` (Wi-Fi signal), `P1050` (siren-on time) and `P1078` (motion-alert schedule).
- 2026-10-25 (evening): Cam v3 (floodlight) audio parked as unresolved (see above). Night vision, IR light and the status light live on the camera, reached over TUTK (Linux only), not in this list.
- 2026-10-25: first version, from the Doorbell v2 and two Cam v3; added what wyze-sdk, wyzeapy and docker-wyze-bridge say, including where night vision lives.
