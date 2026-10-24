// Live proof that src/httpsAgent.js's pinned CA bundle fixes
// UNABLE_TO_GET_ISSUER_CERT_LOCALLY against the real Wyze hosts.
//
// Node's CA trust store is baked in per-build, so this can't be proven by
// running on "the current node" — it depends on which Node build you run it
// with:
//
//   - Official nodejs.org builds >=24.18.0 statically bundle their own CA
//     list, which dropped the classic "DigiCert Global Root CA". THIS is the
//     build that reproduces the bug.
//   - Homebrew's `node` formula dynamically links Homebrew's shared OpenSSL
//     (check `otool -L $(brew --prefix node)/bin/node | grep ssl`), which
//     falls back to the system cert store and will NOT reproduce the bug
//     regardless of Node version — it's a false negative for this test.
//   - Older Node builds (<24.18.0) still have the classic root bundled, so
//     the "default agent" run below will pass there too — that's expected,
//     not a sign the fix is unnecessary.
//
// Usage:
//   node scripts/verify-tls-pin.js                    # whatever `node` resolves to
//   /path/to/node-v24.18.0/bin/node scripts/verify-tls-pin.js   # the real test

const https = require("https");
const httpsAgent = require("../src/httpsAgent");

// yd-saas-toc.wyzecam.com and api.wyzecam.com chain through the classic
// "DigiCert Global Root CA" (no G-suffix) - these are the hosts that
// actually exercise the bug. auth-prod.api.wyze.com chains through G2
// (still bundled by Node) so it passes either way; kept as a control.
const hosts = [
  "https://api.wyzecam.com",
  "https://yd-saas-toc.wyzecam.com",
  "https://auth-prod.api.wyze.com",
];

function probe(url, agent) {
  return new Promise((resolve) => {
    const req = https.get(url, agent ? { agent } : {}, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode });
    });
    req.on("error", (err) => resolve({ ok: false, code: err.code || err.message }));
  });
}

(async () => {
  console.log(`node ${process.version}\n`);

  console.log("--- default agent (no pin) ---");
  const defaultResults = [];
  for (const h of hosts) {
    const r = await probe(h, null);
    defaultResults.push(r);
    console.log(`${h} -> ${r.ok ? `OK (HTTP ${r.status})` : `FAIL (${r.code})`}`);
  }

  console.log("\n--- pinned httpsAgent ---");
  let pinnedAllOk = true;
  for (const h of hosts) {
    const r = await probe(h, httpsAgent);
    pinnedAllOk = pinnedAllOk && r.ok;
    console.log(`${h} -> ${r.ok ? `OK (HTTP ${r.status})` : `FAIL (${r.code})`}`);
  }

  const defaultFailed = defaultResults.some((r) => !r.ok);
  console.log("\n=== summary ===");
  if (!pinnedAllOk) {
    console.log("FAIL - pinned agent could not reach one or more Wyze hosts.");
    process.exit(1);
  }
  if (defaultFailed) {
    console.log("Reproduced the bug on this Node build AND confirmed the pin fixes it. Strongest possible result.");
  } else {
    console.log(
      "This Node build didn't reproduce the bug (older Node, or a build using the system cert store " +
      "like Homebrew's), so this run doesn't prove much either way. Rerun with an official " +
      "nodejs.org build >=24.18.0 to actually exercise the fix."
    );
  }
})();
