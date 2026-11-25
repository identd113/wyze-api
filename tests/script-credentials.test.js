"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { loadCredentials } = require("../scripts/lib/credentials");

function envFile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wyze-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, text);
  return file;
}

test("the scripts read WYZE_USERNAME and friends from the environment", () => {
  const found = loadCredentials({
    env: { WYZE_USERNAME: "a@b", WYZE_PASSWORD: "p", WYZE_KEY_ID: "k", WYZE_API_KEY: "x" },
    envPath: "/nonexistent/.env",
  });
  assert.deepStrictEqual([found.username, found.password, found.keyId, found.apiKey], ["a@b", "p", "k", "x"]);
  assert.deepStrictEqual(found.missing, []);
});

test("the operating system's USERNAME and PASSWORD are never taken for the Wyze login (Windows sets USERNAME)", () => {
  const found = loadCredentials({
    env: { USERNAME: "SYSTEM-USER", PASSWORD: "not-a-wyze-password", KEY_ID: "k", API_KEY: "x" },
    envPath: "/nonexistent/.env",
  });
  assert.strictEqual(found.username, undefined);
  assert.strictEqual(found.password, undefined);
  assert.deepStrictEqual(found.missing, ["WYZE_USERNAME", "WYZE_PASSWORD", "WYZE_KEY_ID", "WYZE_API_KEY"]);
});

test("an environment value wins over the .env file", () => {
  const envPath = envFile("WYZE_USERNAME=from-file\nWYZE_PASSWORD=p\nWYZE_KEY_ID=k\nWYZE_API_KEY=x\n");
  assert.strictEqual(loadCredentials({ env: { WYZE_USERNAME: "from-env" }, envPath }).username, "from-env");
  assert.strictEqual(loadCredentials({ env: {}, envPath }).username, "from-file");
});

test("a .env file written for the old names still works, and says what to rename", () => {
  const envPath = envFile("USERNAME=old@b\nPASSWORD=p\nKEY_ID=k\nAPI_KEY=x\n");
  const found = loadCredentials({ env: {}, envPath });
  assert.strictEqual(found.username, "old@b");
  assert.deepStrictEqual(found.missing, []);
  assert.deepStrictEqual(found.renamed, [
    "USERNAME -> WYZE_USERNAME", "PASSWORD -> WYZE_PASSWORD", "KEY_ID -> WYZE_KEY_ID", "API_KEY -> WYZE_API_KEY",
  ]);
});

// The same class of mistake anywhere in the repository: code or documentation that tells people to put a bare
// USERNAME, PASSWORD, KEY_ID or API_KEY in the environment.
test("nothing in the repository reads or documents the unprefixed login variables", () => {
  const root = path.join(__dirname, "..");
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const bare = /(^|[^A-Z_])(USERNAME|PASSWORD|KEY_ID|API_KEY)([^A-Z_]|$)/;
  const allowed = new Set([
    "scripts/lib/credentials.js", // the legacy names it still reads from a .env file
    "tests/script-credentials.test.js",
    "package-lock.json",
  ]);
  const offenders = [];
  for (const file of tracked) {
    if (allowed.has(file) || file.startsWith("future/tutk/docker/") || !/\.(js|md|sample|example|json|yml)$/.test(file) && !/\.env/.test(file)) continue;
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
    lines.forEach((line, i) => { if (bare.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`); });
  }
  assert.deepStrictEqual(offenders, []);
});
