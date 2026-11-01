/**
 * The agent instruction files (CLAUDE.md, AGENTS.md and the .claude/ folder) stay on the developer's machine.
 * This repository is public. These tests fail if one is ever committed again, and if the ignore rules that keep
 * `git add -A` from picking them up are removed.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const PRIVATE = [/(^|\/)CLAUDE\.md$/i, /(^|\/)AGENTS\.md$/i, /(^|\/)\.claude(\/|$)/];

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  } catch (_) {
    return null; // not a git checkout (for example, an unpacked npm package)
  }
}

test("no agent instruction file is tracked by git", (t) => {
  const files = trackedFiles();
  if (!files) return t.skip("not a git checkout");
  assert.deepStrictEqual(files.filter((file) => PRIVATE.some((pattern) => pattern.test(file))), []);
});

test(".gitignore keeps the agent instruction files out", () => {
  const lines = fs.readFileSync(path.join(root, ".gitignore"), "utf8").split("\n").map((line) => line.trim());
  for (const wanted of [["CLAUDE.md"], ["AGENTS.md"], [".claude/", "/.claude"]]) {
    assert.ok(wanted.some((line) => lines.includes(line)), `.gitignore must list ${wanted[0]}`);
  }
});
