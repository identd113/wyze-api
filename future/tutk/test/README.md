# future/tutk/test

Run from the repo root:

```
npm run test:future
```

`npm test` does not run these. None of them need a camera, a network or the native library.

| File | What it checks |
|---|---|
| `fixtures.test.js` | The protocol layer in [`../lib/`](../lib/) (codec, XXTEA, auth, messages) against values taken from docker-wyze-bridge's Python code. |
| `loader.test.js` | The loader's refusal modes and platform detection. The one real-library case is skipped off Linux. |
| `session.test.js` | The whole session flow (auth, send and receive matching) against a stub that mimics the `koffi` binding. |

The checks against the real library, and against a real camera, are in [`../docker/`](../docker/) and need Docker.
