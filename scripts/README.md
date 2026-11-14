# wyze-api/scripts

Maintenance / setup scripts shipped with the wyze-api package.

## `fetch-wyze-sdk.js`

Downloads the Wyze SDK `.so` libraries needed for **local Tutk / GUTES
streaming** (Phase 1+ work — currently dev/research, not wired into
the published bridge).

### What it fetches

Two libraries, two sources:

| Library | Used for | Source | Pinned? |
|---|---|---|---|
| `libIOTCAPIs_ALL.so` | Tutk cameras — V2, V3, V4, Pan, Outdoor, original Doorbell, OG, Battery Cam Pro, Robot Vacuum | [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge)'s prebuilt `app/lib/lib.{amd64,arm64,arm}` | ✅ SHA256 pinned |
| `libiotp2pav.so` | GUTES cameras — Wyze Doorbell Pro, possibly Pro 2 | [APKPure](https://apkpure.com/wyze/com.hualai/download) — extracted from the Wyze Android XAPK | ❌ unpinned (rotates per Wyze app release) |

### Usage

```bash
# Fetch both for the host's architecture (most common):
npx wyze-api-fetch-wyze-sdk

# Equivalent if you have wyze-api as a local dep:
node node_modules/wyze-api/scripts/fetch-wyze-sdk.js

# Fetch only Tutk (fast, no APK download):
npx wyze-api-fetch-wyze-sdk --type tutk

# Fetch only GUTES (slow — downloads ~400MB XAPK):
npx wyze-api-fetch-wyze-sdk --type gutes

# Verify what's on disk without downloading:
npx wyze-api-fetch-wyze-sdk --verify-only

# Use a locally-downloaded XAPK for GUTES (no APKPure access):
npx wyze-api-fetch-wyze-sdk --type gutes --xapk /path/to/wyze.xapk

# Force re-download:
npx wyze-api-fetch-wyze-sdk --force

# Custom target directory:
npx wyze-api-fetch-wyze-sdk --target /opt/wyze-sdk
```

Default target: `~/.homebridge/wyze-sdk/`

### Exit codes

- `0` — all requested files present and verified
- `1` — at least one file failed
- `2` — unsupported platform (macOS / Windows — see below)
- `3` — CLI usage error

### Platform support

These binaries are **Linux ELF** (extracted from the Android APK).
They can't be loaded on macOS or Windows. The script refuses to run
on those platforms by default to fail-fast instead of producing useless
files.

| Platform | Tutk | GUTES |
|---|---|---|
| Linux x86_64 (NAS, server) | ✅ | ✅ |
| Linux arm64 (Pi 4/5, Apple silicon Linux VM) | ✅ | ✅ |
| Linux armv7 (older Pi) | ✅ | ✅ |
| macOS | ❌ | ❌ |
| Windows | ❌ | ❌ |

If you need the files on a non-Linux host (e.g. preparing them for a
NAS), set `WYZE_SDK_ALLOW_NON_LINUX=1` to bypass the platform check.

### Safety

- **Pinned download hosts**: only `raw.githubusercontent.com/mrlt8/...`
  and APKPure's CDNs. Redirects to other hosts are refused.
- **Pinned SHA256** for the Tutk libraries — a mismatch fails loudly
  and leaves your target dir untouched. Update the manifest in the
  script when docker-wyze-bridge bumps the binaries.
- **No code execution** during fetch. Just download + checksum +
  write. The `.so` files aren't loaded by the script itself.

### When SHA256s drift

If docker-wyze-bridge updates their `lib.*` files (rare — they ship
new builds every few months at most), the script's pinned SHA256
won't match and the fetch will fail with a clear message containing
the new SHA256:

```
✗ Tutk: SHA256 mismatch
  expected aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  got      f7ec63dcb589e1b6bf0b8921af80d9d29ea0ddc4b2437170cbec28b08faa516e
```

Update `TUTK_MANIFEST` in `fetch-wyze-sdk.js` with the new value (after
verifying it matches the source repo's commit history) and re-run.

### Why GUTES isn't SHA256-pinned

The Wyze APK rotates with every app release, so the `libiotp2pav.so`
hash changes each time. Pinning would force a manual update for every
Wyze app version. The integrity boundary for GUTES is the TLS
connection to APKPure + their content-addressed CDN; not as strong as
SHA pinning, but practical.

If you want stricter validation for production use, run the script
once, record the SHA256 of the resulting `libiotp2pav.so`, and add
your own verification check before loading it. Or pin the SHA256 by
editing `GUTES_MANIFEST` and adding an expected `sha256` field.

### When does the plugin call this?

Currently: never. The plugin doesn't auto-fetch yet — the protocol
ports under `example/` are still dev/research only.

The eventual design (per earlier planning conversation) is for the
bridge to call this script's underlying functions when a user enables
`advanced.tutk.enabled: true` or `advanced.gutes.enabled: true` in
their homebridge config, with a clear log message if the auto-fetch
fails and the plugin falls back to cloud streaming.

For now, the script is a standalone CLI for early testing.

## `camera-test-web.js`

A web page for testing your Wyze cameras from a browser. Run it on a computer on the same network as the cameras, for example the machine that runs Homebridge, and open the link it prints.

```bash
node scripts/camera-test-web.js              # port 8099
node scripts/camera-test-web.js --port 9000  # 1024 to 65535
```

Login comes from `USERNAME`, `PASSWORD`, `KEY_ID` and `API_KEY` in the environment or in `.env`. The script prints a link ending in `?token=...`; open it from a browser on the same network. The page lists the account's cameras. **Test** asks one camera directly over the local network (the read-only TUTK commands described under `--local` below) and shows each step as it passes and what the camera answered. After a test, **Off / Auto / On** set night vision; each asks you to confirm first. **Download results** saves the answers as JSON (no addresses, ids or keys). When the host program gives it a GitHub issue form (the Homebridge plugin does), a finished test also shows **Report this camera on GitHub**: it opens that form in a new tab with the model, firmware, plugin version and a short summary of the test already filled in. Nothing is sent from the page; GitHub shows the form and you read it, edit it and submit it (or close it). Only the model, firmware, which steps passed, how many commands were answered and the night-vision setting go into the link, never an address, id or key. The standalone script has no form, so it shows no link.

A browser cannot speak the camera protocol, so the server does the talking. It can change a camera setting, so it is not open to the world:

- Every request needs the random token (new at every start). It is checked in constant time, and eight wrong tokens block the sender for ten minutes.
- Only clients on the local network are served (loopback and private addresses). A request that carries a proxy header (`X-Forwarded-For`, `CF-Connecting-IP` and so on) is refused, so it does not work behind a tunnel or reverse proxy, on purpose.
- The `Host` header must be an IP address, `localhost`, a name without dots or a `.local` name, and a request from a page on another origin is refused. That stops a web page on the internet from reaching it through your browser.
- One test or change runs at a time. A change needs `confirm: true` in the request, which the page sends only after you press Confirm.
- It is plain HTTP, meant for your own network. Do not forward the port to the internet.

The port: 0 means off (the script refuses it), and 1 to 1023 is refused because those need root. The same checks are exported for other programs: `WyzeAPI.validateWebPort(value)` and `WyzeAPI.createCameraTestServer({ client, port, log })`; the Homebridge plugin uses them to start the page from its config. The server is in `src/web/cameraTestServer.js`, the page in `src/web/cameraTestPage.html`, and the tests in `tests/camera-test-server.test.js`.

## `device-report.js`

A read-only report on the devices of a Wyze account, for bug reports about a device that is missing or only partly works. Run it yourself and paste the file into the issue.

```bash
# From a checkout of wyze-api (it needs the repo's src/ and a login):
node scripts/device-report.js                      # every device
node scripts/device-report.js --model HL_CFL2      # only this model code (comma-separate several)
node scripts/device-report.js --out my-report.json # default: ./wyze-device-report.json
node scripts/device-report.js --local              # also ask each camera directly (see below)
```

Login comes from `USERNAME`, `PASSWORD`, `KEY_ID` and `API_KEY` in the environment or in `.env` (the same as the other scripts here).

For each device it records the model, type, firmware, the property list (`P1056 = 2`, and so on) and the device info. For cameras it also records whether the devicemgmt API answers and which capabilities it lists. A camera with no devicemgmt property list of its own is asked with the Floodlight Pro list (`LD_CFP`), and the report says so. It also records which API path this version of the library uses for the device.

It only reads. The code reaches the client through a view that offers four read methods, and a test fails if that grows. It never sets, switches, deletes or logs out.

MAC addresses, device names, IP addresses, the Wi-Fi name, serial numbers, account identifiers, thumbnail URLs and the time zone are removed. Any value the device list gives for a device (such as its P2P id) is also removed wherever another answer repeats it. Read the file once before you post it, and add the plugin version, which it cannot see.

### `--local`: ask the cameras directly

With `--local` the script also contacts each camera on your home network and adds a `local` section per camera. Run it from a computer on the same network as the cameras; with no route to them the section says it got no reply.

- **What it does:** it opens a session with the camera (UDP discovery, then a DTLS 1.2 handshake, then the camera's challenge login), using the pure-JavaScript client in `src/tutk/client.js`. Then it asks a fixed list of get commands: camera settings, night vision, IR LED, status light, video settings, overlays, motion, battery use and similar. For each it records what the camera answered, or `null` if it did not answer. A wired camera gives no battery data, so those two answer `null`.
- **What it records:** which steps worked (reachable, handshake, login, authentication), the form of the session (`CC51` or `IOTC`), the camera's own firmware and model, and the answers. It never records an address, id or key.
- **It only reads.** The client sends the login and get commands only. Anything else is refused by name, and a test checks that every command on the list is a get or a check.
- **Which cameras:** those the Wyze device list marks with the `dtls` flag and gives an IP address (all four cameras tested here do). Others get a `skipped` line saying why. Cameras on the Gwell protocol (OG, Pan v4) are not covered.
- **Time:** about 15 to 20 seconds for a camera that answers most commands, up to about 40 if it answers few.
- **Safe to use anywhere:** it opens no connection unless you pass `--local`.

The code is in `device-report-lib.js`; its tests are in `tests/device-report.test.js`.

