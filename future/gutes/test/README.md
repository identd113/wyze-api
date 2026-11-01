# future/gutes/test

`fixtures.test.js` checks the protocol layer in [`../lib/`](../lib/) against fixture values taken from the
Python reference, [cryze](https://github.com/carTloyal123/cryze) (`src/relay/rc5.py`, `gutes_frame.py`): the RC5
cipher, ID encryption, per-frame key derivation, and the session-key hash.

Run it from the repo root:

```
npm run test:future
```

`npm test` does not run it. It needs no device, network or native library.

It checks the protocol layer only. Nothing here covers a live session or video, because neither exists yet
(see [`../README.md`](../README.md)).
