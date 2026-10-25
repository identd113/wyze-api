/**
 * Structural test for the pinned-CA https.Agent (src/httpsAgent.js).
 *
 * This does NOT prove the fix works on an affected Node build — Node's
 * bundled CA store is static per-build, so that has to be proven live,
 * per-Node-version, against the real Wyze hosts (see scripts/verify-tls-pin.js).
 * This test only guards against regressions: agent misconfigured, pinned
 * certs missing/corrupt/expired, or tls.rootCertificates silently dropped.
 */
const test = require("node:test");
const assert = require("node:assert");
const https = require("https");
const { X509Certificate } = require("crypto");
const tls = require("tls");

const httpsAgent = require("../src/httpsAgent");

test("httpsAgent is an https.Agent with a CA bundle", () => {
  assert.ok(httpsAgent instanceof https.Agent);
  assert.ok(Array.isArray(httpsAgent.options.ca));
});

test("CA bundle includes Node's default trust store (not a replacement)", () => {
  assert.strictEqual(
    httpsAgent.options.ca.length,
    tls.rootCertificates.length + 2,
    "custom `ca` replaces rather than appends to Node's defaults"
  );
});

test("CA bundle pins DigiCert Global Root CA and G2", () => {
  const pinned = httpsAgent.options.ca.slice(-2).map((pem) => new X509Certificate(pem));

  const subjects = pinned.map((c) => c.subject);
  assert.ok(subjects.some((s) => s.includes("CN=DigiCert Global Root CA")));
  assert.ok(subjects.some((s) => s.includes("CN=DigiCert Global Root G2")));

  for (const cert of pinned) {
    assert.ok(new Date(cert.validTo) > new Date(), `${cert.subject} has expired`);
  }
});
