# Design: read camera properties in one bulk call

Status: proposed, not implemented. The plugin side is in
`homebridge-wyze-smart-home/docs/design-bulk-property-read.md`.

## Problem

The plugin reads each camera's properties on every refresh, one request per camera:

- `homebridge-wyze-smart-home/src/accessories/WyzeCamera.js:519–525` calls
  `client.getDevicePID(mac, model)`. A comment there already notes it is "one extra
  getDevicePID API call per refresh per camera".
- `wyze-api/src/index.js:1182` (`getDevicePID`) calls `app/v2/device/get_property_list`
  for one device.

With 4 cameras and the default 30 s refresh, that is 4 requests every 30 s for property reads
alone. The motion poller already solves the same shape of problem for events: it makes one
platform-wide request for every camera (`src/camera/motionPoller.js`). This design does the
same for properties.

## What we have verified (2026-10-29, live account, 4 cameras)

- `app/v2/device_list/get_property_list` with `device_list: [all camera MACs]` and
  `target_pid_list: [union of pids]` returns, for each camera, the same `{pid, value}` pairs as
  the per-device call. For all 4 cameras, the bulk and per-device values matched exactly, over
  the union of 72 property IDs (37, 39, 45 and 45 per camera).
- The bulk call **rejects a missing or empty `target_pid_list`** with
  `1001 target_pid_list cannot be null`. Every bulk call must name the pids.
- Each bulk row also carries `ts` per property: the time the value last changed. The per-device
  call returns the same `ts` field.
- The response is shaped differently. Per-device: `data.property_list[]`. Bulk:
  `data.device_list[].device_property_list[]`. Rows come back in the order of the request, and
  no MAC is included in a way we can rely on, so match by position.

Source: `docs/endpoints.md` (confirmed reads) and the comparison in this session. The
comparison script was in the scratchpad, not the repo.

## Proposed design

### Library (`wyze-api`)

1. Add `getPropertyListForDevices(devices, pids)`:
   - `devices`: array of `{ mac, model }`.
   - `pids`: array of property IDs. Required, non-empty.
   - Sends one `app/v2/device_list/get_property_list` request with `device_list` and
     `target_pid_list`.
   - Returns `Map<mac, Array<{pid, value, ts}>>`, matched to `devices` by position.
   - Throws on a non-SUCCESS code, like the other request methods.
2. Keep `getDevicePID` unchanged. The per-device path stays as a fallback.
3. Add an option to learn the pid list: `getDevicePID` already returns every pid a device
   reports. Cache the union of pids per model after the first successful per-device read. A
   model with no cached list falls back to the per-device call, so new models still work.

### Plugin (`homebridge-wyze-smart-home`)

1. Add a `PropertyPoller`, modelled on `src/camera/motionPoller.js`:
   - One platform-wide tick per `refreshInterval`.
   - Reads every online camera that has a cached pid list in one call.
   - Hands each camera its own rows, in the same shape `WyzeCamera` already expects
     (`propertyList.data.property_list`), so the switch in `WyzeCamera.js:541` does not change.
2. `WyzeCamera._refresh` uses the poller's rows when they are fresh. It falls back to
   `getDevicePID` when the poller has no rows for it yet, or when the bulk call failed.
3. The poller backs off after repeated failures, as `motionPoller` does (`MAX_BACKOFF_TICKS`).

## Expected effect

- With 4 cameras: 4 property requests per refresh become 1.
- With N cameras: N requests become 1, so the request count no longer grows with the number of
  cameras.
- The per-property `ts` is available, so the plugin can ignore a value that has not changed
  since the last tick.

## Risks and open questions

- **Pid list maintenance.** A pid we don't request is never read. The cached union must include
  every pid the plugin switches on (`P1056`, `P1001`, `P1047`, and the rest). Plan: derive the
  list from the first per-device read per model, and add a test that every pid the switch uses
  is in it.
- **Partial failure.** If one camera's row is missing from the response, that camera must fall
  back to `getDevicePID`, not show stale data.
- **Model coverage.** Verified on WYZEC1-JZ, HL_DB2 and WYZE_CAKP2JFUS (two cameras). Not
  verified on other camera families, or on devices that use the devicemgmt path
  (`cameraUsesDeviceMgmt`). The devicemgmt path stays unchanged.
- **Rate.** We have not measured Wyze's rate limits. The change lowers the request count, but
  the poll interval should stay at the current default until we have checked.

## Tests

- Library: unit test the position matching, the error on an empty pid list, and the fallback
  when a row is missing. No live calls in `npm test`.
- Plugin: unit test that `WyzeCamera` gets the same property values from the poller as from
  `getDevicePID`, using recorded responses.
- Live: run the existing `scripts/probe-camera-properties.js`-style comparison before and after,
  and check that values match.

## Not part of this design

- A sound-sensor accessory from the existing event list. It needs no new request, but it is a
  new feature and should be a separate proposal.
- `get_device_info` for Wi-Fi signal. Small gain, separate proposal.
