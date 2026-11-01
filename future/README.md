# future/

Work that is not part of `wyze-api` yet and may never be. It is tracked in git so it is not lost, but:

- it is **not published**: `package.json`'s `files` list leaves this folder out of the npm package;
- nothing in `src/` loads it;
- `npm test` does not run it. `npm run test:future` does.

Each folder has its own README saying what it is, how far it got, and what would have to change to bring it into
`src/`.

| Folder | What | Status |
|---|---|---|
| [`gutes/`](gutes/) | Protocol layer for the GUTES P2P protocol (Doorbell Pro, Doorbell Pro 2) | Phase 0 of 3, parked |
