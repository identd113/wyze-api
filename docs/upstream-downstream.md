# Upstream and downstream

Who `wyze-api` depends on (upstream), who depends on it (downstream), and what we promise the second group. Facts below were checked on 2026-11-01. The commands to check them again are at the end.

```
Wyze cloud (unofficial endpoints)
        ^
        |   wyze-api  (this repo, npm: wyze-api)
        |        ^
        |        |-- homebridge-wyze-smart-home  -->  Homebridge  -->  HomeKit
        |        |-- other projects (mostly on the 1.x line)
```

## Downstream: who depends on us

**The Homebridge plugin** ([homebridge-wyze-smart-home](https://github.com/identd113/homebridge-wyze-smart-home)) is the main user.

- It declares `wyze-api` as a dependency (`^2.0.0-beta.3` today). Each release's notes say which plugin version it pairs with.
- At startup the plugin checks that the `wyze-api` it loaded satisfies that range (`src/wyzeApiVersion.js` in the plugin), and warns if it does not.
- **Publish order:** `wyze-api` first, then the plugin. Features in the plugin that need a new method (the Cam Plus plan lookup, the bulk property read) fail quietly against an older `wyze-api`, and the plugin's CI checks some of them against the registry copy.

**Everyone else.** `wyze-api` is a public npm package, so there are users we cannot see.

| | |
|---|---|
| npm `latest` | `1.1.15` (the 1.x line, branch `main`) |
| npm `beta` | `2.0.0-beta.3` (this branch, `2.x`) |
| Downloads | about 826 in the 30 days to 2026-10-29. Most are probably installs of the 1.x plugin. |
| Outside projects found | A handful of public GitHub repos list `wyze-api` in a `package.json`: a Home Assistant bridge and a few small apps. Every one pins the 1.x line (`^1.1.x` or `1.1.15`). None is on 2.x. |
| Outside use of 2.x-only methods | None found (searched for the device-object wrappers such as `plugOn(device)`). |

This is a search of public code, so it misses private projects and anything that is not on GitHub. Treat it as "there are some, and they are on 1.x", not as a full list.

## The promise: 2.x is a drop-in for 1.x

Code written against `wyze-api` 1.1.15 should run on 2.x without changes, apart from the differences listed below.

**What that covers** (and is tested):

- Every public method that 1.1.15 had is still there, with its parameters in the same order.
- Every export is still exported.
- The constructor takes every option 1.x took, and the client still sets the fields consumers read (`access_token`, `persistPath` and similar).
- The pure helper methods (no network, clock or randomness) return what 1.x returned for the same inputs.

**How it is enforced:** `tests/compat-1x.test.js` checks all of the above against `tests/fixtures/api-1.1.15.json`, which was taken from `main`. It runs in `npm test`. If a change breaks one of these, the test fails and names the method.

**What is not covered:** what the network methods return. A method can keep its name and parameters and still return a differently shaped response. That needs real calls to Wyze under both versions, and has not been done.

### Known differences from 1.1.15

These are on purpose. Each is also listed, with its reason, in `KNOWN_DIFFERENCES` in the compatibility test.

| Difference | Why |
|---|---|
| `authenticateAndFetchData` is removed | A Roku-auth helper that only logged a token. It went with the `aws-sdk` dependency. |
| `localBulbCommand` no longer takes a seventh parameter, `actionKey` | 1.x never used it. |
| `checkColorTemp` and `checkBrightnessValue` clamp to HomeKit's valid ranges | 1.x returned 500 for any colour temperature below 500, and passed brightness through unchanged. Both were bugs. |
| The constructor throws when `username` is empty | 1.x failed later, at login. |
| Node.js 22 or newer | 1.x declared no minimum. |
| Login and token errors no longer include Wyze's response text | The text could carry account details. |
| These dependencies are gone: `aws-sdk`, `colorsys`, `crypto-js`, `urllib`, `base64-js`, `@ptkdev/logger` | Nothing in 2.x uses them. A project that relied on getting one of them through `wyze-api` must now install it itself. |
| No longer prints "Created password hash…" to the console on login | 1.x did. |

### Rules for changing the public API

"Public" means any of: exported from the package, documented in the README or the wiki, or present in the 1.1.15 fixture.

- **Adding** a method, an option or an export is fine.
- **Removing, renaming, or reordering the parameters** of a public method breaks someone. Do not, unless there is a reason strong enough to write down. If there is, add it to `KNOWN_DIFFERENCES` in the compatibility test with the reason, and add it to the table above and to the changelog.
- **Documented helpers stay**, even when nothing in the plugin uses them. `rangeToFloat`, `fahrenheit2celsius` and the sensor accessors are in the wiki, so removing them is a breaking change.
- **An unused method that is not documented and not in the 1.1.15 fixture** (for example, the device-object wrappers) can be removed without a compatibility entry, but check the wiki and the plugin first.
- **Keep parked code out of the package.** Experimental work lives in `future/`, which `package.json`'s `files` list leaves out.

## Upstream: what we depend on and learn from

**The Wyze cloud.** There is no official public API for most of what this library does. It calls the same endpoints the Wyze app uses, so Wyze can change or remove them without notice. `docs/endpoints.md` records which endpoints have been checked against a real account, when, and by which script.

**Reference projects.** We read these and port from them. They are not dependencies.

| Project | What we took from it |
|---|---|
| [wyze-sdk](https://github.com/shauntarves/wyze-sdk) (Python) | The feature list for the parity batch (plug timers, wall-switch press types, lock reads, Bolt v2 and others, tracked in issues #41 and #42), and the model-to-device mapping. |
| [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge) | The TUTK (IOTC) protocol layer, now parked in `future/tutk/`. |
| [cryze](https://github.com/carTloyal123/cryze) | The GUTES protocol layer, now parked in `future/gutes/`. |
| [ha-wyzeapi](https://github.com/JoshuaMulliken/ha-wyzeapi), [wyze-node](https://github.com/noelportugal/wyze-node), [wyzeapy](https://github.com/SecKatie/wyzeapy) | Reference and inspiration, credited in the README. |

**npm dependencies** (what a project installing `wyze-api` also gets):

| Package | Used for |
|---|---|
| `axios` | HTTP calls to Wyze |
| `ffmpeg-static` | Live streams and snapshots (falls back to an `ffmpeg` on the PATH) |
| `werift` | WebRTC signalling and media for camera streams |
| `ws` | WebSocket signalling |
| `uuid-by-string` | A stable id made from the username (it names the saved-token file) |
| `utf8` | Text encoding for the password hash and request signing (`src/utils/crypto.js`) |

The TUTK code needs `koffi`. It is declared in `future/tutk/package.json`, not here.

## Before a release

1. `npm test` passes. That includes the compatibility test.
2. Run the plugin's tests against the new `wyze-api` (the plugin's `npm run dev-link` links the two).
3. Update "Pairs with" in the release notes.
4. Publish `wyze-api` first, then the plugin.
5. Until 2.0 is stable, 2.x goes out under the `beta` tag. npm `latest` stays on 1.x, so a plain `npm install wyze-api` does not move anyone to 2.x by accident.

## Checking this again

```
npm view wyze-api dist-tags                      # latest and beta
curl -s https://api.npmjs.org/downloads/point/last-month/wyze-api
gh search code '"wyze-api"' --filename package.json --limit 30      # who lists it
gh search code 'plugOn(device' --limit 10        # outside use of the 2.x-only wrappers
```
