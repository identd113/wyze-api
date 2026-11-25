"use strict";

const net = require("net");

/**
 * True for an address on the local network: loopback, the private IPv4 ranges, link-local, and the IPv6 unique-local and
 * link-local ranges. An IPv4 address on a dual-stack socket (`::ffff:a.b.c.d`) is read as IPv4.
 */
function isPrivateAddress(address) {
  let a = String(address || "");
  if (a.startsWith("::ffff:")) a = a.slice(7); // an IPv4 client on a dual-stack socket
  if (net.isIPv4(a)) {
    const [p, q] = a.split(".").map(Number);
    return p === 127 || p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254);
  }
  if (net.isIPv6(a)) {
    const lower = a.toLowerCase();
    return lower === "::1" || /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower);
  }
  return false;
}

/**
 * True for a URL it is safe to download a picture from: https, with a host name or a public address (not localhost, not
 * a private or link-local address, not a name with no dot such as an internal host). The URL comes from Wyze's cloud, and
 * the thumbnail host is not a Wyze host, so it is checked rather than trusted.
 */
function isSafeThumbnailUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (_) {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (net.isIP(host)) return !isPrivateAddress(host);
  return host.includes(".");
}

module.exports = { isPrivateAddress, isSafeThumbnailUrl };
