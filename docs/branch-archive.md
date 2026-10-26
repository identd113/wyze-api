# Archived branches

Old branches that were cleaned out of the repository, what each one held, and where that work lives now. Each tip is kept as an `archive/<name>` tag, so the commits stay reachable (`git log archive/cameraStream`).

`2.x` is the default branch. `main` is the 1.x line (npm `latest`, 1.1.15).

## Summary

| Branch | Tip | Last commit | What it was | Where it lives now |
|---|---|---|---|---|
| `4-robot-vacuum-support` | `3cb026c0a` | 2024-02-29 | First vacuum support: a `src/payload/venus.js` payload builder and a crypto rewrite | `src/devices/vacuum.js`, `src/services/venus.js`, wiki [Robot-Vacuum](../wiki/Robot-Vacuum.md) (a later rewrite patterned on wyze-sdk) |
| `6-to-many-request-to-wyze-server` | `6f3b261ad` | 2024-02-09 | Login debounce, a user-agent change and the "Clean up MFA" commit (`463197a`) | The login debounce is in `src/index.js` (`loginAttemptDebounceMilliseconds`). The CHANGELOG names "Clean up MFA" as the commit that dropped 2FA; it was restored in 2.0.0-beta.3 |
| `cameraStream` | `275ea63d8` | 2024-02-23 | A JavaScript conversion of docker-wyze-bridge's `wyzecam` Python package (TUTK/IOTC) | Superseded by `src/tutk/` and `src/gutes/`, which are built on the same reference |
| `patch-1` | `cbf09d728` | 2024-02-05 | A README edit | Nothing to keep |
| `fix/runtime-bugs-and-logging-consistency` | `5e2eb1ed3` | 2026-04-24 | Replaces an unimported `moment().valueOf()` in `localBulbCommand` with `Date.now()`, plus logging cleanups | The `Date.now()` change is in `2.x` since 2.0.0-beta.2 (CHANGELOG). The logging cleanups were not compared |
| `dependabot/...-9d02389744`, `...-security-group-8cb6623c4d` | `bcc650f8c`, `6054dc7e8` | 2025-01, 2024-03 | Dependency bumps | Out of date; `npm audit` is clean on `2.x` |
| `2.0.0-merge-main` | `3c8e325a3` | 2026-08-06 | A parallel reconciliation of `main` into the 2.0.0 line, with a correctness and security audit | Mostly superseded by `2.x`; two of its three fixes were ported in 2.0.0-beta.4 and one was left out (below) |
| `UpdateLoggin`, `fix_issue9`, `fix_issue9-2`, `fix-main`, `pr/merge-main-into-2.0.0` | n/a | n/a | Nothing that `2.x` does not already have | Deleted without a tag |

## The `cameraStream` branch, as research

Commit `275ea63d8` ("Python Conversion from https://github.com/mrlt8/docker-wyze-bridge") adds 3,962 lines under `src/wyzecam/`:

- `api.js`, `apiModels.js`: the cloud login and device calls from `wyzecam/api.py`.
- `iotc.js`, `tutk/tutk.js`, `tutk/tutkProtocol.js`, `tutk/tutkIoctlMux.js`: the IOTC session and IOCtrl message mux.
- `tutk/deviceConfig.js` (957 lines): the table of per-model camera settings.

It was never wired into the library. The working version of this idea is in `src/tutk/lib/` (codec, header, messages, xxtea, auth, constants), which says it is a port from docker-wyze-bridge. If the local TUTK path is picked up again, `deviceConfig.js` on this branch is the part to read first; I found no matching per-model settings table in `src/tutk/`.

## The `4-robot-vacuum-support` branch, as research

`src/payload/venus.js` shows the request bodies for the vacuum ("venus") API: `createGetDeviceInfoPayload`, `createSetCurrentMapPayload`, `createSweepRecordsPayload` (`purpose: "history_map"`), `setIotActionSetPayload` (`cmd`, `is_sub_device: 0`) and `createEventPayload`. The room-selection logic is left as a commented-out port of wyze-sdk's `rooms_id` handling. The current `src/devices/vacuum.js` covers the same calls.

## Fixes on `2.0.0-merge-main`

Checked against `2.x` on 2026-10-26. None was a regression from beta.2. Status:

- 1 (`getHmsID`): **not ported.** The wiki documents it as a wrapper around `getPlanBindingListByUser()`, so changing it would change documented behaviour.
- 2 (setpoint units): **ported in 2.0.0-beta.4**, with a 40-100 °F range check, and the wiki corrected. The unit is inferred from how the plugin reads the values; thermostat owners are asked for confirmation.
- 3 (error redaction): **ported in 2.0.0-beta.4**, with a test.

1. **`getHmsID()` returns the raw plan list** (`src/devices/hms.helpers.js`), not an id string. The branch version walks the plans and returns the `hms_id` of the first plan that has a device bound to it. The plugin has its own copy of this logic, so only direct callers of the library are affected.
2. **`setThermostatHeatingSetpoint` and `setThermostatCoolingSetpoint` assume tenths of a degree** (680 = 68.0 °F). The rest of the codebase, and the plugin, treat `heat_sp` and `cool_sp` as whole degrees Fahrenheit. A caller using these two wrappers would send ten times the intended value. The branch fixes the setters, their docs and the test.
3. **Thrown errors can carry an unredacted Wyze response.** `login()`, `refreshToken()` and the access-token error handler put `JSON.stringify(result)` into `err.message`. That text bypasses the library's log redaction if a caller logs `err.message`. The branch runs it through `sanitizeLogMessage` first.

Commits on the branch: `3c8e325` (1 and 2) and `46ccebb` (3).

## Restoring a branch

```
git fetch origin 'refs/tags/archive/*:refs/tags/archive/*'
git switch -c cameraStream archive/cameraStream
```
