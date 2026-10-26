# Camera properties: what each Wyze setting means

Wyze describes a camera's settings as numbered properties (`P1056`, `P1048`, ...) and a list
of device parameters (`dongle_switch`, `audio_alarm_switch`, ...). Wyze does not publish what
they mean. This page records what we know, how we know it, and what we have only guessed.

**Status key**

- **Confirmed**: we changed it (or watched it change) and saw what happened.
- **Library**: the name comes from this library or from [SecKatie/wyzeapy](https://github.com/SecKatie/wyzeapy); we have not tested it on our cameras.
- **Unknown**: only the values we have seen.

Observed values below were read on 2026-10-25 from a Cam Doorbell v2 (`HL_DB2`, "Doorbell") and
two Cam v3 (`WYZE_CAKP2JFUS`, "Back Yard" with a floodlight accessory, "Garage").
A dash means the camera does not report that property.

## How to find out what a setting does

1. Read the camera's properties once to get a baseline.
2. Change **one** setting in the Wyze app.
3. Read them again and diff. The value that moved is the setting.

Floodlight cameras change `P1056` and `dongle_switch` by themselves whenever the motion light
fires, so ignore those two while testing something else. `P1050` looks like a timestamp and
changes on its own.

## Properties (`get_property_list`)

| Property | Meaning | Status | Evidence / notes | Doorbell | Back Yard | Garage |
|---|---|---|---|---|---|---|
| `P1` | Notifications | Library | | 1 | 1 | 1 |
| `P3` | Camera on (0 = privacy / off) | Library | The Doorbell cannot be switched off through the API. | 1 | 1 | 1 |
| `P5` | Online | Library | | 1 | 1 | 1 |
| `P1001` | Motion detection on | Library | | 1 | 1 | 1 |
| `P1047` | Motion event recording | Library | | 1 | 1 | 1 |
| `P1048` | Sound event recording (library name: sound alarm enable) | Library | Set 0 to 1 on the Back Yard Cam: the write was accepted and read back as 1. It did **not** make the camera send audio over a live stream (two 20-second streams). | 1 | 0 to 1 | 1 |
| `P1049` | Siren (1 = on, 2 = off) | Library | | 2 | 2 | 2 |
| `P1056` | Floodlight / spotlight (1 = on, 2 = off) | **Confirmed** | On the Back Yard Cam it flipped to 1 whenever the motion light came on and back to 2 when it went out (six changes, 18:49 to 19:11), together with `dongle_switch`. The cloud list updates within seconds. | - | 2 | 2 |
| `P1301` | Garage door | Library | | - | 0 | 0 |
| `P1002` | Unknown. Changed 0 to 1 on the Back Yard Cam at the same time as `audio_alarm_switch` after a setting was changed in the Wyze app (which one was not recorded). | Unknown | The Garage has both at 1. Making them match did not bring audio. | 0 | 1 | 1 |
| `P1013` | Wi-Fi signal strength | Library | Doorbell only: 56 (weak). The Cam v3 reports none. | 56 | - | - |
| `P1050` | Looks like a Unix time (seconds) | Unknown | Changes on its own. | 1792911873 | 1792735385 | 1792472060 |
| `P1003` `P1004` `P1005` | Unknown | Unknown | | 0 / 0 / 1 | 1 / 1 / 1 | 1 / 1 / 1 |
| `P1006` to `P1008`, `P1010`, `P1014`, `P1015`, `P1017` to `P1022`, `P1033`, `P1035` | Unknown | Unknown | Same values on both Cam v3s (`P1015` is 1 on the Doorbell, 0 on the Cam v3s). | | | |
| `P1306` to `P1312`, `P3000`, `P1901` | Unknown | Unknown | `P1310` is 300 on both Cam v3s. | - | | |
| `P18` `P19` `P20` `P30` `P2` `P4` | Unknown | Unknown | | | | |
| `P1054` to `P1079`, `P1622`, `P1623` | Unknown | Unknown | Doorbell only. | | - | - |

## Device parameters (from the device list)

| Parameter | Meaning | Status | Evidence / notes | Doorbell | Back Yard | Garage |
|---|---|---|---|---|---|---|
| `power_switch` | Camera on | Library | | 1 | 1 | 1 |
| `motion_alarm_switch` | Motion alarm on | Library | | 1 | 1 | 1 |
| `records_event_switch` | Event recording on | Library | | 1 | 1 | 1 |
| `dongle_product_model` | The accessory plugged into the camera | **Confirmed** | `HL_CFL` is the floodlight on the Back Yard Cam. Blank on the Garage. | "" | HL_CFL | "" |
| `dongle_switch` | Accessory light on (1 = on, 2 = off) | **Confirmed** | Moves with `P1056`. | 0 | 2 | 2 |
| `audio_alarm_switch` | Unknown (a sound-related alarm flag) | Unknown | Changed 0 to 1 together with `P1002` on the Back Yard Cam; no effect on live audio. | 0 | 1 | 1 |
| `smoke_alarm_switch`, `co_alarm_switch` | Smoke / CO alarm listening | Unknown | Both 1 on the Cam v3s, 0 on the Doorbell. | 0 / 0 | 1 / 1 | 1 / 1 |
| `ai_notification_v2` | AI (person, vehicle, ...) notifications | Unknown | 0 on the Doorbell, 1 on the Cam v3s. | 0 | 1 | 1 |
| `spotlight_status`, `accessory_switch`, `power_saving_mode_switch`, `device_setting_channel`, `dtls`, `main_device_dtls`, `comfort_standard_level`, `power_source`, `is_link_toy_car`, `is_temperature_humidity`, `temp_humi_room_type`, `temperature`, `humidity`, `electricity`, `battery_charging_status` | Unknown | Unknown | | | | |

## Things we looked for and did not find

- **Night vision (Auto / Off / On).** Cycled Auto, Off, On, Auto on the Back Yard Cam while
  watching every property and parameter: nothing changed. It is not in these lists, so it is
  stored or sent some other way that this library does not read.
- **Microphone on/off for live view.** The Wyze app plays the Back Yard Cam's sound, but over
  our WebRTC connection the camera sends none. `P1048`, `P1002` and `audio_alarm_switch` were
  tried and are not it. The Garage (same model) does send audio.

## Log

- 2026-10-25: first version, from the Doorbell, Back Yard Cam and Garage.
