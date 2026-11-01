# Downstream

Who depends on `wyze-api`, and what we promise them. Facts below were checked on 2026-11-01. The commands to check them again are at the end.

```
wyze-api  (this repo, npm: wyze-api)
   |-- homebridge-wyze-smart-home  -->  Homebridge  -->  HomeKit
   |-- other projects (mostly on the 1.x line)
```

## Who depends on us

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
| Outside projects found | See [Projects still on 1.x](#projects-still-on-1x). Every one pins the 1.x line; none is on 2.x. |
| Outside use of 2.x-only methods | None found (searched for the device-object wrappers such as `plugOn(device)`). |

This is a search of public code, so it misses private projects and anything that is not on GitHub. Treat it as "there are some, and they are on 1.x", not as a full list.

## Projects still on 1.x

Collected on 2026-11-01 from npm, deps.dev, ecosyste.ms and a search of public GitHub code. "Methods called" is read from each project's own source, and every 1.x method they call exists in 2.x with the same parameters. Nobody has been contacted.

| Project | What it is | Last pushed | Uses `wyze-api` | Methods called | Moves to 2.x unchanged? |
|---|---|---|---|---|---|
| [homebridge-wyze-smart-home](https://github.com/jfarmer08/homebridge-wyze-smart-home) on npm (`latest` `0.5.61`) | The released Homebridge plugin. About 567 downloads in the 30 days to 2026-10-29, the largest group by far. | 2026-08-29 (125 stars) | `1.1.15`, exact | The whole plugin | This is the line 2.x of the plugin replaces. Its users upgrade by moving to the plugin's `2.x`, which brings `wyze-api` 2.x with it. |
| [EldonMcGuinness/wyze-api-ha-bridge](https://github.com/EldonMcGuinness/wyze-api-ha-bridge) | A Home Assistant bridge in a Docker image | 2026-10-30 | `1.1.15`, exact | `getDeviceList`, `getDeviceState` | Yes: both are unchanged. |
| [ClickCalickClick/Wyze-Control-for-Pebble](https://github.com/ClickCalickClick/Wyze-Control-for-Pebble) | A Pebble watch app that controls Wyze devices | 2026-06-17 | A copy of `1.1.7` kept inside the repo, not installed from npm | `getDeviceList`, `getDeviceState`, `getDeviceByName`, `maybeLogin`, and `plugOn(id, model)` | Mostly. `plugOn(id, model)` is not in any 1.x release, and 2.x defines `plugOn(device)`, so that call needs fixing either way. |
| [NadavM316111/Jarvis](https://github.com/NadavM316111/Jarvis) | A personal assistant project | 2026-06-11 | `^1.1.7` | None found in the code I read | Probably an unused dependency. |
| [chrisparedes566/aerial_control_app](https://github.com/chrisparedes566/aerial_control_app) | A small control app | 2025-11-07 | `^1.1.7` | `getDeviceByName`, `plugTurnOn`, `plugTurnOff`, `wallSwitchPowerOn`, `wallSwitchPowerOff` | Yes: all unchanged. Little recent activity. |

Also on npm: `@zswuwing/homebridge-wyze-smart-home`, an old fork of the plugin (last release 2023, 46 downloads a month). Not worth chasing.

These are only the ones a public search can find. deps.dev lists two npm packages that depend on `wyze-api`: that fork and a bulk registry mirror.

### Encouraging an upgrade

What to tell a project on 1.x:

- `npm install wyze-api@beta` installs 2.x. Until 2.0 is stable, `latest` stays on 1.x, so nobody is moved by accident.
- Code that calls the methods in the 1.x fixture runs unchanged. The differences are the ones listed below: Node.js 22 or newer, a constructor that throws on an empty username, and the removed dependencies.
- What 2.x adds that a 1.x user does not have: bulk property reads, camera event lists with AI labels, the Cam Plus plan lookup, camera streaming and snapshots through a warm WebRTC connection, and the newer devices (Lock Bolt v2, Palm Lock, the newer cameras).

Contacting these projects (an issue or a pull request that bumps the version) is a decision for the maintainer of this repo. Doing it from a public account is outward-facing, so nothing has been sent.

## The promise: 2.x is a drop-in for 1.x

Code written against `wyze-api` 1.1.15 should run on 2.x without changes, apart from the differences listed below.

**What that covers** (and is tested):

- Every public method that 1.1.15 had is still there, with its parameters in the same order, and every option of an options-object parameter still accepted. A parameter that is only renamed has to be listed below.
- Every export is still exported.
- The constructor takes every option 1.x took, and the client still sets the fields consumers read (`access_token`, `persistPath` and similar).
- The pure helper methods (no network, clock or randomness) return what 1.x returned for the same inputs.

**How it is enforced:** `tests/compat-1x.test.js` checks all of the above against `tests/fixtures/api-1.1.15.json`, which was taken from `main`. It runs in `npm test`. If a change breaks one of these, the test fails and names the method.

**What is not covered:** what the network methods return, thrown errors, and default values. A method can keep its name and parameters and still return a differently shaped response. That needs real calls to Wyze under both versions, and has not been done.

### Known differences from 1.1.15

These are on purpose. Each is also listed, with its reason, in `KNOWN_DIFFERENCES` in the compatibility test.

| Difference | Why |
|---|---|
| `authenticateAndFetchData` is removed | A Roku-auth helper that only logged a token. It went with the `aws-sdk` dependency. |
| `localBulbCommand` no longer takes a seventh parameter, `actionKey` | 1.x never used it. |
| `setIotProp`'s third parameter is `deviceModel`, not `product_model`. `getLockState`'s is `hardlock`, not `deviceState` | A rename only. Callers pass these by position, so nothing changes for them. |
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
