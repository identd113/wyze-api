# future/gutes

Pure-JavaScript port of the **GUTES** P2P signaling protocol used by
Wyze Gwell-based devices (Doorbell Pro, Doorbell Pro 2, certain other
Gwell cameras).

> **Parked, and not part of the published package.** Moved out of `src/` on 2026-11-01. Nothing in
> `wyze-api` or the Homebridge plugin loads it. See [`../README.md`](../README.md) for what `future/` means.

## Where this stands

- **What it is for:** local, cloud-free video from the Doorbell Pro (`GW_BE1`) and Doorbell Pro 2
  (`AN_RDB1`). Both already work through Wyze's cloud (WebRTC); this would be the LAN route.
- **How far:** protocol layer only (Phase 0). It has never connected to a device.
- **Is it better than what we have:** no. The cloud path works today. The gap on these doorbells is the ring
  notification, and that comes from the cloud event list, not from this.
- **Worth continuing:** not now. The blocker is Wyze's own native library, taken from the Android app, which
  needs a shim to run on Node (see "Why this is parked" below), and nobody on the project owns a Pro or Pro 2 to
  test with.
- **Pick it up again when:** a Pro or Pro 2 is on hand, and a reason to want local video (latency, no cloud) is
  stronger than the cost of the shim and the question of redistributing a binary taken from the app.

## Status

- **Phase 0 — protocol primitives — DONE.** RC5, frame parser, session
  crypto, KEEPALIVE builders, pcap reader. Byte-exact against the
  Python reference in [cryze](https://github.com/carTloyal123/cryze).
- **Phase 1 — `.so` loading + live session — NOT STARTED.** Requires a
  Bionic shim because `libiotp2pav.so` is extracted from the Wyze
  Android APK and depends on Android's libc layout.
- **Phase 2 — A/V transport — NOT STARTED.** MTP_DATA reassembly into
  H.264 NALUs needs the `.so` unwrap functions.

The Tutk path (`src/tutk/`) is further along and covers every camera
the user owns except the Doorbell Pro family. GUTES is only relevant
for those Gwell devices.

## Files

```
future/gutes/
├── lib/
│   ├── constants.js         Frame type codes, header size, protocol bytes
│   ├── rc5.js               RC5 cipher (8-byte + 16-byte block) + ID encrypt/decrypt
│   ├── frame.js             Header parser, stream parser, GutesFrame object
│   ├── session-crypto.js    Session-key derivation, sqnum extraction, hash
│   └── builders.js          KEEPALIVE / KEEPALIVE_ACK builders + primitives
├── demo/                    spike.js (round trip), parse-pcap.js (decode a capture)
├── test/                    fixture tests, pinned to the Python reference
└── README.md                you are here
```

## What works (Phase 0)

- RC5 cipher (both block sizes, key expansion + en/decrypt)
- Frame header parser (28-byte header + opt_flags bitfield decode)
- ID encryption / decryption with XOR-sqnum/chkval mixing
- Per-frame key derivation
- Payload decryption for `opt_encrypt = 0` (plaintext) and `=1` (per-frame key)
- Session-encrypted payload decryption when a session key is supplied
- Stream-mode parser (handles garbage prefix bytes, partial frames)
- KEEPALIVE + KEEPALIVE_ACK construction
- Frame checksum (`computeChkval`) matching `iv_gute_frm_init_chkval`
- Session-key derivation from CERTIFY_REQ given a mars access token
- pcap reader for offline traffic analysis (Ethernet, raw IP, Linux SLL)

## What's NOT done (Phase 1+)

- Loading `libiotp2pav.so` via `koffi` (needs Bionic shim — Phase 1)
- Live session establishment against a real doorbell (needs Phase 1)
- A/V transport (MTP_DATA reassembly into H.264 NALUs — needs the
  `.so` for the unwrap step, same wall cryze hit)
- `DETECT_RESP` / `CERTIFY_RESP` / `CALLING_ACK` builders (~500 LoC
  port from cryze's `frame_builder.py`; not needed for client-side)

## Why this is parked at Phase 0

The Tutk SDK ships an ordinary glibc binary in docker-wyze-bridge.
GUTES's `.so` is yanked out of the Wyze Android APK and is linked
against Bionic (Android's libc). Loading it in Node-on-Linux requires
a shim that resolves Bionic-specific symbols (`__system_property_get`,
`__strchr_chk`, the pthread layout, etc.) to glibc equivalents. cryze
solved this by linking against `androdyne` — porting that to a koffi
loader is the wall. Phase 0 here is the foundation; the wall is the
shim, not the JS protocol code.

## Tests

[`test/fixtures.test.js`](test/) covers the protocol layer with fixture vectors pinned against cryze's Python
reference. Run it with `npm run test:future` from the repo root. It is not part of `npm test`.
