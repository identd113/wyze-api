# Endpoints: what we have confirmed, and what is unused

A record of Wyze endpoints we have called or checked, and what they returned. Add an entry when an
endpoint is confirmed against the live servers, and say how it was checked.

**Status key**

- **Confirmed (read)**: called against a real account, returned `code: "1"` (SUCCESS), and the response was checked.
- **Confirmed (empty)**: the call succeeded but returned no data, so the response shape is only partly known.
- **Used by the library**: already called by `wyze-api`. Not re-tested here.
- **Not called**: found in the SDK or the code, but not called. Each entry gives the reason.
- **Not tried**: not called yet.

All calls below go to `https://api.wyzecam.com/` and are POST with a JSON body, unless noted. The
library's `request()` adds the `sv` signing constant for each call.

## Confirmed

| Endpoint | Status | Request body | What came back | Checked |
|---|---|---|---|---|
| `app/user/get_user_info` | Confirmed (read) | `{}` | Profile: `nickname`, `email`, `user_code`, `user_center_id`, `open_user_id`, `logo`. | 2026-10-29, `scripts/probe-unused-endpoints.js` |
| `app/v2/device_list/get_property_list` | Confirmed (read) | `device_list`: array of device MACs. `target_pid_list`: array of property IDs (required, cannot be empty). | `device_list[]`, each with `device_property_list[]` of `{pid, value, ts}`. `ts` is the time (ms) that property last changed. Returned 4 cameras with `P3`, `P5`, `P1003`–`P1005`. | 2026-10-29, `scripts/probe-unused-endpoints.js` |
| `app/v2/device/get_event_list` (sound) | Confirmed (read) | `device_mac_list`, `event_value_list: [2]`, `event_type: "1"`, `begin_time`/`end_time` in ms, `order_by: 2`, `count`. | `event_list[]` (5 events in the last 7 days) and `next_page`. Each event has `event_value`, `event_ts`, `read_state`, `tag_list`, `file_list`, and `event_resources`. | 2026-10-29, `scripts/probe-unused-endpoints.js` |
| `app/v2/device/get_event_list` (other, smoke, CO) | Confirmed (empty) | Same as sound, with `event_value_list: [3]`, `[4]` or `[5]`. | `event_list: []` in the last 7 days. The response shape is the same as sound, but there is no non-empty sample. | 2026-10-29, `scripts/probe-unused-endpoints.js` |
| `app/device/get_device_info` | Confirmed (read) | `{device_mac, device_model}` | Same kind of data as `get_device_Info`, plus `role`, `device_timezone`, `binding_user_nickname`, `open_close_state`, `voltage`, `temperature`, `rssi`, `humidity`, `device_positioning`. `ssid`, `ip` and `public_ip` are personal network details and are not recorded here. | 2026-10-29, `scripts/probe-unused-reads.js` (4 cameras) |
| `app/v2/device_group/timer/get` | Confirmed (read) | `{group_id, action_type}`. `group_id` is the `group_id` field from `getDeviceGroupsList()`, not `id`. | `{plan_execute_ts: 0, delay_time: 0, action_value: ""}` for `action_type` 1 and 2, so no timer was set. A non-empty timer is not confirmed. | 2026-10-29, `scripts/probe-unused-reads.js` |

Calling the timer endpoint with the wrong `group_id` (for example `undefined`) returns
`400 "Failed to read HTTP message"`. That message is misleading.

## Checked on 2026-11-18 (read only, one account: nine devices)

**devicemgmt `get_iot_prop`** (`devicemgmt-service-beta.wyze.com/device-management/api/device-property/get_iot_prop`) is not camera-only. The body names capability groups; each answer lists the groups with `null` for what the device does not have. How a device that lacks a group reacts differs:
- Most devices (every camera, the Palm Lock, the chime sensors, the Scale X) accept every group and answer `null` for the missing ones, so an accepted group proves nothing. Judge by the values.
- The Doorbell v2's chime (`GW_CHI`) rejects the whole request with HTTP 400 and `unsupported capability <group>`, naming the first group it lacks (`camera`, then `camera-ai`, and so on). Without those it answers `device-info`, `iot-device` and `wifi`. Ten groups were refused one at a time (eleven requests). The device report's `--discovery` does this.
- What had values: Cam v2, Doorbell v2, both Cam v3: `device-info`, `iot-device`, `wifi`, `memory-card-management`, `motion-detection`, `siren`, a few `camera` properties (`floodlight::on` on the floodlight camera only). Palm Lock (`DX_PVLOC`): `device-info`, `iot-device`, `wifi` and `battery` (four values). Chime sensors (`CHIME`): firmware, hardware, time zone and online state. Scale X (`WL_SC3`): nothing.

**iot3 `get-property`** (`app.wyzecam.com/app/v4/iot3/get-property`, the Lock Bolt V2 and Palm Lock service) answers success for any device, with values only for the Palm Lock (`lock::lock-status`, `iot-device::iot-state`). Judge it by its values, not the code.

**The classic list gives nothing** for the Doorbell v2's chime (`GW_CHI`) and the Scale X (`WL_SC3`); they use another backend. Neither is read by the library. The chime sensors (`CHIME`) give five properties.

**Rate-limit headers** (`getRateLimitObservations()`, after a full report with discovery, about 10 seconds): `api.wyzecam.com` sends `remaining` and `reset` on `get_object_list`, `get_property_list` and `get_device_Info` (`remaining` 292 to 295, `reset` a date string about five minutes after the first call, with a 300-ish limit). It did not count down by one per call (about 20 calls went to `api.wyzecam.com`), and `devicemgmt-service-beta.wyze.com` sent no rate-limit headers at all. `getRateLimitObservations()` keeps only the last answer per path; `getRateLimitHistory()` (added 2026-11-18) keeps the last 100 answers per path that had the headers, with a count of all answers, which is what is needed to tell whether the limit is per account, host or endpoint. That is still open.

**`app.wyzecam.com` serves the same `/app` calls as `api.wyzecam.com`** (checked with the same login on both hosts): `get_object_list`, `get_property_list` and `get_device_Info` for all nine devices gave identical answers, except the expiring signed thumbnail URLs in the device list. See `docs/FIX-node24-tls-cert.md` for the certificate chains.

Not probed: the Venus, Earth, Ford, Lockwood and Olive services (no device of theirs on this account).

## Used by the library (not re-tested here)

| Endpoint | Used for |
|---|---|
| `app/v2/device/get_property_list` | Per-device property read (`getPropertyList`). |
| `app/v2/device/get_device_Info` | Device info (`getDeviceInfo`). Returns the MAC, firmware version, timezone, and activation times. |
| `app/v2/device/get_event_list` (motion) | Motion events. |

## Advertised methods (`OPTIONS`)

`OPTIONS` requests were sent with no body and no login. Nothing that changes state was sent. The
`Allow` header is a hint from the gateway, not proof of what the endpoint accepts. None of these
endpoints advertised `DELETE`, `PUT` or `PATCH`. That doesn't rule them out, because the gateway may
not list every method.

| Host | Path | `OPTIONS` status | `Allow` |
|---|---|---|---|
| `api.wyzecam.com` | `app/user/change_password` | 200 | `POST, OPTIONS` |
| `api.wyzecam.com` | `app/user/logout` | 500 | not sent |
| `api.wyzecam.com` | `app/device/get_device_info` | 200 | `POST, OPTIONS` |
| `api.wyzecam.com` | `app/v2/device_group/timer/get` | 200 | `POST, OPTIONS` |
| `api.wyzecam.com` | `app/v2/device_event/set_read_state_list` | 200 | `POST, OPTIONS` |
| `api.wyzecam.com` | `app/v2/device_list/get_property_list` | 200 | `POST, OPTIONS` |
| `api.wyzecam.com` | `openapi/v1/device` | 500 | not sent |
| `wyze-platform-service` | `app/v2/platform/get_variable` | 200 | `GET, HEAD, OPTIONS` |
| `wyze-platform-service` | `app/v2/platform/update_user_profile` | 200 | `POST, OPTIONS` |
| `wyze-scale-service` | `plugin/scale/*` (15 paths) | 401 | not sent |
| `wyze-earth-service` | `plugin/earth/*` (7 paths) | 403 | not sent |
| `wyze-sirius-service` | `plugin/sirius/*` (7 paths) | 403 | not sent |
| `wyze-pluto-service` | `plugin/pluto/*` (11 paths) | 403 | not sent |
| `api.wyzecam.com` | `app/v2/device_list/set_property_list` | 200 | `POST, OPTIONS` |
| `yd-saas-toc.wyzecam.com` | `openapi/lock/v1/ble/token` | 200 | not sent |
| `wyze-general-api.wyzecam.com` | `v1/user/event` | 200 | `POST, OPTIONS` |
| `auth-prod.api.wyze.com` | `user/login/sendSmsCode`, `user/login` | 403 | not sent |
| `wyze-earth-service` | `plugin/earth/device_info/batch`, `plugin/earth/get_iot_prop/batch` | 403 | not sent |
| `wyze-sirius-service` | `plugin/sirius/device_info/batch`, `plugin/sirius/get_iot_prop/batch` | 403 | not sent |
| `webrtc.api.wyze.com` | `signaling/device` (base path, no MAC) | 403 | not sent |
| `app-core.cloud.wyze.com` | `app/v4/device/get-property` (guessed path) | 404 | not sent |

The scale service returns 401 to `OPTIONS` without a token. That means the route exists, but the
gateway checks authentication before it checks the method. The earth, sirius and pluto services
return 403, which may be a gateway rule. A 500 means the server failed on the `OPTIONS` request
itself, so nothing can be concluded about that endpoint.

## Not called, and why

| Endpoint | Reason |
|---|---|
| `app/user/change_password` | Changes the account password. |
| `app/user/logout` | Logs the account out. `OPTIONS` returns 500, so the behaviour is unknown. |
| `app/v2/device_event/set_read_state_list` | Marks events as read. A write. |
| `app/v2/platform/update_user_profile` | Writes the profile. |
| `app/v2/platform/get_variable` | A GET with query parameters. The repo's `request()` only sends POST, and the variable keys haven't been chosen. |
| `openapi/v1/device` | `OPTIONS` returns 500. The SDK doesn't say what it does. |
| `plugin/scale/*` | Needs an auth token the repo doesn't have. The SDK's `get_token` takes a device ID and returns a binding token, but the flow isn't worked out yet. |
| `plugin/earth/*`, `plugin/sirius/*`, `plugin/pluto/*` | Blocked at `OPTIONS` (403). No account device is clearly one of these. |

## Not tried yet

- **Scale service** (`https://wyze-scale-service.wyzecam.com`, paths under `/plugin/scale/`): the bathroom scale (`WL_SC3`) on the account. Calls to try are `get_latest_record`, `get_record_range`, `get_device_setting`, and `get_user_device_relation`. This host isn't in the library yet, and it may need its own token (`get_token`).
  - **Another source says no separate token is needed.** A public project that audited the Wyze API live (a Pebble watch app, `ClickCalickClick/Wyze-Control-for-Pebble`, its `API_FEASIBILITY_REPORT.md`, dated 2025-12-12) rates the scale read "high" confidence and says the scale service takes the same Olive-style signed request (HMAC-MD5 with the app id and access token) as the thermostat, wall switch and Home Monitoring calls. That conflicts with the `get_token` note above. Neither has been tried here with a call from this library, so treat both as unconfirmed.
  - **Parked on purpose (2026-11-01).** HomeKit has no weight or scale service, so the Homebridge plugin could not show these readings, and the library would be the only user. Probe it (read-only, one account scale) only if someone wants scale data in a script or in Home Assistant. A "someone just weighed in" trigger sensor would be the only HomeKit use, and it is not worth the work on its own.
- **Sirius and earth services** (`plugin/sirius/…`, `plugin/earth/…`): listed in the SDK. None of the account's devices needs them as far as we know.

## From other Wyze clients (unverified)

Found by reading `wyzeapy`, `wyze-sdk`, `docker-wyze-bridge` and `wyze-node`. None of these has been called against a live account. Entries already listed above are left out.

| Endpoint | Host | Method | Seen in | Notes |
|---|---|---|---|---|
| `user/login/sendSmsCode` and `user/login` | `auth-prod.api.wyze.com` | POST | wyzeapy `wyze_auth_lib.py` | SMS 2FA login. See [FIX-mfa-login.md](FIX-mfa-login.md). |
| `app/v2/device_list/set_property_list` | `api.wyzecam.com` | POST | wyzeapy `base_service.py` | Bulk set-property. Not the same path as `app/v2/device/set_property_list`. Bulbs honour it. |
| `openapi/lock/v1/ble/token` | `yd-saas-toc.wyzecam.com` | GET | wyzeapy `base_service.py` | BLE token for a lock. |
| `<bulb_ip>:88/device_request` | the bulb on the LAN | POST | wyzeapy `base_service.py` | Local encrypted bulb control, with cloud as fallback. See [Local-Protocol.md](../wiki/Local-Protocol.md). |
| `app/device/{endpoint}` | `api.wyzecam.com` | POST | docker-wyze-bridge `api.py` | Generic v1 device route. The endpoint name is supplied by the caller. `app/device/get_device_info` is confirmed above. |
| `app/v4/device/{endpoint}` | `app-core.cloud.wyze.com` | POST | docker-wyze-bridge `api.py` | Signed v4 device route on another host. |
| `signaling/device/{mac}?use_trickle=true` | `webrtc.api.wyze.com` | GET | docker-wyze-bridge `api.py` | WebRTC signalling and ICE servers for cameras. |
| `user/event` | `wyze-general-api.wyzecam.com` | POST | wyze-sdk `general_api_service.py` | User event reporting. |
| `plugin/earth/device_info/batch`, `plugin/earth/get_iot_prop/batch` | not stated in the source | GET | wyze-sdk (thermostat comments) | Batch reads for thermostat sub-devices and room sensors. |
| `plugin/sirius/device_info`, `…/device_info/batch`, `…/get_iot_prop/batch`, `…/get_sub_device`, `…/set_iot_prop` | `api.wyzecam.com` | GET or POST | wyze-sdk `sirius_service.py` | Sirius hub sub-devices. `plugin/sirius/*` is blocked at `OPTIONS` (see above). |
| `plugin/venus/{did}/control`, `plugin/venus/{did}/status` | `api.wyzecam.com` | POST, GET | wyze-sdk `venus_service.py` | Per-device routes. The library uses `set_iot_action` and `get_iot_prop` instead. |
| `plugin/pluto/*` | scale service | GET, POST | wyze-sdk `pluto_service.py` | Newer scale service. Mirrors `plugin/scale/*` and is covered by the scale notes in "Not tried yet". |

## Open items for the other-client endpoints

- Whether the library's request host list needs `app-core.cloud.wyze.com`, `webrtc.api.wyze.com` and `wyze-general-api.wyzecam.com`. The redirect allowlist in `src/util/security.js` doesn't include them, so calls to them would be refused until it's updated.
- The request parameters for each endpoint in the table. Read the matching SDK `*_service.py` first.

## Still open

- Whether DELETE is supported on any of these. `OPTIONS` didn't show it, and no endpoint tried accepted it.
- The scale service's auth flow, and its read endpoints.
- A non-empty timer from the device-group timer endpoint.

## Where the checks live

- `scripts/probe-unused-endpoints.js`: user info, the bulk property read, and the event lists. Read-only.
- `scripts/probe-unused-reads.js`: `get_device_info` and the device-group timer. Read-only. Removes MAC addresses from its output.
- `scripts/probe-options.js`: the `OPTIONS` requests above. Read-only.
- `scripts/probe-camera-properties.js`: the per-camera property list and device info. Read-only.
- `scripts/verify-live.js`: login and device list. Read-only.

The output files contain account data (event history and the account profile), so keep them out of
the repo.
