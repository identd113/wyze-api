# future/tutk

> **Parked, and not part of the published package.** Moved out of `src/` on 2026-11-01. Nothing in `wyze-api`
> or the Homebridge plugin loads it. See [`../README.md`](../README.md) for what `future/` means.

## Where this stands

- **What it is for:** talking to Wyze cameras over the local network with ThroughTek's TUTK (IOTC, "Kalay")
  protocol, the way docker-wyze-bridge does, instead of through Wyze's cloud.
- **How far:** the control side works. It loads TUTK's native library through `koffi`, opens a session,
  authenticates and exchanges commands, with unit tests and a Docker smoke test against the real library. The
  video side is not built: no worker-thread receive pump, no routing of commands locally, no turning frames into
  H.264 for HomeKit (Phases 2, 2.5 and 3).
- **Is it better than what we have:** not today. The cloud path (WebRTC and Wyze's HTTP API) already does
  everything the plugin needs, including video. This would add local, cloud-free control and video.
- **Platform:** Linux only (the library ships glibc binaries for x86_64, arm64 and armv7). The Mac mini cannot
  run it; the Synology's Docker could.
- **Not like GUTES:** it uses an ordinary Linux library, so there is no equivalent of GUTES's Android-library
  wall. What is left is engineering, not a blocker.
- **Pick it up again when:** there is a reason for local video or LAN control (latency, running without the
  cloud) and a Linux host to run it on.
- **Why `koffi` is declared here:** only this code needs it. See `package.json` in this folder. Run
  `npm install` here before using the real library; the unit tests use a stub and do not need it.


Phase 1 production code — Tutk SDK loader + session orchestrator. This
is the layer that actually talks to Wyze cameras over the local IOTC
session.

## Files

```
future/tutk/
├── loader.js   — koffi bindings for libIOTCAPIs_ALL.so
├── session.js  — Promise-based session/auth/IOCtrl mux
├── lib/        — pure-JS protocol layer (Phase 0 port from
│                 docker-wyze-bridge), see lib/ for details:
│                 codec/header/messages/xxtea/auth/constants
├── demo/       — runnable Phase 0 demo (spike.js)
├── test/       — unit and fixture tests: `npm run test:future`
├── docker/     — Docker smoke tests against the real library (and a real camera)
├── package.json— declares koffi, the only dependency this code needs
└── README.md   — you are here
```

## Loader

`loader.js` exposes:

- **`isTutkSupported()`** — `{ supported, platform, arch, reason? }`.
  Cheap call; gate every Tutk feature on this so cloud-fallback paths
  stay consistent.
- **`defaultSoPath()`** — `~/.homebridge/wyze-sdk/libIOTCAPIs_ALL.so`
  (matches `scripts/fetch-wyze-sdk.js`'s default target).
- **`loadTutk(soPath?)`** — opens the `.so`, binds ~30 IOTC + AV
  functions, returns a typed wrapper. Throws `TutkLoaderError` on:
  - Non-Linux host
  - Wrong-arch host (x64/arm64/arm supported)
  - Missing `.so` file
  - Missing symbols (incompatible SDK version)

The loader does NOT auto-fetch — callers can call
`scripts/fetch-wyze-sdk.js`'s `fetchTutk()` themselves or run
`npx wyze-api-fetch-wyze-sdk` once at setup time.

### Platform support

Tutk runs natively on Linux only — the SDK binary docker-wyze-bridge
ships is compiled against standard glibc, **no Bionic shim required**
(unlike the GUTES `libiotp2pav.so` extracted from Android APKs).

| Platform | Status |
|---|---|
| Linux x86_64 | ✅ |
| Linux arm64 | ✅ |
| Linux armv7 | ✅ |
| macOS | ❌ — `loadTutk()` throws clearly; caller falls back to cloud |
| Windows | ❌ — same |

## Session orchestrator

`session.js` wraps the loader with a Promise-based API for end-to-end
camera sessions:

```js
const { TutkSession } = require('wyze-api/future/tutk/session');
const M = require('wyze-api/future/tutk/lib/messages');

const sess = new TutkSession({
  uid: 'AABBCCDDEEFF',
  enr: '...',                  // from Wyze cloud device info
  productModel: 'WYZE_CAKP2JFUS',
  phoneId: 'any-stable-id',
  openUserId: 'user-id-from-cloud',
});

await sess.connect();           // opens IOTC + AV channel + auth handshake
const time = await sess.send(new M.K10090GetCameraTime());
await sess.send(new M.K10042SetNightVisionStatus(M.NV_AUTO));
await sess.close();
```

### What `connect()` does

1. Acquire the SDK (ref-counted across all `TutkSession` instances in
   the process — `IOTC_Initialize2` runs once).
2. `IOTC_Connect_ByUID(uid)` → IOTC session id.
3. `avClientStartEx({ sessionId, username, password, ... })` → AV
   channel id.
4. Start a 50Hz receive pump (`avRecvIOCtrl` polling, dispatches to
   the per-K-class waiter Map).
5. Auth handshake: send `K10000` → await `K10001` → derive challenge
   response via `xxtea` → send `K10002`/`K10006`/`K10008` (chosen by
   `auth.buildAuthResponse` based on model + protocol) → await
   `K10003`/`K10007`/`K10009`.

After `connect()` returns, `state === 'authed'` and you can `send()`
any K-class message.

### `send()`

`send(message, timeoutMs = 10000)` returns a Promise that resolves
with the camera's parsed response, or rejects with
`TutkSessionError` on timeout or `SessionClosedError` if the session
closes before the response arrives.

The K-class's `expectedResponseCode` (always `code + 1`) is what we
match in the receive pump's dispatch table.

### `close()`

- Cancels the receive pump.
- Rejects all pending `send()` promises with `SessionClosedError`.
- Stops the AV channel + closes the IOTC session.
- Decrements the SDK refcount; calls `avDeInitialize` + `IOTC_DeInitialize`
  when no sessions remain.

Idempotent — safe to call twice.

### Thread model — current vs target

**Current:** the receive pump is a 50Hz `setInterval` on the main
event loop. `avRecvIOCtrl` is called with a 1ms timeout so it's
effectively non-blocking. Fine for control-plane traffic (a handful
of messages per second). **Not suitable for video streaming** — the
~20ms wakeup interval would drop frames.

**Target (Phase 1.5):** move the receive pump into a `Worker` thread
that calls `avRecvIOCtrl` with a longer timeout (blocking), and
posts decoded frames back to the main thread via `MessageChannel`.
This frees the main loop entirely. TODO marker is in `session.js`.

## Tests

Two test files run on every host (macOS/Windows/Linux) via the stub
SDK pattern — no `.so` required:

- `test/loader.test.js` — loader refusal modes + platform detection
- `test/session.test.js` — full auth flow, send/receive matching,
  timeouts, lifecycle. Uses an in-memory stub that mimics the koffi
  bindings.

For real-hardware validation (Linux only, requires the `.so` fetched
and a real Wyze camera UID/enr): see the Phase 1.5 smoke test (TODO,
not yet committed).

## How this fits the bigger picture

```
                        ┌──────────────────┐
   bridge config       │  WyzeSmartHome    │
   advanced.tutk = on  │  (homebridge)     │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ future/tutk/     │  ← you are here
                        │  session.js      │
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ future/tutk/     │
                        │  loader.js       │  (koffi bindings)
                        └────────┬─────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ libIOTCAPIs_ALL  │  (downloaded by
                        │      .so         │   scripts/fetch-wyze-sdk.js)
                        └──────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  Wyze Cam        │  (V2/V3/V4/Pan/Outdoor/
                        │  (LAN UDP)       │   DB/OG/Vacuum)
                        └──────────────────┘
```

Not yet wired into the bridge — `WyzeSmartHome` still routes camera
commands through Wyze's cloud HTTP API. The next step (Phase 2.5 in
the roadmap) is to add a "use local if Tutk is up, else cloud" routing
layer in the bridge's accessory helpers.
