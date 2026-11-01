# CLAUDE.md

Unofficial API wrapper for Wyze products.

## Scripts

- `npm test`: runs `node --test` on `tests/*.test.js`, including the 1.x compatibility test. No arguments.
- `npm run test:future`: runs the tests of the parked code in `future/` (`future/*/test/*.test.js`). No arguments.
- `npm run fetch-wyze-sdk`: downloads the native libraries the parked local-protocol code needs. Uses the network. Run `node scripts/fetch-wyze-sdk.js --help` for its options.
- `npm run tutk-smoke`, `npm run tutk-smoke-real`: Docker smoke tests for the parked TUTK code (`future/tutk/docker/`). They build an image; the second needs a real camera and credentials in `future/tutk/docker/.env`.

## Layout

- `src/` is the published library. `future/` is parked work: tracked, not published, not loaded by `src/`.
- 2.x must stay a drop-in replacement for 1.1.15. Read `docs/downstream.md` before removing, renaming or reordering anything public.
