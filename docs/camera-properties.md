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
| `P1013` | Wi-Fi signal strength | Library | Doorbell only: 56 (weak). The Cam v3 reports none. | 56 | - | - |
| `P1050` | Looks like a Unix time (seconds) | Unknown | Changes on its own. | 1792911873 | 1792735385 | 1792472060 |
| `P4` | Event switch | Library | wyze-sdk (`event_switch`) | 1 | 1 | 1 |
| `P1021` | Dongle (accessory) light switch | Library | wyze-sdk (`dongle_light_switch`). Not yet tested: the Cam v3 with the floodlight has a dongle and reads 1. | - | 1 | 1 |
| `P1003` `P1004` `P1005` | Unknown | Unknown | wyze-sdk lists them as "not used" (they exist in Wyze's app but nothing uses them). | 0 / 0 / 1 | 1 / 1 / 1 | 1 / 1 / 1 |
| `P1006` to `P1008`, `P1010`, `P1014`, `P1015`, `P1017` to `P1022`, `P1033`, `P1035` | Unknown | Unknown | Same values on both Cam v3s (`P1015` is 1 on the Doorbell, 0 on the Cam v3s). | | | |
| `P1306` to `P1312`, `P3000`, `P1901` | Unknown | Unknown | `P1310` is 300 on both Cam v3s. | - | | |
| `P18` `P19` `P20` `P30` `P2` | Unknown | Unknown | | | | |
| `P1078` | Quiet hours (the user's reading of the value; not yet tested) | User-reported | Doorbell only. The value is a JSON schedule: `{"always":1,"startTime":"21:00:00","startTimeType":"CUSTOM","endTime":"06:00:00",…}`. | (object) | - | - |
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
| `audio_alarm_switch` | Unknown (a sound-related alarm flag) | Unknown | Changed 0 to 1 together with `P1002` on the Cam v3 with the floodlight; no effect on live audio. | 0 | 1 | 1 |
| `smoke_alarm_switch`, `co_alarm_switch` | Smoke / CO alarm listening | Unknown | Both 1 on the Cam v3s, 0 on the Doorbell. | 0 / 0 | 1 / 1 | 1 / 1 |
| `ai_notification_v2` | AI (person, vehicle, ...) notifications | Unknown | 0 on the Doorbell, 1 on the Cam v3s. | 0 | 1 | 1 |
| `spotlight_status`, `accessory_switch`, `power_saving_mode_switch`, `device_setting_channel`, `dtls`, `main_device_dtls`, `comfort_standard_level`, `power_source`, `is_link_toy_car`, `is_temperature_humidity`, `temp_humi_room_type`, `temperature`, `humidity`, `electricity`, `battery_charging_status` | Unknown | Unknown | | | | |

## What other projects say

- **[shauntarves/wyze-sdk](https://github.com/shauntarves/wyze-sdk)** (Python, cloud API) lists camera property names taken from the Wyze app's own code: `P4` event switch, `P1021` dongle light switch, `P1047` motion record, `P1048` sound record. It marks most of the rest (`P1001` to `P1020`, `P1301` to `P1329`, `P1501` to `P1506`) as "not used".
- **[SecKatie/wyzeapy](https://github.com/SecKatie/wyzeapy)** (Python, Home Assistant) uses `P1049` siren, `P1056` accessory state (garage door, light socket, floodlight), `P1301` contact state, `P1302` motion state, `P1001` / `P1047` motion detection, `P1029` for the outdoor cam.
- **[mrlt8/docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge)** controls the settings that are **not** in the cloud list, over the camera's own connection (TUTK / IOTC), not the Wyze cloud. That is where night vision lives.

## Settings the camera keeps itself (not in the cloud property list)

These are read and set with TUTK commands sent to the camera. Command numbers and values come
from docker-wyze-bridge. None is tested here yet.

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

`wyze-api` already carries a port of this protocol in `src/tutk/` (including
`K10042SetNightVisionStatus`), but it needs Wyze's native IOTC library and only loads on Linux,
so it would not run on the Mac test bridge. It is not used by the plugin today.

## Things we looked for and did not find

- **Night vision (Auto / Off / On) in the cloud list.** Cycled Auto, Off, On, Auto on the Back
  Yard Cam while watching every property and parameter: nothing changed. This matches the above:
  the camera keeps it, and the cloud list does not carry it.
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

- 2026-10-25 (evening): Cam v3 (floodlight) audio parked as unresolved (see above). Night vision, IR light and the status light live on the camera, reached over TUTK (Linux only), not in this list.
- 2026-10-25: first version, from the Doorbell v2 and two Cam v3; added what wyze-sdk, wyzeapy and docker-wyze-bridge say, including where night vision lives.
