# Documentation

Notes for people working on `wyze-api` or building on it. The user-facing guide is the [README](../README.md) and the [wiki](../wiki/Home.md).

## Using the library, and what we promise

| File | What it covers |
|---|---|
| [downstream.md](downstream.md) | Who depends on `wyze-api`, the promise that 2.x is a drop-in for 1.x, the known differences, and the projects still on 1.x |
| [releasing.md](releasing.md) | How a release reaches npm: the workflows, the staged publish, the checklist, and why `wyze-api` goes first |
| [releases/](releases/) | Release notes for whoever ships and supports a release: what changed, what was checked on real hardware, what is unfinished |

## Reference

| File | What it covers |
|---|---|
| [endpoints.md](endpoints.md) | Wyze endpoints checked against a real account: what each returned, when, and by which script |
| [camera-properties.md](camera-properties.md) | What each numbered camera property (`P1056`, `P1048`, ...) means |

## Decisions and history

| File | What it covers |
|---|---|
| [design-bulk-property-read.md](design-bulk-property-read.md) | Why and how the bulk property read works, with the risks |
| [BUG-persisted-token-loop.md](BUG-persisted-token-loop.md) | Why a dead saved token blocked every re-login, and the fix |
| [FIX-mfa-login.md](FIX-mfa-login.md) | How 2FA login was lost in a 2024 cleanup, and how it was restored |
| [FIX-node24-tls-cert.md](FIX-node24-tls-cert.md) | Root cause of the `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` errors on Node 24.18+, and the fix |
| [branch-archive.md](branch-archive.md) | Old branches that were cleaned out, what each held, and where that work lives now |

## Tests and parked code

- Tests are in [`../tests/`](../tests/) and run with `npm test`. They need no network and no credentials. [`compat-1x.test.js`](../tests/compat-1x.test.js) checks that 2.x still offers everything 1.1.15 did.
- Parked experiments are in [`../future/`](../future/README.md), with their own tests (`npm run test:future`).
- The probe scripts that produced the endpoint notes are in [`../scripts/`](../scripts/README.md).

## Reporting a device

If a device is missing or only partly works, run `node scripts/device-report.js` from a checkout of this repo and paste the file it writes into the issue. It only reads, and it removes MAC addresses, names, IP addresses and account identifiers. Add `--local` when you are on the same network as your cameras: it also asks each camera directly (read only) for its settings, such as night vision. See [`../scripts/README.md`](../scripts/README.md#device-reportjs).

The camera test page (`npm run camera-test`, or inside Homebridge with a plugin that turns it on) does the same from a browser: its **Other devices** tab lists the devices the host program does not support, and its Test button builds this report for one device and opens the issue form with it filled in. The code is in [`../src/deviceReport.js`](../src/deviceReport.js).
