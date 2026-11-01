# Releasing wyze-api

How a release gets to npm, and the order to do things in. The plugin ([homebridge-wyze-smart-home](https://github.com/identd113/homebridge-wyze-smart-home)) depends on this package, so **`wyze-api` always goes first**.

## How publishing works

- A release is made on GitHub (a **GitHub Release** on the `2.x` branch). Publishing the release starts a workflow:
  - **Pre-release ticked** → `npm-publish-beta.yml`, which publishes to the npm `beta` tag. The version in `package.json` must contain `-beta.` (or `-alpha.` / `-rc.`) and must not already be on npm.
  - **Pre-release not ticked** → `npm-publish-stable.yml`, which publishes to `latest`.
  - Either workflow can also be started by hand (`workflow_dispatch`), for example to retry.
- Publishing is **staged**. The workflow runs `npm stage publish` with a stage-only token, so nothing goes live until you approve it on npmjs.com (with 2FA) or with `npm stage approve <id>`.
- Until 2.0 is stable, `latest` stays on 1.x (`1.1.15` at the time of writing), so a plain `npm install wyze-api` does not move anyone to 2.x.

## Before the release

1. `npm test` and `npm run lint` pass. That includes the 1.x compatibility test (`tests/compat-1x.test.js`). If it fails because of a difference you meant, record it as described in [downstream.md](downstream.md).
2. `npm audit --omit=dev` is clean, or you know why not.
3. Bump `version` in `package.json`, and give the new section of `CHANGELOG.md` its version heading.
4. Add release notes under `docs/releases/` if the release needs them: what changed, what was checked on real hardware, what is unfinished. Say which plugin version it pairs with.
5. Run the plugin's tests against this build (`npm run dev-link` in the plugin).

## Releasing

1. Push `2.x`.
2. Make the GitHub Release (`v<version>`, target `2.x`, pre-release ticked for a beta).
3. Approve the staged publish on npmjs.com.
4. Check the tags: `npm view wyze-api dist-tags`. For a beta, `beta` points at the new version and `latest` is unchanged.

Then release the plugin (see its `docs/releasing.md`). Its workflow refuses to publish until a `wyze-api` that satisfies its declared range is on npm.

## After

- Install both from the registry into a scratch Homebridge, start it, and check the log for errors.
- Let a beta soak for a while with no new bugs before cutting a stable 2.0.0.
- Not yet done for any release so far: a stable `latest` release. When it happens, the stable workflow is the one that moves `latest`, and every project pinned to 1.x is the audience for it (see [downstream.md](downstream.md)).
