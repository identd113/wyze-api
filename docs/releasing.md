# Releasing wyze-api

How a release gets to npm, and the order to do things in. The plugin ([homebridge-wyze-smart-home](https://github.com/wyze-smart-home/homebridge-wyze-smart-home)) depends on this package, so **`wyze-api` always goes first**.

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

1. Make sure `release/<version>` is level with the commit you mean to ship, and pushed (`git branch -f release/<version> 2.x`, then `git push origin release/<version>`). Push `2.x` too, so the two match.
2. Make the GitHub Release (`v<version>`, **target `release/<version>`, not `2.x`**, pre-release ticked for a beta). The tag then sits on the release branch, so a later commit on `2.x` cannot slip into it.
3. Approve the staged publish on npmjs.com.
4. Check the tags: `npm view wyze-api dist-tags`. For a beta, `beta` points at the new version and `latest` is unchanged.

Then release the plugin (see its `docs/releasing.md`). Its workflow refuses to publish until a `wyze-api` that satisfies its declared range is on npm.

## Getting the release into the upstream repository

`2.x` lives in our fork; the `wyze-smart-home` organization's repository is upstream (its default branch is `main`, and `2.0.0` is the branch ours came from). To bring a release over:

1. Cut `release/<version>` from `2.x`, as above, and open the pull request from that branch to upstream `2.0.0`.
2. Merge it with a **merge commit** (or fast-forward), never a squash or rebase. Those rewrite the commits, so the tags would point at commits that are not in upstream's history and the two repositories' histories would diverge.
3. Bring `2.x` back level: `git fetch upstream`, then `git merge --ff-only upstream/2.0.0` on `2.x`.

**Tags.** Pushing a branch or merging a pull request never deletes or moves a tag, and never copies one. Tags travel only when you push or fetch them:
- Our release tags (for example `v2.0.0-beta.3`) are on our fork only. Push one to upstream with `git push upstream <tag>` (after the merge, so its commit is in upstream's history).
- Upstream's tags (for example `v2.0.0-beta.1`, `v2.0.0-beta.2`, and the 1.x ones) are missing from our fork. Bring them over with `git fetch upstream --tags`, then `git push origin --tags` for the ones you want.
- Only deliberate commands delete tags: `git push --mirror`, `git push --delete <tag>`, `git fetch --prune-tags`. Do not use them on the release tags.
- The GitHub Release creates its tag on the branch it targets (`release/<version>`), so do it after the release branch exists.

## After

- Install both from the registry into a scratch Homebridge, start it, and check the log for errors.
- Let a beta soak for a while with no new bugs before cutting a stable 2.0.0.
- Not yet done for any release so far: a stable `latest` release. When it happens, the stable workflow is the one that moves `latest`, and every project pinned to 1.x is the audience for it (see [downstream.md](downstream.md)).

## Making `2.0.0` the default branch (once the pull requests are merged)

Until this is done, upstream's default branch is `main` (the old line). Issue forms, the issue-triggered workflows and the "Report" links all read the default branch, so they do not see our versions yet. Do these in order, in both repositories (`wyze-api` first).

1. **Settings.** Set the default branch to `2.0.0`. In the plugin repository also: Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests" (the verify-device workflow opens pull requests), and check the `NPM_TOKEN` secret exists in both.
2. **Labels (plugin repository).** The issue workflows use these labels; create the ones upstream lacks: `from:wyze-api`, `from:readme`, `verified`, `report:works`, `report:partial`, `kind:camera`, `kind:light`, `kind:other`, `needs-info`, `needs-redaction`, `credentials-exposed`, `already-supported`, `new device`, `not-applicable`.
3. **Links and metadata.** Change `identd113/...` to `wyze-smart-home/...` in: `package.json` (`homepage`, `repository`, `bugs`), the README (badges, clone URL, the device "report" links), `.github/ISSUE_TEMPLATE/*`, `config.schema.json` (footer), `src/WyzeSmartHome.js` and `src/plannedDevices.js` (form URLs), `wiki/` (`Local-Protocol.md` links to `blob/2.x`; `Browser-Viewer-Example.md` clone URL), `docs/downstream.md` and this file. Keep the copyright line, the credits and history entries that name the fork. Decide who the `assignees` are (the four issue forms and `.github/scripts/maintainers.js` name `identd113`).
4. **Workflows.** `ci.yml` and `wiki-sync.yml` already run on `2.0.0`. CodeQL, dependency-review and njsscan are tied to `main`: point them at `2.0.0`. The plugin's `.github/dependabot.yml` still has an empty `package-ecosystem`, so Dependabot does nothing; fill it in or delete it. Change the README CI badge from `branch=2.x` to `branch=2.0.0`.
5. **Wording.** Where these docs say `2.x` is "the default branch" or that a release is made "on the `2.x` branch", `2.0.0` takes that place and `2.x` is only our fork's working branch (`releasing.md`, `docs/downstream.md`, `docs/branch-archive.md`).
6. **Check it works.** Open the new-device form from a README "report" link and from the camera test page; confirm the form opens with the fields filled. Open a throwaway issue and check the triage and label workflows ran. Run "Sync wiki" once and check the wiki shows the new pages (`wyze-api` only).
