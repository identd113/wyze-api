"use strict";

// Login for the scripts: WYZE_USERNAME, WYZE_PASSWORD, WYZE_KEY_ID and WYZE_API_KEY, from the environment or from
// the .env file at the root of the package. The names carry a prefix because a bare USERNAME is the operating
// system's login on Windows, and the .env file never overrides a variable that is already set, so the account
// would silently be the wrong one.
//
// A .env file written for the old names (USERNAME, PASSWORD, KEY_ID, API_KEY) still works: those four are read from
// the file only, never from the environment, and a warning says which to rename.

const fs = require("fs");
const path = require("path");

const NAMES = [
  ["username", "WYZE_USERNAME", "USERNAME"],
  ["password", "WYZE_PASSWORD", "PASSWORD"],
  ["keyId", "WYZE_KEY_ID", "KEY_ID"],
  ["apiKey", "WYZE_API_KEY", "API_KEY"],
];

function readEnvFile(envPath) {
  const values = {};
  if (!fs.existsSync(envPath)) return values;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/**
 * Returns { username, password, keyId, apiKey, missing: [WYZE_ names not found], renamed: [legacy names used] }.
 * `env` and `envPath` are parameters so a test can pass its own.
 */
function loadCredentials({ env = process.env, envPath = path.join(__dirname, "..", "..", ".env") } = {}) {
  const file = readEnvFile(envPath);
  const found = { missing: [], renamed: [] };
  for (const [key, name, legacy] of NAMES) {
    if (env[name]) found[key] = env[name];
    else if (file[name]) found[key] = file[name];
    else if (file[legacy]) {
      found[key] = file[legacy];
      found.renamed.push(`${legacy} -> ${name}`);
    } else found.missing.push(name);
  }
  return found;
}

// For a script: the credentials, or an error and exit when some are missing.
function requireCredentials(options) {
  const found = loadCredentials(options);
  if (found.missing.length) {
    console.error(`Missing required env vars: ${found.missing.join(", ")}`);
    console.error("Set them in the environment or in a .env file at the repo root (see .env.sample).");
    process.exit(1);
  }
  if (found.renamed.length) {
    console.error(`The .env file uses old names. Rename: ${found.renamed.join(", ")}`);
  }
  return found;
}

module.exports = { loadCredentials, requireCredentials, NAMES };
