/**
 * Headless WebRTC frame capture.
 *
 * Negotiates a WebRTC session against a Wyze camera using its Kinesis Video
 * signaling URL, receives the H.264 RTP stream via werift, forwards the
 * packets to a local UDP socket, and pipes that into FFmpeg to extract a
 * single JPEG frame.
 *
 * The ffmpeg binary is provided by the `ffmpeg-static` npm package — no
 * system install needed. Falls back to `ffmpeg` on PATH if ffmpeg-static
 * fails to resolve (e.g., unsupported platform).
 */

const dgram = require("dgram");
const fs = require("fs");
const os = require("os");
const path = require("path");
const nodeCrypto = require("crypto");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { RTCPeerConnection, RTCRtpCodecParameters } = require("werift");

// Pin H.264 baseline 3.1 — Wyze rejects VP8/VP9 and werift's defaults include those.
// Built fresh for every session: werift assigns payload types by mutating these
// objects, so sharing one instance made later sessions get different numbers (a
// video payload type of 98 instead of 96 after a stream with audio), and ffmpeg
// ignores packets whose payload type its SDP doesn't name.
const h264Codecs = () => [
  new RTCRtpCodecParameters({
    mimeType: "video/H264",
    clockRate: 90000,
    rtcpFeedback: [
      { type: "nack" },
      { type: "nack", parameter: "pli" },
      { type: "goog-remb" },
    ],
    parameters:
      "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
  }),
];

// Accept PCMU (G.711 µ-law, PT 0) and Opus — let the camera pick whichever it supports.
const audioCodecs = () => [
  new RTCRtpCodecParameters({ mimeType: "audio/PCMU", clockRate: 8000, channels: 1 }),
  new RTCRtpCodecParameters({
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: "minptime=10;useinbandfec=1",
  }),
];

let _ffmpegBinaryPath = null;
function resolveFfmpegPath() {
  if (_ffmpegBinaryPath) return _ffmpegBinaryPath;
  try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      _ffmpegBinaryPath = ffmpegStatic;
      return _ffmpegBinaryPath;
    }
  } catch (_) { /* fall through */ }
  _ffmpegBinaryPath = "ffmpeg";
  return _ffmpegBinaryPath;
}

// Ports handed out recently. A port is only held by us for the instant we probe
// it; ffmpeg binds it later (a capture waits for the camera's SPS/PPS first, a
// live stream is set up by HomeKit seconds before it starts), so remember what
// we gave out or two requests can be handed the same number.
const _reservedUdpPorts = new Set();
const UDP_PORT_RESERVE_MS = 120_000;

const _bindUdp = (port) => new Promise((resolve) => {
  const sock = dgram.createSocket("udp4");
  sock.once("error", () => { try { sock.close(); } catch (_) {} resolve(null); });
  sock.bind(port, "127.0.0.1", () => resolve(sock));
});
const _closeUdp = (sock) => new Promise((resolve) => sock.close(() => resolve()));

/**
 * Pick a local UDP port for ffmpeg's RTP input. ffmpeg also binds the next port
 * up for RTCP, so both must be free, and neither may belong to another stream.
 */
async function pickFreeUdpPort() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const rtp = await _bindUdp(0);
    if (!rtp) continue;
    const port = rtp.address().port;
    if (port >= 65535) { await _closeUdp(rtp); continue; } // no room for the RTCP port
    const rtcp = _reservedUdpPorts.has(port) || _reservedUdpPorts.has(port + 1) || _reservedUdpPorts.has(port - 1)
      ? null
      : await _bindUdp(port + 1);
    await _closeUdp(rtp);
    if (!rtcp) continue;
    await _closeUdp(rtcp);
    for (const reserved of [port - 1, port, port + 1]) {
      _reservedUdpPorts.add(reserved);
      setTimeout(() => _reservedUdpPorts.delete(reserved), UDP_PORT_RESERVE_MS).unref();
    }
    return port;
  }
  throw new Error("could not find a free local UDP port pair for ffmpeg");
}

// ---- One WebRTC session per camera, closed cleanly ----------------------------
//
// Wyze cameras (the Doorbell v2 at least) serve a single viewer. A session that
// is closed abruptly, or a new one opened while the old is still closing, leaves
// the camera answering nothing. So: at most one session per camera, a new one
// waits until the previous is fully closed, and a live stream is never
// preempted by a snapshot capture.
const _sessions = new Map(); // key → { kind, close(), done, closing }
const SESSION_SETTLE_MS = 750; // let the camera notice the old viewer is gone
const PEER_CLOSE_TIMEOUT_MS = 3000;
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const _peerCloses = new WeakMap(); // peer connection → its close promise

/**
 * Close the peer connection first (DTLS goodbye), wait for it, then signaling.
 * Safe to call more than once: a peer connection is only closed once.
 */
async function _closePeer(pc, ws) {
  try {
    if (pc) {
      if (!_peerCloses.has(pc)) {
        _peerCloses.set(pc, Promise.race([Promise.resolve(pc.close()), _sleep(PEER_CLOSE_TIMEOUT_MS)]));
      }
      await _peerCloses.get(pc);
    }
  } catch (_) { /* already closed */ }
  try { ws?.close(); } catch (_) {}
}

/**
 * A timeout that can be aborted (so a session that is being closed stops waiting
 * at once instead of running out its clock) and cleared. Its promise already has a
 * handler, so a rejection nobody is awaiting is never an unhandled rejection.
 */
function _makeTimeout(ms, message) {
  let timer;
  let reject;
  const promise = new Promise((_, rej) => {
    reject = rej;
    timer = setTimeout(() => rej(new Error(message)), ms);
  });
  promise.catch(() => {});
  return {
    promise,
    abort: (error) => { clearTimeout(timer); reject(error); },
    clear: () => clearTimeout(timer),
  };
}

/**
 * Claim the camera's single session slot. Resolves to `release()`, which the
 * caller must call once its session is completely closed. `close` is how this
 * session is torn down when something else needs the slot.
 */
async function _claimSession(key, kind, close) {
  if (!key) return () => {};
  let waited = false;
  for (;;) {
    const cur = _sessions.get(key);
    if (!cur) break;
    waited = true;
    if (kind === "capture" && cur.kind === "stream" && !cur.closing) {
      throw new Error("camera has a live stream open");
    }
    // A stream replaces whatever is open; a capture waits for another capture.
    if (kind === "stream" && !cur.closing) {
      cur.closing = true;
      Promise.resolve(cur.close()).catch(() => {});
    }
    await cur.done;
  }
  // Record the claim in the same step as finding the slot empty, so waiters woken
  // by the same release can't both take it; the settle delay comes after.
  let release;
  const done = new Promise((r) => { release = r; });
  const entry = { kind, close, done, closing: false };
  _sessions.set(key, entry);
  if (waited) await _sleep(SESSION_SETTLE_MS);
  return () => {
    if (_sessions.get(key) === entry) _sessions.delete(key);
    release();
  };
}

/** Close every open session (used on shutdown). */
async function closeAllSessions() {
  const open = [..._sessions.values()];
  await Promise.all(open.map(async (entry) => {
    entry.closing = true;
    try { await entry.close(); } catch (_) {}
    await Promise.race([entry.done, _sleep(PEER_CLOSE_TIMEOUT_MS + 1000)]);
  }));
}

function writeSdpFile(rtpPort, spropParameterSets = null, payloadType = 96) {
  // sprop-parameter-sets gives FFmpeg the H.264 SPS/PPS up front. Without it,
  // FFmpeg has to wait for in-band parameter sets — and Wyze cameras often
  // only put them in the WebRTC answer SDP, never in RTP. Result: continuous
  // "non-existing PPS 0 referenced / no frame!" decoding errors.
  const fmtp = spropParameterSets
    ? `a=fmtp:${payloadType} packetization-mode=1;sprop-parameter-sets=${spropParameterSets}\n`
    : `a=fmtp:${payloadType} packetization-mode=1\n`;
  const sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=WyzeCapture
c=IN IP4 127.0.0.1
t=0 0
m=video ${rtpPort} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} H264/90000
${fmtp}`;
  const sdpPath = path.join(
    os.tmpdir(),
    `wyze-capture-${process.pid}-${nodeCrypto.randomBytes(4).toString("hex")}.sdp`
  );
  fs.writeFileSync(sdpPath, sdp);
  return sdpPath;
}

/**
 * Pull `sprop-parameter-sets=<base64>,<base64>` out of the H.264 fmtp line
 * in a remote SDP. Returns null if the camera didn't advertise them.
 */
function extractSpropParameterSets(sdp) {
  if (typeof sdp !== "string") return null;
  // Find the H.264 payload type from rtpmap, then look for its fmtp.
  const rtpmapMatch = sdp.match(/a=rtpmap:(\d+)\s+H264\/90000/i);
  if (!rtpmapMatch) return null;
  const pt = rtpmapMatch[1];
  const fmtpRegex = new RegExp(`a=fmtp:${pt}\\s+([^\\r\\n]+)`, "i");
  const fmtpMatch = sdp.match(fmtpRegex);
  if (!fmtpMatch) return null;
  const spropMatch = fmtpMatch[1].match(/sprop-parameter-sets=([^;\s]+)/i);
  return spropMatch ? spropMatch[1] : null;
}

function localIpAddress() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const entry of iface) {
      if (!entry.internal && entry.family === "IPv4") return entry.address;
    }
  }
  return "0.0.0.0";
}

// Audio SDP accepts both PCMU (PT 0) and Opus (PT 111) so FFmpeg handles either codec.
/**
 * The audio codec the camera negotiated, from its SDP answer:
 * `{ payloadType, name, clockRate, channels, fmtp }`, or null. Wyze cameras
 * answer PCMU/8000 under a dynamic payload type (96), not the static 0, so the
 * SDP given to ffmpeg must name the payload type the camera really uses.
 */
function extractAudioCodec(sdp) {
  if (!sdp) return null;
  let inAudio = false;
  let payloadTypes = [];
  const maps = {};
  const fmtps = {};
  for (const raw of String(sdp).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("m=")) {
      inAudio = line.startsWith("m=audio");
      if (inAudio) payloadTypes = line.split(/\s+/).slice(3);
      continue;
    }
    if (!inAudio) continue;
    const map = line.match(/^a=rtpmap:(\d+)\s+([^/\s]+)\/(\d+)(?:\/(\d+))?/);
    if (map) maps[map[1]] = { payloadType: Number(map[1]), name: map[2], clockRate: Number(map[3]), channels: map[4] ? Number(map[4]) : 1 };
    const fmtp = line.match(/^a=fmtp:(\d+)\s+(.+)/);
    if (fmtp) fmtps[fmtp[1]] = fmtp[2];
  }
  for (const pt of payloadTypes) {
    if (maps[pt]) return { ...maps[pt], fmtp: fmtps[pt] ?? null };
    if (pt === "0") return { payloadType: 0, name: "PCMU", clockRate: 8000, channels: 1, fmtp: null };
    if (pt === "8") return { payloadType: 8, name: "PCMA", clockRate: 8000, channels: 1, fmtp: null };
  }
  return null;
}

// With `codec` (from extractAudioCodec) the SDP declares exactly what the camera
// sends; without it, both PCMU (PT 0) and Opus (PT 111) are accepted.
function writeAudioSdpFile(rtpPort, codec = null) {
  const media = codec
    ? `m=audio ${rtpPort} RTP/AVP ${codec.payloadType}
a=rtpmap:${codec.payloadType} ${codec.name}/${codec.clockRate}${codec.channels > 1 ? `/${codec.channels}` : ""}
${codec.fmtp ? `a=fmtp:${codec.payloadType} ${codec.fmtp}\n` : ""}`
    : `m=audio ${rtpPort} RTP/AVP 0 111
a=rtpmap:0 PCMU/8000
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;useinbandfec=1
`;
  const sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=WyzeAudio
c=IN IP4 127.0.0.1
t=0 0
${media}`;
  const sdpPath = path.join(
    os.tmpdir(),
    `wyze-audio-${process.pid}-${nodeCrypto.randomBytes(4).toString("hex")}.sdp`
  );
  fs.writeFileSync(sdpPath, sdp);
  return sdpPath;
}

/**
 * Extract H.264 NAL units from an RTP payload. Returns an array of Buffer
 * (each Buffer is a complete NAL unit, including its 1-byte NAL header).
 * Handles single-NAL and STAP-A (type 24) packetization. SPS/PPS are tiny
 * and never fragmented in practice, so FU-A reassembly isn't needed here.
 */
function _extractH264Nals(payload) {
  if (!payload || payload.length < 1) return [];
  const nalType = payload[0] & 0x1f;
  if (nalType >= 1 && nalType <= 23) {
    return [payload];
  }
  if (nalType === 24) {
    const out = [];
    let i = 1;
    while (i + 2 <= payload.length) {
      const size = (payload[i] << 8) | payload[i + 1];
      i += 2;
      if (i + size > payload.length) break;
      out.push(payload.slice(i, i + size));
      i += size;
    }
    return out;
  }
  return [];
}

// captureStreamFrame: how long to let a freshly started ffmpeg bind its UDP
// port before replaying held RTP, how long to wait for SPS/PPS before giving
// up on them, and a cap on held packets.
const FFMPEG_BIND_MS = 300;
const SPROP_WAIT_MS = 5000;
const MAX_HELD_PACKETS = 5000;

function _spawnFfmpeg(sdpPath) {
  return spawn(resolveFfmpegPath(), [
    "-loglevel", "error",
    "-protocol_whitelist", "file,rtp,udp",
    "-fflags", "+genpts+discardcorrupt+nobuffer",
    "-flags", "low_delay",
    "-i", sdpPath,
    "-frames:v", "1",
    "-fps_mode", "passthrough",
    "-f", "image2",
    "-c:v", "mjpeg",
    "-q:v", "2",
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Send a signaling message in the format the Wyze/Kinesis WebRTC service
 * expects: a JSON envelope with base64-encoded inner payload.
 */
function _sendSignal(ws, action, payload, recipientClientId = "MASTER") {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    action,
    messagePayload: Buffer.from(JSON.stringify(payload)).toString("base64"),
    recipientClientId,
  }));
}

function _parseSignalMessage(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const env = JSON.parse(raw);
    const type = env.messageType || env.action;
    if (!type) return null;
    let payload = null;
    if (env.messagePayload) {
      try {
        payload = JSON.parse(Buffer.from(env.messagePayload, "base64").toString("utf8"));
      } catch (_) { /* keep null */ }
    }
    return { type, payload };
  } catch (_) {
    return null;
  }
}

/**
 * Capture a single JPEG frame from a Wyze camera's WebRTC stream.
 *
 * @param {Object} params
 * @param {string} params.signalingUrl — Kinesis Video signaling URL (signed)
 * @param {Array<{urls:string, username?:string, credential?:string}>} params.iceServers
 * @param {Object} [params.logger] — optional logger with .debug/.warning/.error
 * @param {number} [params.timeoutMs=20000] — overall timeout
 * @returns {Promise<Buffer>} JPEG image bytes
 */
async function captureStreamFrame({
  signalingUrl,
  iceServers,
  logger = null,
  timeoutMs = 20_000,
  sessionKey = null,
}) {
  const log = (level, msg) => {
    if (!logger) return;
    if (typeof logger[level] === "function") logger[level](`[capture] ${msg}`);
  };

  let sdpPath = null;
  let ffmpeg = null;
  let pc = null;
  let ws = null;
  let fwdSock = null;
  let fallbackTimer = null;
  let pliTimer = null;
  let aborted = false;
  let timeoutCtl = null;
  // Safe to run more than once (a preempting stream runs it, then the finally
  // below does): anything created after the first run is still torn down.
  const cleanup = () => {
    aborted = true;
    timeoutCtl?.abort(new Error("capture ended early: the camera was needed for a live stream"));
    clearTimeout(fallbackTimer);
    clearInterval(pliTimer);
    try { fwdSock?.close(); } catch (_) {}
    try { ffmpeg?.kill("SIGKILL"); } catch (_) {}
    try { if (sdpPath) fs.unlinkSync(sdpPath); } catch (_) {}
    return _closePeer(pc, ws);
  };

  const release = await _claimSession(sessionKey, "capture", cleanup);
  let rtpPort;

  try {
    timeoutCtl = _makeTimeout(timeoutMs, `capture timed out after ${timeoutMs}ms`);
    rtpPort = await pickFreeUdpPort();
    if (aborted) throw new Error("capture ended early: the camera was needed for a live stream");
    fwdSock = dgram.createSocket("udp4");

    const stdoutChunks = [];
    const stderrChunks = [];
    let settleOutcome;
    const ffmpegOutcome = new Promise((resolve, reject) => { settleOutcome = { resolve, reject }; });
    ffmpegOutcome.catch(() => {}); // may reject before anything is awaiting it

    // ffmpeg can only decode once it has the camera's SPS/PPS, and Wyze cameras
    // often don't repeat them in RTP: an ffmpeg started without them fails with
    // "non-existing PPS 0 referenced" until the timeout. So hold the RTP until
    // they're known, start ffmpeg with them baked into its SDP, then replay.
    const held = [];
    let started = false;
    let replayed = false;
    let capturedSps = null;
    let capturedPps = null;
    let videoReceiver = null;
    let videoSsrc = null;
    let videoPayloadType = 96;
    const forward = (buf) => {
      try { fwdSock.send(buf, rtpPort, "127.0.0.1"); } catch (_) { /* socket may be closed */ }
    };
    const requestKeyframe = () => {
      if (videoReceiver && videoSsrc) videoReceiver.sendRtcpPLI(videoSsrc).catch(() => {});
    };
    const startFfmpeg = (sprop) => {
      if (started || aborted) return;
      started = true;
      clearTimeout(fallbackTimer);
      log("debug", sprop ? "starting ffmpeg with sprop-parameter-sets" : "starting ffmpeg without sprop-parameter-sets");
      sdpPath = writeSdpFile(rtpPort, sprop, videoPayloadType);
      ffmpeg = _spawnFfmpeg(sdpPath);
      ffmpeg.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
      ffmpeg.stderr.on("data", (chunk) => stderrChunks.push(chunk));
      // Attach error/close handlers immediately so spawn failures (ENOENT,
      // crashes) reject the outcome promise instead of going unhandled and
      // crashing the Node process.
      ffmpeg.once("error", (err) => {
        if (err && err.code === "ENOENT") {
          settleOutcome.reject(new Error(
            `ffmpeg binary not found (tried: ${resolveFfmpegPath()}). ` +
            "Re-run `npm install` to fetch the bundled ffmpeg via ffmpeg-static, " +
            "or install ffmpeg on your system PATH if your platform isn't supported."
          ));
        } else {
          settleOutcome.reject(err);
        }
      });
      ffmpeg.once("close", (code) => {
        if (stdoutChunks.length > 0) settleOutcome.resolve(Buffer.concat(stdoutChunks));
        else settleOutcome.reject(new Error(`ffmpeg exited (${code}) without producing a frame: ${Buffer.concat(stderrChunks).toString()}`));
      });
      // Let ffmpeg bind its UDP port before replaying what was held, then ask
      // the camera for a fresh keyframe in case the first one was missed.
      setTimeout(() => {
        replayed = true;
        held.splice(0).forEach(forward);
        requestKeyframe();
      }, FFMPEG_BIND_MS);
    };

    pc = new RTCPeerConnection({
      iceServers,
      codecs: { video: h264Codecs() },
    });
    pc.addTransceiver("video", { direction: "recvonly" });

    pc.onTrack.subscribe((track) => {
      log("debug", `track received kind=${track.kind} codec=${track.codec?.name}`);
      videoReceiver = pc.getReceivers().find((r) => r.kind === "video") ?? null;
      videoSsrc = track.ssrc;
      if (track.codec?.payloadType != null) videoPayloadType = track.codec.payloadType;
      // Some firmwares send P-frames first and ignore the first PLI or two, so
      // keep asking until we have the SPS/PPS ffmpeg needs.
      requestKeyframe();
      // Keep asking until ffmpeg has actually produced a frame, not merely started:
      // under load ffmpeg can open its port after the replay below, miss the first
      // keyframe, and would otherwise wait for the camera's next one.
      pliTimer = setInterval(() => {
        if (stdoutChunks.length > 0 || aborted) clearInterval(pliTimer);
        else requestKeyframe();
      }, 500);
      track.onReceiveRtp.subscribe((rtp) => {
        const buf = rtp.serialize();
        if (replayed) return forward(buf);
        if (held.length < MAX_HELD_PACKETS) held.push(buf);
        if (!started && (!capturedSps || !capturedPps)) {
          for (const nal of _extractH264Nals(rtp.payload)) {
            const t = nal[0] & 0x1f;
            if (t === 7 && !capturedSps) capturedSps = nal;
            else if (t === 8 && !capturedPps) capturedPps = nal;
          }
          if (capturedSps && capturedPps) {
            log("debug", "captured SPS/PPS from RTP");
            startFfmpeg(`${capturedSps.toString("base64")},${capturedPps.toString("base64")}`);
          }
        }
      });
    });

    ws = new WebSocket(signalingUrl);
    const remoteAnswered = new Promise((resolve, reject) => {
      const onMsg = async (raw) => {
        const msg = _parseSignalMessage(raw.toString());
        if (!msg) return;
        try {
          if (msg.type === "SDP_ANSWER") {
            await pc.setRemoteDescription(msg.payload);
            log("debug", "applied SDP_ANSWER");
            resolve();
          } else if (msg.type === "ICE_CANDIDATE") {
            await pc.addIceCandidate(msg.payload);
          }
        } catch (err) {
          reject(err);
        }
      };
      ws.on("message", onMsg);
      ws.once("error", reject);
      ws.once("close", (code) => {
        if (code !== 1000) reject(new Error(`signaling WS closed (${code})`));
      });
    });

    remoteAnswered.catch(() => {}); // it can reject before anything awaits it (a closed ws)
    const timeout = timeoutCtl.promise;

    await Promise.race([
      new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      }),
      ffmpegOutcome,  // fail fast if ffmpeg dies (e.g. ENOENT) instead of hanging on WS open
      timeout,
    ]);
    log("debug", "signaling open, sending offer");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    _sendSignal(ws, "SDP_OFFER", { type: "offer", sdp: pc.localDescription.sdp });

    pc.onIceCandidate.subscribe((c) => {
      if (c?.candidate) _sendSignal(ws, "ICE_CANDIDATE", c);
    });

    await Promise.race([remoteAnswered, ffmpegOutcome, timeout]);
    log("debug", "WebRTC negotiation complete, waiting for frame");
    const answerSprop = extractSpropParameterSets(pc.remoteDescription?.sdp ?? null);
    if (answerSprop) {
      log("debug", "extracted sprop-parameter-sets from answer SDP");
      startFfmpeg(answerSprop);
    } else {
      // No parameter sets in the SDP: wait for them to appear in the RTP, but
      // not forever (an ffmpeg started without them is still our last resort).
      fallbackTimer = setTimeout(() => startFfmpeg(null), SPROP_WAIT_MS);
    }
    const buffer = await Promise.race([ffmpegOutcome, timeout]);
    log("debug", `captured ${buffer.length} bytes`);
    return buffer;
  } finally {
    timeoutCtl?.clear();
    try { await cleanup(); } finally { release(); }
  }
}

/**
 * Establish a long-lived WebRTC connection to a Wyze camera and forward every
 * incoming H.264 RTP packet to `localRtpPort` on 127.0.0.1 via UDP.
 *
 * Returns a `{ stop() }` handle. Call `stop()` to close the WebRTC peer and
 * the forwarding socket.
 *
 * @param {Object} params
 * @param {string} params.signalingUrl
 * @param {Array}  params.iceServers
 * @param {number} params.localRtpPort — UDP port FFmpeg is listening on
 * @param {Object} [params.logger]
 * @param {number} [params.timeoutMs=15000] — signaling negotiation timeout
 * @returns {Promise<{stop:Function}>}
 */
async function _startRtpForwarding({
  signalingUrl,
  iceServers,
  localRtpPort,
  localAudioRtpPort = null,
  logger = null,
  timeoutMs = 15_000,
  onVideoIdle = null,
  videoIdleMs = 10_000,
}, session) {
  const log = (level, msg) => {
    if (!logger) return;
    if (typeof logger[level] === "function") logger[level](`[stream] ${msg}`);
  };

  const videoSock = dgram.createSocket("udp4");
  videoSock.bind(0, "127.0.0.1");

  const audioSock = localAudioRtpPort ? dgram.createSocket("udp4") : null;
  if (audioSock) audioSock.bind(0, "127.0.0.1");

  // Until the full closer exists below, closing must still release the sockets
  // (the peer connection constructor can throw).
  session.close = async () => {
    try { videoSock.close(); } catch (_) {}
    try { audioSock?.close(); } catch (_) {}
  };

  // Aborted when the session is closed mid-setup (a stream replacing it, shutdown),
  // so setup stops at once instead of running out its clock.
  const timeoutCtl = _makeTimeout(timeoutMs, `stream negotiation timed out after ${timeoutMs}ms`);

  const codecs = { video: h264Codecs() };
  if (localAudioRtpPort) codecs.audio = audioCodecs();

  const pc = new RTCPeerConnection({ iceServers, codecs });
  pc.addTransceiver("video", { direction: "recvonly" });
  if (localAudioRtpPort) pc.addTransceiver("audio", { direction: "recvonly" });

  let pliTimer = null;
  let videoTrackInfo = null; // { receiver, ssrc } — set on first video track
  let lastVideoRtpAt = 0;
  let idleWatchdog = null;
  let idleFired = false;
  let audioPackets = 0;
  let videoPayloadType = 96; // replaced by what the camera negotiates

  // Everything this forwarder holds is closed through here, whether it stops
  // normally, fails to negotiate, or is preempted: peer connection first
  // (awaited), then signaling, then the local sockets.
  let ws = null;
  let closing = null;
  const closeEverything = () => {
    if (closing) return closing;
    log("debug", "stopping RTP forwarding");
    timeoutCtl.abort(new Error("stream closed while starting"));
    if (pliTimer) { clearInterval(pliTimer); pliTimer = null; }
    if (idleWatchdog) { clearInterval(idleWatchdog); idleWatchdog = null; }
    closing = _closePeer(pc, ws).finally(() => {
      try { videoSock.close(); } catch (_) {}
      try { audioSock?.close(); } catch (_) {}
    });
    return closing;
  };
  session.close = closeEverything;

  // Resolves with `<base64Sps>,<base64Pps>` once both NALs are seen in RTP.
  let capturedSps = null;
  let capturedPps = null;
  let resolveSpropFromRtp;
  const spropFromRtpPromise = new Promise((r) => { resolveSpropFromRtp = r; });

  pc.onTrack.subscribe((track) => {
    log("debug", `forwarding track kind=${track.kind}`);
    if (track.kind === "video") {
      videoTrackInfo = { receiver: pc.getReceivers().find((r) => r.kind === "video"), ssrc: track.ssrc };
      if (track.codec?.payloadType != null) videoPayloadType = track.codec.payloadType;
      // Ask the camera to emit a keyframe immediately so HomeKit doesn't have
      // to wait for the next natural IDR. Keep prodding until we've actually
      // captured SPS+PPS — some firmwares send P-frames first and ignore the
      // first PLI or two.
      const requestPli = () => {
        if (videoTrackInfo?.receiver && videoTrackInfo?.ssrc) {
          videoTrackInfo.receiver.sendRtcpPLI(videoTrackInfo.ssrc).catch(() => {});
        }
      };
      requestPli();
      pliTimer = setInterval(() => {
        if (capturedSps && capturedPps) {
          clearInterval(pliTimer);
          pliTimer = null;
        } else {
          requestPli();
        }
      }, 500);
      track.onReceiveRtp.subscribe((rtp) => {
        lastVideoRtpAt = Date.now();
        // Watch for SPS/PPS NAL units so we can build sprop-parameter-sets
        // ourselves when the camera doesn't advertise them in the SDP.
        if (!capturedSps || !capturedPps) {
          for (const nal of _extractH264Nals(rtp.payload)) {
            const t = nal[0] & 0x1f;
            if (t === 7 && !capturedSps) capturedSps = nal;
            else if (t === 8 && !capturedPps) capturedPps = nal;
          }
          if (capturedSps && capturedPps) {
            const sprop = `${capturedSps.toString("base64")},${capturedPps.toString("base64")}`;
            resolveSpropFromRtp(sprop);
          }
        }
        try { videoSock.send(rtp.serialize(), localRtpPort, "127.0.0.1"); } catch (_) {}
      });
    } else if (track.kind === "audio" && audioSock) {
      track.onReceiveRtp.subscribe((rtp) => {
        audioPackets += 1;
        try { audioSock.send(rtp.serialize(), localAudioRtpPort, "127.0.0.1"); } catch (_) {}
      });
    }
  });

  ws = new WebSocket(signalingUrl);

  const negotiated = new Promise((resolve, reject) => {
    const onMsg = async (raw) => {
      const msg = _parseSignalMessage(raw.toString());
      if (!msg) return;
      try {
        if (msg.type === "SDP_ANSWER") {
          await pc.setRemoteDescription(msg.payload);
          log("debug", "applied SDP_ANSWER");
          resolve();
        } else if (msg.type === "ICE_CANDIDATE") {
          await pc.addIceCandidate(msg.payload);
        }
      } catch (err) {
        reject(err);
      }
    };
    ws.on("message", onMsg);
    ws.once("error", reject);
    ws.once("close", (code) => {
      if (code !== 1000) reject(new Error(`signaling WS closed unexpectedly (${code})`));
    });
  });

  negotiated.catch(() => {}); // it can reject before anything awaits it (a closed ws)
  const timeout = timeoutCtl.promise;

  await Promise.race([
    new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    timeout,
  ]);

  log("debug", "signaling open, sending offer");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  _sendSignal(ws, "SDP_OFFER", { type: "offer", sdp: pc.localDescription.sdp });

  pc.onIceCandidate.subscribe((c) => {
    if (c?.candidate) _sendSignal(ws, "ICE_CANDIDATE", c);
  });

  await Promise.race([negotiated, timeout]);
  timeoutCtl.clear();
  log("debug", "WebRTC negotiation complete — forwarding RTP");

  // Get SPS/PPS for FFmpeg's H.264 decoder.
  // 1) Prefer the camera's SDP answer.
  // 2) Fall back to capturing them from the live RTP stream — Wyze cameras
  //    in particular often omit them from SDP, so this is the path that
  //    actually works for their hardware.
  let spropParameterSets = extractSpropParameterSets(pc.remoteDescription?.sdp ?? null);
  if (spropParameterSets) {
    log("debug", "extracted sprop-parameter-sets from answer SDP");
  } else {
    log("debug", "no sprop in SDP — capturing SPS/PPS from RTP stream");
    const rtpTimeout = new Promise((res) => setTimeout(() => res(null), 8000));
    spropParameterSets = await Promise.race([spropFromRtpPromise, rtpTimeout]);
    if (spropParameterSets) log("debug", "captured SPS/PPS from RTP");
    else log("warning", "timed out waiting for SPS/PPS — H.264 may not decode");
  }
  if (closing) throw new Error("stream closed while starting");

  // After ffmpeg comes up, the caller can call requestKeyframe() to force
  // a fresh IDR so decoding starts immediately rather than at the next
  // natural keyframe interval.
  const requestKeyframe = () => {
    if (videoTrackInfo?.receiver && videoTrackInfo?.ssrc) {
      videoTrackInfo.receiver.sendRtcpPLI(videoTrackInfo.ssrc).catch(() => {});
    }
  };

  // Silent-stall watchdog: WebRTC sometimes stops delivering RTP without
  // closing the peer connection. If we go too long with no video packets,
  // notify the caller so it can rebuild the stream.
  if (onVideoIdle) {
    lastVideoRtpAt = Date.now();
    idleWatchdog = setInterval(() => {
      if (idleFired) return;
      const gap = Date.now() - lastVideoRtpAt;
      if (gap >= videoIdleMs) {
        idleFired = true;
        log("warning", `no video RTP for ${gap}ms — signaling stall`);
        try { onVideoIdle(); } catch (_) {}
      }
    }, Math.min(2000, videoIdleMs)).unref();
  }

  const stop = () => closeEverything();

  const audioCodec = localAudioRtpPort ? extractAudioCodec(pc.remoteDescription?.sdp ?? null) : null;
  if (localAudioRtpPort) {
    log("debug", audioCodec
      ? `audio: ${audioCodec.name}/${audioCodec.clockRate} on payload type ${audioCodec.payloadType}`
      : "audio: no codec found in the SDP answer");
  }

  // audioSeen() is false for a camera that negotiates audio but sends none (microphone off).
  return { stop, spropParameterSets, requestKeyframe, audioCodec, videoPayloadType, audioSeen: () => audioPackets > 0 };
}

/**
 * Public entry: claims the camera's single session slot (waiting for any
 * previous session to finish closing), runs the forwarder, and guarantees the
 * session is closed and the slot released on every exit path. `sessionKey` is
 * normally the camera's MAC.
 */
async function startRtpForwarding(params) {
  const session = { close: null };
  let release = () => {};
  const closeAndRelease = async () => {
    try { if (session.close) await session.close(); } finally { release(); }
  };
  release = await _claimSession(params.sessionKey, "stream", closeAndRelease);
  try {
    const handle = await _startRtpForwarding(params, session);
    return { ...handle, stop: closeAndRelease };
  } catch (err) {
    await closeAndRelease().catch(() => {});
    throw err;
  }
}

module.exports = {
  captureStreamFrame,
  startRtpForwarding,
  closeAllSessions,
  extractAudioCodec,
  _claimSession, // exported for tests
  _closePeer, // exported for tests
  _makeTimeout, // exported for tests
  h264Codecs, // exported for tests
  audioCodecs, // exported for tests
  pickFreeUdpPort,
  writeSdpFile,
  writeAudioSdpFile,
  resolveFfmpegPath,
  localIpAddress,
  extractSpropParameterSets,
};
