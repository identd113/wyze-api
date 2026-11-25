"use strict";

/**
 * HTTP 429 handling for every request bound for a Wyze host.
 *
 * When Wyze answers 429 (or 503 with a Retry-After) the request is held for as long as the answer says, then sent
 * again, up to MAX_RETRIES times. The wait comes from, in this order:
 *   1. `Retry-After`: a number of seconds, or an HTTP date;
 *   2. `X-RateLimit-Reset`: a number under 1e9 is seconds from now, a larger one a Unix time in seconds or
 *      milliseconds, else a date; `X-RateLimit-Reset-By` is read the same way;
 *   3. a short wait that doubles on each retry, when the answer says nothing.
 * A wait longer than MAX_WAIT_MS is not served: the error is thrown at once, with `retryAfterMs` on it, so the caller
 * decides. Nobody has measured whether Wyze limits per account, per endpoint or per host, so while one request waits
 * every other request to the same host waits too (a shared gate), and the headers of every answer are remembered per
 * host and path (`getRateLimitObservations()`), which is what shows which of the three it is.
 *
 * A request that carries a timestamp, a nonce or a signature made before the wait would be stale when it is sent again
 * (the wait can be two minutes). Such a request is built with `rebuildable(build)`: after the wait the retry calls
 * `build()` again, so the timestamp, nonce, signature and token are fresh.
 */

const EventEmitter = require("events");

const MAX_RETRIES = 2;
const MAX_WAIT_MS = 120_000;
const FALLBACK_WAIT_MS = 5_000;

const events = new EventEmitter();
const gates = new Map(); // host -> Unix ms until which requests to it are held
const observations = new Map(); // "host path" -> the last rate-limit headers seen, with the time
const HISTORY_PER_KEY = 100;
const history = new Map(); // "host path" -> the last HISTORY_PER_KEY answers that had rate-limit headers, oldest first
const counts = new Map(); // "host path" -> how many answers were seen, with or without rate-limit headers

/** A Unix time that may be in seconds, in milliseconds or a date text, as a Unix time in ms (or null). */
function toUnixMs(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    return n >= 1e12 ? n : n * 1000;
  }
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : t;
}

/** How long Wyze says to wait, in ms, from the response headers; null when they say nothing usable. */
function waitFromHeaders(headers = {}, now = Date.now()) {
  const get = (name) => headers[name] ?? headers[name.toLowerCase()];
  const retryAfter = get("retry-after");
  if (retryAfter !== undefined && retryAfter !== "") {
    const text = String(retryAfter).trim();
    if (/^\d+(\.\d+)?$/.test(text)) return Math.max(0, Math.ceil(Number(text) * 1000));
    const at = Date.parse(text);
    if (!Number.isNaN(at)) return Math.max(0, at - now);
  }
  for (const name of ["x-ratelimit-reset", "x-ratelimit-reset-by"]) {
    const raw = get(name);
    // A small number (before the year 2001 as a Unix time) is seconds from now, as in the IETF RateLimit-Reset
    // header; a larger one is a Unix time in seconds or milliseconds.
    if (raw !== undefined && /^\s*\d+(\.\d+)?\s*$/.test(String(raw)) && Number(raw) < 1e9) {
      return Math.max(0, Math.ceil(Number(raw) * 1000));
    }
    const at = toUnixMs(raw);
    if (at !== null) return Math.max(0, at - now);
  }
  return null;
}

/** Holds every request to `host` for `ms` (the shared gate), as a 429 wait does. */
function holdHost(host, ms, now = Date.now()) {
  if (host && ms > 0) gates.set(host, Math.max(gates.get(host) || 0, now + ms));
}

function hostAndPath(config) {
  try {
    const full = config.baseURL ? new URL(config.url, config.baseURL) : new URL(config.url);
    return { host: full.hostname, path: full.pathname };
  } catch (_) {
    return null;
  }
}

/** Remembers the rate-limit headers of an answer. Returns nothing. */
function observe(config, headers, status, now = Date.now()) {
  const where = hostAndPath(config);
  if (!where || !headers) return;
  const key = `${where.host} ${where.path}`;
  counts.set(key, (counts.get(key) || 0) + 1);
  const get = (name) => headers[name];
  const seen = {
    limit: get("x-ratelimit-limit"),
    remaining: get("x-ratelimit-remaining"),
    reset: get("x-ratelimit-reset") ?? get("x-ratelimit-reset-by"),
    retryAfter: get("retry-after"),
  };
  if (Object.values(seen).every((v) => v === undefined)) return;
  const entry = { ...seen, status, at: now };
  observations.set(key, entry);
  const list = history.get(key) || [];
  list.push(entry);
  if (list.length > HISTORY_PER_KEY) list.shift();
  history.set(key, list);
}

/** What the headers have said, per "host path". Shows whether the limit is shared or per endpoint. */
function getRateLimitObservations() {
  return Object.fromEntries(observations);
}

/**
 * Every answer's headers, not only the last: per "host path", `{ answers, history }`, where `answers` counts all
 * answers seen (with or without rate-limit headers) and `history` holds the last 100 that had them, oldest first.
 * Comparing `answers` with how far `remaining` fell, and `remaining` across paths, shows whether Wyze counts per
 * account, host or endpoint. Held in memory only, and never holds a device id (the path is the endpoint's).
 */
function getRateLimitHistory() {
  return Object.fromEntries([...counts.keys()].map((key) => [key, { answers: counts.get(key), history: [...(history.get(key) || [])] }]));
}

/**
 * A request config that can be made again. `build()` returns what changes between attempts (`data`, `headers`, `params`,
 * `url`): the timestamp, the nonce, the signature, the token. The first attempt uses it, and so does each retry after a
 * rate-limit wait. Extra config (a timeout, a response type) is passed as the second argument.
 */
function rebuildable(build, extra = {}) {
  return { ...extra, ...build(), __wyzeRebuild: build };
}

/** The headers of an axios config as a plain object (they may be an AxiosHeaders instance). */
function plainHeaders(headers) {
  return headers && typeof headers.toJSON === "function" ? headers.toJSON() : { ...(headers || {}) };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The three handlers, with the clock, the sleep and the request function passed in so a test can drive them.
 * `isWyzeHost(hostname)` limits everything to Wyze's own hosts.
 */
function createRateLimitHandlers({ isWyzeHost, send, sleep = defaultSleep, now = Date.now }) {
  const hostOf = (config) => {
    const where = hostAndPath(config || {});
    return where && isWyzeHost(where.host) ? where.host : null;
  };

  async function beforeRequest(config) {
    const host = hostOf(config);
    if (!host) return config;
    const until = gates.get(host) || 0;
    const wait = until - now();
    if (wait > 0) await sleep(wait);
    return config;
  }

  function onResponse(response) {
    if (hostOf(response.config)) observe(response.config, response.headers, response.status, now());
    return response;
  }

  async function onError(error) {
    const res = error && error.response;
    const config = error && error.config;
    const host = res && config ? hostOf(config) : null;
    if (!host) throw error;
    observe(config, res.headers, res.status, now());

    const retryable = res.status === 429 || (res.status === 503 && waitFromHeaders(res.headers, now()) !== null);
    if (!retryable) throw error;

    const attempt = config.__wyzeRateRetries || 0;
    const said = waitFromHeaders(res.headers, now());
    const wait = said !== null ? said : Math.min(FALLBACK_WAIT_MS * 2 ** attempt, MAX_WAIT_MS);
    const info = { host, path: hostAndPath(config).path, status: res.status, waitMs: wait, attempt: attempt + 1, said: said !== null };

    if (wait > MAX_WAIT_MS || attempt >= MAX_RETRIES) {
      error.retryAfterMs = wait;
      events.emit("giveup", info);
      throw error;
    }

    holdHost(host, wait, now());
    events.emit("wait", info);
    await sleep(wait);
    config.__wyzeRateRetries = attempt + 1;
    if (typeof config.__wyzeRebuild === "function") {
      const fresh = await config.__wyzeRebuild();
      Object.assign(config, fresh, { headers: { ...plainHeaders(config.headers), ...plainHeaders(fresh.headers) } });
    }
    return send(config);
  }

  return { beforeRequest, onResponse, onError };
}

let installed = false;

/** Installs the handlers on axios once. Safe to call from every WyzeAPI instance. */
function installRateLimitRetry(axios, isWyzeHost) {
  if (installed) return;
  installed = true;
  const handlers = createRateLimitHandlers({ isWyzeHost, send: (config) => axios.request(config) });
  axios.interceptors.request.use(handlers.beforeRequest);
  axios.interceptors.response.use(handlers.onResponse, handlers.onError);
}

/** Calls `fn(info)` when a request is held for a rate limit ("wait") or given up on ("giveup"). Returns a function that stops it. */
function onRateLimit(fn) {
  const wait = (info) => fn({ ...info, kind: "wait" });
  const giveup = (info) => fn({ ...info, kind: "giveup" });
  events.on("wait", wait);
  events.on("giveup", giveup);
  return () => { events.off("wait", wait); events.off("giveup", giveup); };
}

module.exports = {
  MAX_RETRIES, MAX_WAIT_MS, FALLBACK_WAIT_MS,
  toUnixMs, waitFromHeaders, holdHost, observe, getRateLimitObservations, getRateLimitHistory, HISTORY_PER_KEY,
  createRateLimitHandlers, installRateLimitRetry, onRateLimit, rebuildable,
  _gates: gates,
};
