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
- **Sirius and earth services** (`plugin/sirius/…`, `plugin/earth/…`): listed in the SDK. None of the account's devices needs them as far as we know.

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
