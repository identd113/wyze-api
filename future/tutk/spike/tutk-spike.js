#!/usr/bin/env node
"use strict";

/**
 * tutk-spike.js: Phase 1 of a pure-JavaScript TUTK client. Standalone and READ-ONLY.
 *
 * What it does, against one camera on the LAN, with Node built-ins only (no native library):
 *   1. finds the camera by UDP (discovery + session setup, in either the IOTC or the "CC51" form),
 *   2. runs a DTLS 1.2 handshake over that session (cipher suite 0xCCAC, ECDHE-PSK with ChaCha20-Poly1305),
 *   3. sends the AV login and passes the K10000 to K10003 challenge authentication.
 * It then prints a short summary and exits. It sends no setting to the camera.
 *
 * Phase 2 (opt in):
 *   --night-vision        also reads night vision (K10040): 1 = on, 2 = off, 3 = auto. Read only.
 *   --set on|off|auto     sets night vision (K10042), then reads it back to check. This changes the camera.
 *   --restore             with --set: put the value that was there before back afterwards.
 *   --query 10446,10448   sends those read-only get commands and prints each answer (private fields hidden).
 *                         Only the get commands in READ_ONLY_COMMANDS are accepted; nothing else is sent.
 *
 * The protocol is taken from AlexxIT/go2rtc (pkg/tutk, pkg/tutk/dtls, pkg/wyze), which is MIT licensed:
 *   Copyright (c) 2022 Alexey Khit. Permission is granted, free of charge, to use, copy, modify and
 *   distribute it under the MIT License (https://github.com/AlexxIT/go2rtc/blob/master/LICENSE).
 * This file is a port of that behaviour to JavaScript, not a copy of any docker-wyze-bridge code.
 *
 * Usage:
 *   node future/tutk/spike/tutk-spike.js [--model HL_DB2] [--name <part of nickname>] [--host <ip>]
 *                                        [--port 32761] [--verbose] [--timeout 8000]
 *                                        [--night-vision] [--set on|off|auto [--restore]]
 *
 * Credentials come from wyze-api's .env (USERNAME, PASSWORD, KEY_ID, API_KEY), the same as scripts/.
 * The camera's enr, P2P id and MAC are read from the Wyze device list and never printed.
 *
 * Exit code: 0 authenticated, 1 failed, 2 bad usage.
 */

const crypto = require("crypto");
const dgram = require("dgram");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------------------------
// Options and logging
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const VERBOSE = args.includes("--verbose");
const TIMEOUT_MS = Number(opt("timeout", 8000));
const log = (...a) => console.log(...a);
const vlog = (...a) => { if (VERBOSE) console.log("   ", ...a); };

// ---------------------------------------------------------------------------------------------
// TransCode: the fixed scrambling TUTK applies to every non-CC51 packet
// ---------------------------------------------------------------------------------------------

const CHARLIE = Buffer.from("Charlie is the designer of P2P!!");

function rotl32(x, k) {
  k = ((k % 32) + 32) % 32;
  return k === 0 ? x >>> 0 : ((x << k) | (x >>> (32 - k))) >>> 0;
}

// dst[dOff..] = permutation of src[sOff..] for block sizes 2, 4, 8 and 16; anything else is a copy
function swapBytes(dst, dOff, src, sOff, n) {
  const s = (i) => src[sOff + i];
  switch (n) {
    case 2: dst[dOff] = s(1); dst[dOff + 1] = s(0); return;
    case 4: dst[dOff] = s(2); dst[dOff + 1] = s(3); dst[dOff + 2] = s(0); dst[dOff + 3] = s(1); return;
    case 8: {
      const o = [7, 4, 3, 2, 1, 6, 5, 0];
      for (let i = 0; i < 8; i++) dst[dOff + i] = s(o[i]);
      return;
    }
    case 16: {
      const o = [11, 9, 8, 15, 13, 10, 12, 14, 2, 1, 5, 0, 6, 4, 7, 3];
      for (let i = 0; i < 16; i++) dst[dOff + i] = s(o[i]);
      return;
    }
    default:
      for (let i = 0; i < n; i++) dst[dOff + i] = s(i);
  }
}

function transCodePartial(src) {
  let n = src.length;
  const dst = Buffer.alloc(n);
  const tmp = Buffer.alloc(n);
  let off = 0;
  for (; n >= 16; n -= 16, off += 16) {
    for (let i = 0; i < 16; i += 4) tmp.writeUInt32LE(rotl32(src.readUInt32LE(off + i), -i - 1), off + i);
    for (let i = 0; i < 16; i++) dst[off + i] = tmp[off + i] ^ CHARLIE[i];
    swapBytes(tmp, off, dst, off, 16);
    for (let i = 0; i < 16; i += 4) dst.writeUInt32LE(rotl32(tmp.readUInt32LE(off + i), -i - 3), off + i);
  }
  for (let i = 0; i < n; i++) tmp[off + i] = src[off + i] ^ CHARLIE[i];
  swapBytes(dst, off, tmp, off, n);
  return dst;
}

function reverseTransCodePartial(src) {
  let n = src.length;
  const dst = Buffer.alloc(n);
  const tmp = Buffer.alloc(n);
  let off = 0;
  for (; n >= 16; n -= 16, off += 16) {
    for (let i = 0; i < 16; i += 4) tmp.writeUInt32LE(rotl32(src.readUInt32LE(off + i), i + 3), off + i);
    swapBytes(dst, off, tmp, off, 16);
    for (let i = 0; i < 16; i++) tmp[off + i] = dst[off + i] ^ CHARLIE[i];
    for (let i = 0; i < 16; i += 4) dst.writeUInt32LE(rotl32(tmp.readUInt32LE(off + i), i + 1), off + i);
  }
  swapBytes(tmp, off, src, off, n);
  for (let i = 0; i < n; i++) dst[off + i] = tmp[off + i] ^ CHARLIE[i];
  return dst;
}

function transCodeBlob(src) {
  if (src.length < 16) return transCodePartial(src);
  const dst = Buffer.alloc(src.length);
  transCodePartial(src.subarray(0, 16)).copy(dst, 0);
  if (src.length > 16) {
    if (src[3] & 1) { // partial encryption: 48 bytes after the header
      const remaining = src.length - 16;
      const len = Math.min(remaining, 48);
      transCodePartial(src.subarray(16, 16 + len)).copy(dst, 16);
      if (remaining > 48) src.copy(dst, 64, 64);
    } else {
      transCodePartial(src.subarray(16)).copy(dst, 16);
    }
  }
  return dst;
}

function reverseTransCodeBlob(src) {
  if (src.length < 16) return reverseTransCodePartial(src);
  const dst = Buffer.alloc(src.length);
  reverseTransCodePartial(src.subarray(0, 16)).copy(dst, 0);
  if (src.length > 16) {
    if (dst[3] & 1) {
      const remaining = src.length - 16;
      const len = Math.min(remaining, 48);
      reverseTransCodePartial(src.subarray(16, 16 + len)).copy(dst, 16);
      if (remaining > 48) src.copy(dst, 64, 64);
    } else {
      reverseTransCodePartial(src.subarray(16)).copy(dst, 16);
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------------------------
// Keys derived from the camera's enr
// ---------------------------------------------------------------------------------------------

function calculateAuthKey(enr, mac) {
  const hash = crypto.createHash("sha256").update(enr + mac.toUpperCase()).digest();
  return Buffer.from(hash.subarray(0, 6).toString("base64").replace(/\+/g, "Z").replace(/\//g, "9").replace(/=/g, "A"));
}

// TUTK treats the PSK as a C string: a 0x00 byte in SHA-256(enr) ends it
function derivePsk(enr) {
  const hash = crypto.createHash("sha256").update(enr).digest();
  let len = 32;
  for (let i = 0; i < 32; i++) if (hash[i] === 0) { len = i; break; }
  const psk = Buffer.alloc(32);
  hash.copy(psk, 0, 0, len);
  return psk;
}

const hmacSha1 = (key, data) => crypto.createHmac("sha1", key).update(data).digest();

// ---------------------------------------------------------------------------------------------
// XXTEA decrypt, for the K10002 challenge response
// ---------------------------------------------------------------------------------------------

const DELTA = 0x9e3779b9;

function xxteaDecryptVar(data, key) {
  if (data.length < 8 || key.length < 16) return null;
  const k = [0, 1, 2, 3].map((i) => key.readUInt32LE(i * 4));
  const n = Math.max(Math.floor(data.length / 4), 2);
  const v = new Array(n).fill(0);
  for (let i = 0; i < Math.floor(data.length / 4); i++) v[i] = data.readUInt32LE(i * 4);
  let rounds = 6 + Math.floor(52 / n);
  let sum = Math.imul(rounds, DELTA) >>> 0;
  let y = v[0];
  const mx = (s, yy, z, p, e) =>
    ((((z >>> 5) ^ (yy << 2)) + ((yy >>> 3) ^ (z << 4))) ^ (((s ^ yy) + (k[(p & 3) ^ e] ^ z)) >>> 0)) >>> 0;
  while (rounds > 0) {
    const e = (sum >>> 2) & 3;
    for (let p = n - 1; p > 0; p--) {
      v[p] = (v[p] - mx(sum, y, v[p - 1], p, e)) >>> 0;
      y = v[p];
    }
    v[0] = (v[0] - mx(sum, y, v[n - 1], 0, e)) >>> 0;
    y = v[0];
    sum = (sum - DELTA) >>> 0;
    rounds--;
  }
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) out.writeUInt32LE(v[i], i * 4);
  return out.subarray(0, data.length);
}

function challengeResponse(challenge, enr, status) {
  let key;
  let data = challenge;
  if (status === 3) key = Buffer.alloc(16), Buffer.from(enr).copy(key, 0, 0, 16);
  else if (status === 6) {
    if (enr.length >= 16) data = xxteaDecryptVar(data, Buffer.from(enr.slice(0, 16)));
    key = Buffer.alloc(16);
    if (enr.length > 16) Buffer.from(enr.slice(16, 32)).copy(key);
    else key = Buffer.from("FFFFFFFFFFFFFFFF");
  } else key = Buffer.from("FFFFFFFFFFFFFFFF");
  return xxteaDecryptVar(data, key);
}

// ---------------------------------------------------------------------------------------------
// DTLS 1.2 client: TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256 (0xCCAC), no extended master secret
// ---------------------------------------------------------------------------------------------

const DTLS_VERSION = Buffer.from([0xfe, 0xfd]);
const CT = { CCS: 20, ALERT: 21, HANDSHAKE: 22, APPDATA: 23 };
const HS = { CLIENT_HELLO: 1, SERVER_HELLO: 2, HELLO_VERIFY: 3, SERVER_KEY_EXCHANGE: 12, SERVER_HELLO_DONE: 14, CLIENT_KEY_EXCHANGE: 16, FINISHED: 20 };
const PSK_IDENTITY = Buffer.from("AUTHPWD_admin");

function prf(secret, label, seed, length) {
  const labelSeed = Buffer.concat([Buffer.from(label), seed]);
  const out = [];
  let a = labelSeed;
  let total = 0;
  while (total < length) {
    a = crypto.createHmac("sha256", secret).update(a).digest();
    const block = crypto.createHmac("sha256", secret).update(Buffer.concat([a, labelSeed])).digest();
    out.push(block);
    total += block.length;
  }
  return Buffer.concat(out).subarray(0, length);
}

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u24 = (n) => Buffer.from([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

function recordHeader(type, epoch, seq, length) {
  const h = Buffer.alloc(13);
  h[0] = type;
  DTLS_VERSION.copy(h, 1);
  h.writeUInt16BE(epoch, 3);
  h.writeUIntBE(seq, 5, 6);
  h.writeUInt16BE(length, 11);
  return h;
}

function aeadNonce(iv, epoch, seq) {
  const nonce = Buffer.alloc(12);
  nonce.writeUInt16BE(epoch, 4);
  nonce.writeUIntBE(seq, 6, 6);
  for (let i = 0; i < 12; i++) nonce[i] ^= iv[i];
  return nonce;
}

function aeadAad(type, epoch, seq, plainLength) {
  const aad = Buffer.alloc(13);
  aad.writeUInt16BE(epoch, 0);
  aad.writeUIntBE(seq, 2, 6);
  aad[8] = type;
  DTLS_VERSION.copy(aad, 9);
  aad.writeUInt16BE(plainLength, 11);
  return aad;
}

function ecdhPublicFromX25519(keyObject) {
  return keyObject.export({ type: "spki", format: "der" }).subarray(-32);
}

class DtlsClient {
  /**
   * @param {(datagram: Buffer) => void} send sends one DTLS datagram to the camera (already wrapped by the session)
   * @param {Buffer} psk
   */
  constructor(send, psk) {
    this.send = send;
    this.psk = psk;
    this.epoch = 0;
    this.sendSeq = { 0: 0, 1: 0 };
    this.msgSeq = 0;
    this.transcript = [];
    this.recvEpoch1Seq = -1;
    this.nextRecvMsgSeq = 0;
    this.pending = new Map(); // message_seq to { type, length, parts: Map(offset, Buffer), have }
    this.state = "start";
    this.clientRandom = crypto.randomBytes(32);
    this.cookie = Buffer.alloc(0);
    this.flight = [];
    this.timer = null;
    this.retries = 0;
    this.keys = null;
    this.appData = [];
    this.appWaiters = [];
    this.done = new Promise((res, rej) => {
      this.finish = res;
      this.fail = (e) => { clearTimeout(this.timer); rej(e); };
    });
    this.done.catch(() => {});
  }

  /** Stops the retransmit timer; call it when the session is closed. */
  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }

  start() {
    this.sendClientHello();
  }

  // ---- sending ----

  handshakeMessage(type, body, record = true) {
    const msg = Buffer.concat([Buffer.from([type]), u24(body.length), u16(this.msgSeq++), u24(0), u24(body.length), body]);
    if (record) this.transcript.push(msg);
    return msg;
  }

  plainRecord(type, payload) {
    const seq = this.sendSeq[0]++;
    return Buffer.concat([recordHeader(type, 0, seq, payload.length), payload]);
  }

  encryptedRecord(type, payload) {
    const seq = this.sendSeq[1]++;
    const nonce = aeadNonce(this.keys.clientIv, 1, seq);
    const cipher = crypto.createCipheriv("chacha20-poly1305", this.keys.clientKey, nonce, { authTagLength: 16 });
    cipher.setAAD(aeadAad(type, 1, seq, payload.length), { plaintextLength: payload.length });
    const ct = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
    return Buffer.concat([recordHeader(type, 1, seq, ct.length), ct]);
  }

  sendFlight(datagrams) {
    this.flight = datagrams;
    this.retries = 0;
    clearTimeout(this.timer);
    const fire = () => {
      if (this.closed) return;
      for (const d of this.flight) {
        try { this.send(d); } catch (_) { /* the socket may already be closed */ }
      }
      this.timer = setTimeout(() => {
        if (++this.retries > 20) return this.fail(new Error(`DTLS handshake: no reply in state ${this.state}`));
        vlog(`DTLS retransmit #${this.retries} (${this.state})`);
        fire();
      }, 300);
    };
    fire();
  }

  sendClientHello() {
    const groups = Buffer.from([0x00, 0x04, 0x00, 0x1d, 0x00, 0x17]); // x25519, secp256r1
    const extensions = Buffer.concat([
      u16(0x000a), u16(groups.length), groups,
      u16(0x000b), u16(2), Buffer.from([0x01, 0x00]), // ec_point_formats: uncompressed
      u16(0xff01), u16(1), Buffer.from([0x00]), // renegotiation_info
    ]);
    const body = Buffer.concat([
      DTLS_VERSION, this.clientRandom,
      Buffer.from([0x00]), // session id
      Buffer.from([this.cookie.length]), this.cookie,
      u16(2), u16(0xccac),
      Buffer.from([0x01, 0x00]), // compression: null
      u16(extensions.length), extensions,
    ]);
    // Kept in the hash even without a cookie: only a ClientHello answered by a HelloVerifyRequest is left out
    // (the HelloVerifyRequest handler clears the hash and sends the second one).
    const hello = this.handshakeMessage(HS.CLIENT_HELLO, body);
    this.state = "client-hello";
    this.sendFlight([this.plainRecord(CT.HANDSHAKE, hello)]);
  }

  // ---- receiving ----

  onDatagram(buf) {
    let off = 0;
    while (off + 13 <= buf.length) {
      const type = buf[off];
      const epoch = buf.readUInt16BE(off + 3);
      const seq = buf.readUIntBE(off + 5, 6);
      const len = buf.readUInt16BE(off + 11);
      if (off + 13 + len > buf.length) break;
      const payload = buf.subarray(off + 13, off + 13 + len);
      off += 13 + len;
      try {
        this.onRecord(type, epoch, seq, payload);
      } catch (e) {
        vlog(`DTLS record dropped: ${e.message}`);
      }
    }
  }

  decrypt(type, epoch, seq, payload) {
    if (payload.length < 16) throw new Error("short ciphertext");
    const nonce = aeadNonce(this.keys.serverIv, epoch, seq);
    const decipher = crypto.createDecipheriv("chacha20-poly1305", this.keys.serverKey, nonce, { authTagLength: 16 });
    const ct = payload.subarray(0, payload.length - 16);
    decipher.setAAD(aeadAad(type, epoch, seq, ct.length), { plaintextLength: ct.length });
    decipher.setAuthTag(payload.subarray(payload.length - 16));
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  onRecord(type, epoch, seq, payload) {
    if (type === CT.ALERT) {
      const plain = epoch > 0 && this.keys ? this.decrypt(type, epoch, seq, payload) : payload;
      this.fail(new Error(`DTLS alert level ${plain[0]} description ${plain[1]}`));
      return;
    }
    if (type === CT.CCS) {
      vlog("DTLS server ChangeCipherSpec");
      this.sawServerCcs = true;
      return;
    }
    if (type === CT.APPDATA) {
      if (!this.keys) return;
      const plain = this.decrypt(type, epoch, seq, payload);
      const w = this.appWaiters.shift();
      if (w) w(plain); else this.appData.push(plain);
      return;
    }
    if (type !== CT.HANDSHAKE) return;
    const plain = epoch > 0 ? this.decrypt(type, epoch, seq, payload) : payload;
    let off = 0;
    while (off + 12 <= plain.length) {
      const msgType = plain[off];
      const length = plain.readUIntBE(off + 1, 3);
      const msgSeq = plain.readUInt16BE(off + 4);
      const fragOff = plain.readUIntBE(off + 6, 3);
      const fragLen = plain.readUIntBE(off + 9, 3);
      const frag = plain.subarray(off + 12, off + 12 + fragLen);
      off += 12 + fragLen;
      this.onFragment(msgType, length, msgSeq, fragOff, frag);
    }
  }

  onFragment(type, length, msgSeq, fragOff, frag) {
    if (msgSeq < this.nextRecvMsgSeq && !(type === HS.HELLO_VERIFY)) return; // duplicate
    let p = this.pending.get(msgSeq);
    if (!p) { p = { type, length, parts: new Map(), have: 0 }; this.pending.set(msgSeq, p); }
    if (!p.parts.has(fragOff)) { p.parts.set(fragOff, Buffer.from(frag)); p.have += frag.length; }
    while (this.pending.has(this.nextRecvMsgSeq)) {
      const m = this.pending.get(this.nextRecvMsgSeq);
      if (m.have < m.length) break;
      const body = Buffer.alloc(m.length);
      for (const [o, b] of m.parts) b.copy(body, o);
      this.pending.delete(this.nextRecvMsgSeq);
      const seqNo = this.nextRecvMsgSeq++;
      this.onMessage(m.type, seqNo, body);
    }
  }

  onMessage(type, seqNo, body) {
    vlog(`DTLS handshake message type ${type}, ${body.length} bytes, state ${this.state}`);
    const asRecorded = () => Buffer.concat([Buffer.from([type]), u24(body.length), u16(seqNo), u24(0), u24(body.length), body]);
    if (type === HS.HELLO_VERIFY) {
      // body: version(2) cookie_len(1) cookie
      this.cookie = Buffer.from(body.subarray(3, 3 + body[2]));
      this.nextRecvMsgSeq = 1;
      this.transcript = [];
      this.msgSeq = 1;
      this.sendClientHello();
      return;
    }
    if (type === HS.SERVER_HELLO) {
      this.transcript.push(asRecorded());
      let o = 2; // version
      this.serverRandom = Buffer.from(body.subarray(o, o + 32)); o += 32;
      o += 1 + body[o]; // session id
      const suite = body.readUInt16BE(o);
      if (suite !== 0xccac) return this.fail(new Error(`camera chose cipher suite 0x${suite.toString(16)}, expected 0xccac`));
      this.state = "server-hello";
      return;
    }
    if (type === HS.SERVER_KEY_EXCHANGE) {
      this.transcript.push(asRecorded());
      let o = 0;
      const hintLen = body.readUInt16BE(o); o += 2 + hintLen; // psk identity hint (not used)
      if (body[o] !== 3) return this.fail(new Error("server key exchange: not a named curve"));
      const curve = body.readUInt16BE(o + 1);
      const pubLen = body[o + 3];
      this.serverPub = Buffer.from(body.subarray(o + 4, o + 4 + pubLen));
      this.curve = curve;
      this.state = "server-key-exchange";
      return;
    }
    if (type === HS.SERVER_HELLO_DONE) {
      this.transcript.push(asRecorded());
      this.onServerHelloDone();
      return;
    }
    if (type === HS.FINISHED) {
      const expected = prf(this.master, "server finished", crypto.createHash("sha256").update(Buffer.concat(this.transcript)).digest(), 12);
      if (!body.equals(expected)) return this.fail(new Error("server Finished did not verify"));
      clearTimeout(this.timer);
      this.state = "connected";
      vlog("DTLS handshake complete");
      this.finish();
      return;
    }
  }

  onServerHelloDone() {
    let shared;
    let clientPub;
    if (this.curve === 0x001d) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
      clientPub = ecdhPublicFromX25519(publicKey);
      const peer = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), this.serverPub]), format: "der", type: "spki" });
      shared = crypto.diffieHellman({ privateKey, publicKey: peer });
    } else if (this.curve === 0x0017) {
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.generateKeys();
      clientPub = ecdh.getPublicKey();
      shared = ecdh.computeSecret(this.serverPub);
    } else {
      return this.fail(new Error(`camera chose unsupported curve 0x${this.curve.toString(16)}`));
    }
    const premaster = Buffer.concat([u16(shared.length), shared, u16(this.psk.length), this.psk]);
    this.master = prf(premaster, "master secret", Buffer.concat([this.clientRandom, this.serverRandom]), 48);
    const block = prf(this.master, "key expansion", Buffer.concat([this.serverRandom, this.clientRandom]), 32 + 32 + 12 + 12);
    this.keys = {
      clientKey: block.subarray(0, 32), serverKey: block.subarray(32, 64),
      clientIv: block.subarray(64, 76), serverIv: block.subarray(76, 88),
    };
    const cke = this.handshakeMessage(HS.CLIENT_KEY_EXCHANGE, Buffer.concat([u16(PSK_IDENTITY.length), PSK_IDENTITY, Buffer.from([clientPub.length]), clientPub]));
    const ccsRecord = this.plainRecord(CT.CCS, Buffer.from([1]));
    const verify = prf(this.master, "client finished", crypto.createHash("sha256").update(Buffer.concat(this.transcript)).digest(), 12);
    const finished = this.handshakeMessage(HS.FINISHED, verify);
    const finishedRecord = this.encryptedRecord(CT.HANDSHAKE, finished);
    this.state = "client-finished";
    this.sendFlight([this.plainRecord(CT.HANDSHAKE, cke), ccsRecord, finishedRecord]);
  }

  // ---- application data ----

  write(payload) {
    this.send(this.encryptedRecord(CT.APPDATA, payload));
  }

  read(timeoutMs) {
    if (this.appData.length) return Promise.resolve(this.appData.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        const i = this.appWaiters.indexOf(w);
        if (i >= 0) this.appWaiters.splice(i, 1);
        reject(new Error("timeout waiting for data"));
      }, timeoutMs);
      const w = (d) => { clearTimeout(t); resolve(d); };
      this.appWaiters.push(w);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The session: discovery, IOTC or CC51 framing, keepalives
// ---------------------------------------------------------------------------------------------

const MAGIC_CC51 = Buffer.from([0x51, 0xcc]);
const SDK_42 = Buffer.from([0x01, 0x01, 0x02, 0x04]);
const SDK_43 = Buffer.from([0x00, 0x08, 0x03, 0x04]);
const CMD = { DISCO_REQ: 0x0601, DISCO_RES: 0x0602, SESSION_REQ: 0x0402, SESSION_RES: 0x0404, DATA_TX: 0x0407, DATA_RX: 0x0408, KA_REQ: 0x0427, KA_RES: 0x0428 };
const CC51 = { DISCO: 0x1002, KA: 0x1202, DTLS: 0x1502, SIZE: 52, HEADER: 28, AUTH: 20, KA_SIZE: 48 };

class Session {
  constructor({ host, port, uid, authKey, enr }) {
    this.host = host;
    this.port = port;
    this.uid = Buffer.from(uid);
    this.authKey = authKey;
    this.enr = enr;
    this.sid = Buffer.alloc(8);
    crypto.randomBytes(8).copy(this.sid);
    this.isCC51 = false;
    this.ticket = 0;
    this.seq = 0;
    this.kaSeq = 0;
    this.socket = dgram.createSocket("udp4");
    this.listeners = new Set();
    this.dtlsRx = [];
    this.socket.on("message", (buf, rinfo) => this.onPacket(buf, rinfo));
    this.socket.on("error", (e) => vlog(`socket error: ${e.message}`));
  }

  hmacKey() { return Buffer.concat([this.uid, this.authKey]); }

  raw(buf) {
    if (this.closedSocket) return;
    try { this.socket.send(buf, this.port, this.host, () => {}); } catch (_) { /* socket closed */ }
  }
  write(buf) { this.raw(this.isCC51 ? buf : transCodeBlob(buf)); }

  // ---- packet builders ----

  msgDisco(stage) {
    const b = Buffer.alloc(16 + 72);
    Buffer.from([0x04, 0x02, 0x1a, 0x02]).copy(b);
    b.writeUInt16LE(72, 4);
    b.writeUInt16LE(CMD.DISCO_REQ, 8);
    b.writeUInt16LE(0x0021, 10);
    const body = b.subarray(16);
    this.uid.copy(body, 0, 0, 20);
    SDK_42.copy(body, 36);
    this.sid.copy(body, 40);
    body[48] = stage;
    if (stage === 1 && this.authKey.length) this.authKey.copy(body, 58);
    return b;
  }

  msgDiscoCC51(seq, ticket, isResponse) {
    const b = Buffer.alloc(CC51.SIZE);
    MAGIC_CC51.copy(b);
    b.writeUInt16LE(CC51.DISCO, 4);
    b.writeUInt16LE(0x0028, 6);
    if (isResponse) b.writeUInt16LE(0xffff, 8);
    b.writeUInt16LE(seq, 12);
    b.writeUInt16LE(ticket, 14);
    this.sid.copy(b, 16);
    SDK_43.copy(b, 24);
    b[28] = 0x1d;
    hmacSha1(this.hmacKey(), b.subarray(0, 32)).copy(b, 32);
    return b;
  }

  msgKeepaliveCC51() {
    this.kaSeq += 2;
    const b = Buffer.alloc(CC51.KA_SIZE);
    MAGIC_CC51.copy(b);
    b.writeUInt16LE(CC51.KA, 4);
    b.writeUInt16LE(0x0024, 6);
    b.writeUInt32LE(this.kaSeq, 16);
    this.sid.copy(b, 20);
    hmacSha1(this.hmacKey(), b.subarray(0, 28)).copy(b, 28);
    return b;
  }

  msgKeepalive(incoming) {
    const b = Buffer.alloc(24);
    Buffer.from([0x04, 0x02, 0x1a, 0x0a]).copy(b);
    b.writeUInt16LE(8, 4);
    b.writeUInt16LE(CMD.KA_REQ, 8);
    b.writeUInt16LE(0x0021, 10);
    if (incoming.length >= 8) incoming.copy(b, 16, 0, 8);
    return b;
  }

  msgSession() {
    const b = Buffer.alloc(16 + 36);
    Buffer.from([0x04, 0x02, 0x1a, 0x02]).copy(b);
    b.writeUInt16LE(36, 4);
    b.writeUInt16LE(CMD.SESSION_REQ, 8);
    b.writeUInt16LE(0x0033, 10);
    const body = b.subarray(16);
    this.uid.copy(body, 0, 0, 20);
    this.sid.copy(body, 20);
    body.writeUInt32LE(Math.floor(Date.now() / 1000), 32);
    return b;
  }

  msgTxData(payload, channel) {
    const bodySize = 12 + payload.length;
    const b = Buffer.alloc(16 + bodySize);
    Buffer.from([0x04, 0x02, 0x1a, 0x0b]).copy(b);
    b.writeUInt16LE(bodySize, 4);
    b.writeUInt16LE(this.seq++ & 0xffff, 6);
    b.writeUInt16LE(CMD.DATA_TX, 8);
    b.writeUInt16LE(0x0021, 10);
    this.sid.copy(b, 12, 0, 2);
    b[14] = channel;
    b[15] = 0x01;
    b.writeUInt32LE(0x0c, 16);
    this.sid.copy(b, 20, 0, 8);
    payload.copy(b, 28);
    return b;
  }

  msgTxDataCC51(payload, channel) {
    const b = Buffer.alloc(CC51.HEADER + payload.length + CC51.AUTH);
    MAGIC_CC51.copy(b);
    b.writeUInt16LE(CC51.DTLS, 4);
    b.writeUInt16LE(16 + payload.length + CC51.AUTH, 6);
    b.writeUInt16LE(0x0010 | (channel << 8), 12);
    b.writeUInt16LE(this.ticket, 14);
    this.sid.copy(b, 16, 0, 8);
    b.writeUInt32LE(1, 24);
    payload.copy(b, CC51.HEADER);
    hmacSha1(this.hmacKey(), b.subarray(0, CC51.HEADER)).copy(b, CC51.HEADER + payload.length);
    return b;
  }

  // ---- receiving ----

  onPacket(buf, rinfo) {
    if (rinfo.address !== this.host) return;
    if (rinfo.port !== this.port) this.port = rinfo.port;
    for (const l of this.listeners) l(buf);
    if (!this.attached) return;
    if (this.isCC51) {
      if (buf.length >= 12 && buf[0] === 0x51 && buf[1] === 0xcc) {
        const cmd = buf.readUInt16LE(4);
        if (cmd === CC51.KA && buf.length >= CC51.KA_SIZE) this.raw(this.msgKeepaliveCC51());
        else if (cmd === CC51.DTLS && buf.length >= CC51.HEADER + CC51.AUTH) {
          const ch = buf.readUInt16LE(12) >> 8;
          if (ch === 0) this.dtls.onDatagram(buf.subarray(CC51.HEADER, buf.length - CC51.AUTH));
        }
      }
      return;
    }
    const data = reverseTransCodeBlob(buf);
    if (data.length < 16) return;
    const cmd = data.readUInt16LE(8);
    if (cmd === CMD.KA_RES && data.length > 24) this.write(this.msgKeepalive(data.subarray(16)));
    else if (cmd === CMD.DATA_RX && data.length > 28 && data[14] === 0) this.dtls.onDatagram(data.subarray(28));
  }

  waitFor(match, resendFn, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const listener = (buf) => { const r = match(buf); if (r) { cleanup(); resolve(r); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout: ${label}`)); }, timeoutMs);
      const resend = resendFn ? setInterval(resendFn, 100) : null;
      const cleanup = () => { clearTimeout(timer); if (resend) clearInterval(resend); this.listeners.delete(listener); };
      this.listeners.add(listener);
      if (resendFn) resendFn();
    });
  }

  async connect(timeoutMs) {
    const pktIotc = transCodeBlob(this.msgDisco(1));
    const pktCc51 = this.msgDiscoCC51(0, 0, false);
    const found = await this.waitFor((buf) => {
      if (buf.length >= CC51.SIZE && buf[0] === 0x51 && buf[1] === 0xcc && buf.readUInt16LE(4) === CC51.DISCO) {
        return { cc51: true, buf };
      }
      const data = reverseTransCodeBlob(buf);
      if (data.length >= 16 && data.readUInt16LE(8) === CMD.DISCO_RES) return { cc51: false, buf: data };
      return null;
    }, () => { this.raw(pktIotc); this.raw(pktCc51); }, timeoutMs, "no discovery reply from the camera (wrong IP, other VLAN or UDP blocked?)");

    if (found.cc51) {
      this.isCC51 = true;
      this.ticket = found.buf.readUInt16LE(14);
      if (found.buf.length >= 24) found.buf.copy(this.sid, 0, 16, 24);
      vlog("camera answers in CC51 form");
      await this.waitFor((buf) => {
        if (buf.length < CC51.SIZE || buf[0] !== 0x51 || buf[1] !== 0xcc) return null;
        return buf.readUInt16LE(4) === CC51.DISCO && buf.readUInt16LE(8) === 0xffff && buf.readUInt16LE(12) === 3 ? true : null;
      }, () => this.write(this.msgDiscoCC51(2, this.ticket, false)), timeoutMs, "CC51 discovery stage 2");
    } else {
      this.isCC51 = false;
      vlog("camera answers in IOTC form");
      this.write(this.msgDisco(2));
      await new Promise((r) => setTimeout(r, 100));
      await this.waitFor((buf) => {
        const data = reverseTransCodeBlob(buf);
        return data.length >= 16 && data.readUInt16LE(8) === CMD.SESSION_RES ? true : null;
      }, () => this.write(this.msgSession()), timeoutMs, "IOTC session response");
    }
  }

  attach(dtls) {
    this.dtls = dtls;
    this.attached = true;
  }

  sendDtls(datagram) {
    this.write(this.isCC51 ? this.msgTxDataCC51(datagram, 0) : this.msgTxData(datagram, 0));
  }

  close() {
    this.closedSocket = true;
    try { this.socket.close(); } catch (_) { /* already closed */ }
  }
}

// ---------------------------------------------------------------------------------------------
// AV login and K-command authentication, inside the DTLS tunnel
// ---------------------------------------------------------------------------------------------

const PROTO = 0x000c;
const DEFAULT_CAPS = 0x001f07fb;

class AvChannel {
  constructor(dtls, enr) {
    this.dtls = dtls;
    this.enr = enr;
    this.avSeq = 0;
    this.seqCmd = 0;
    this.ackFlags = 0;
    this.rxSeqStart = 0xffff;
    this.rxSeqEnd = 0xffff;
    this.rxSeqInit = false;
    this.cmdQueue = [];
    this.cmdWaiters = [];
    this.ackTimer = null;
  }

  avLogin(magic, size, flags, randomId) {
    const b = Buffer.alloc(size);
    b.writeUInt16LE(magic, 0);
    b.writeUInt16LE(PROTO, 2);
    b.writeUInt16LE(size - 24, 16);
    b.writeUInt16LE(flags, 18);
    randomId.copy(b, 20, 0, 4);
    Buffer.from("admin").copy(b, 24);
    Buffer.from(this.enr).copy(b, 280);
    b.writeUInt32LE(4, 540);
    b.writeUInt32LE(DEFAULT_CAPS, 552);
    return b;
  }

  msgAck() {
    this.ackFlags = (this.ackFlags + 1) & 0xffff;
    const b = Buffer.alloc(24);
    b.writeUInt16LE(0x0009, 0);
    b.writeUInt16LE(PROTO, 2);
    b.writeUInt32LE(this.avSeq++ >>> 0, 4);
    b.writeUInt16LE(this.rxSeqStart, 8);
    b.writeUInt16LE(this.rxSeqEnd, 10);
    if (this.rxSeqInit) this.rxSeqStart = this.rxSeqEnd;
    b.writeUInt16LE(this.ackFlags, 12);
    b.writeUInt32LE((this.ackFlags << 16) >>> 0, 16);
    b.writeUInt16LE(Date.now() & 0xffff, 20);
    return b;
  }

  msgIoctrl(payload) {
    const b = Buffer.alloc(40 + payload.length);
    b.writeUInt16LE(PROTO, 0);
    b.writeUInt16LE(PROTO, 2);
    b.writeUInt32LE(this.avSeq++ >>> 0, 4);
    b.writeUInt16LE(0x7000, 16);
    b.writeUInt16LE(this.seqCmd, 18);
    b.writeUInt32LE(1, 20);
    b.writeUInt32LE(payload.length + 4, 24);
    b.writeUInt32LE(this.seqCmd, 28);
    b[37] = 0x01;
    payload.copy(b, 40);
    this.seqCmd++;
    return b;
  }

  // Reads decrypted data from the tunnel until it is one we care about
  async nextData(timeoutMs) {
    const data = await this.dtls.read(timeoutMs);
    if (data.length < 2) return null;
    const magic = data.readUInt16LE(0);
    if (magic === 0x0009) return null; // ACK from the camera
    if (magic === PROTO && data.length >= 8) {
      const seq = data.readUInt16LE(4);
      this.rxSeqInit = true;
      if (seq > this.rxSeqEnd || this.rxSeqEnd === 0xffff) this.rxSeqEnd = seq;
    }
    return { magic, data };
  }

  async login(timeoutMs) {
    const randomId = crypto.randomBytes(8);
    const pkt1 = this.avLogin(0x0000, 570, 0x0001, randomId);
    const pkt2 = this.avLogin(0x2000, 572, 0x0000, randomId);
    pkt2[20]++;
    this.dtls.write(pkt1);
    await new Promise((r) => setTimeout(r, 10));
    this.dtls.write(pkt2);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = await this.nextData(deadline - Date.now());
      if (m && m.magic === 0x2100 && m.data.length >= 32) {
        this.dtls.write(this.msgAck());
        this.ackTimer = setInterval(() => { try { this.dtls.write(this.msgAck()); } catch (_) { /* closed */ } }, 100);
        return { twoWay: m.data[31] === 1 };
      }
    }
    throw new Error("timeout: AV login response");
  }

  findHl(data) {
    for (const start of [32, 36]) {
      for (let i = start; i + 16 <= data.length; i++) if (data[i] === 0x48 && data[i + 1] === 0x4c) return data.subarray(i);
    }
    return null;
  }

  async command(payload, expectCmd, timeoutMs) {
    const frame = this.msgIoctrl(payload);
    this.dtls.write(frame);
    const resend = setInterval(() => { try { this.dtls.write(frame); } catch (_) { /* closed */ } }, 1000);
    try {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const m = await this.nextData(deadline - Date.now());
        if (!m) continue;
        this.dtls.write(this.msgAck());
        if (m.magic !== 0x7000 && m.magic !== 0x1000 && m.magic !== PROTO) continue;
        const hl = this.findHl(m.data);
        if (hl && hl.readUInt16LE(4) === expectCmd) return hl;
      }
      throw new Error(`timeout: K${expectCmd}`);
    } finally {
      clearInterval(resend);
    }
  }

  hl(cmd, body) {
    const b = Buffer.alloc(16 + body.length);
    b.write("HL", 0);
    b[2] = 5;
    b.writeUInt16LE(cmd, 4);
    b.writeUInt16LE(body.length, 6);
    body.copy(b, 16);
    return b;
  }

  async authenticate(timeoutMs) {
    const k10001 = await this.command(this.hl(10000, Buffer.from('{"cameraInfo":{"audioEncoderList":[137,138,140]}}')), 10001, timeoutMs);
    if (k10001.length < 33) throw new Error(`K10001 too short (${k10001.length} bytes)`);
    const status = k10001[16];
    const challenge = Buffer.from(k10001.subarray(17, 33));
    vlog(`K10001 challenge received, status ${status}`);
    const resp = challengeResponse(challenge, this.enr, status);
    const body = Buffer.alloc(22);
    resp.copy(body, 0, 0, 16);
    crypto.randomBytes(4).copy(body, 16);
    body[20] = 1;
    body[21] = 1;
    const reply = this.hl(10002, body);
    reply.writeUInt16LE(22, 6);
    const k10003 = await this.command(reply, 10003, timeoutMs);
    const text = k10003.subarray(16).toString("latin1");
    const brace = text.indexOf("{");
    let info = null;
    if (brace >= 0) { try { info = JSON.parse(text.slice(brace)); } catch (_) { /* not JSON */ } }
    return { status, info };
  }

  // Phase 2: night vision. K10040 asks, K10041 answers with the value; K10042 sets, K10043 answers.
  async getNightVision(timeoutMs) {
    const hl = await this.command(this.hl(10040, Buffer.alloc(0)), 10041, timeoutMs);
    const len = hl.readUInt16LE(6);
    vlog(`K10041 payload length ${len}, bytes ${hl.subarray(16, 16 + Math.min(len, 8)).toString("hex")}`);
    return hl[16];
  }

  async setNightVision(value, timeoutMs) {
    const hl = await this.command(this.hl(10042, Buffer.from([value])), 10043, timeoutMs);
    const len = hl.readUInt16LE(6);
    vlog(`K10043 payload length ${len}, bytes ${hl.subarray(16, 16 + Math.min(len, 8)).toString("hex")}`);
    return hl[16];
  }

  // A read-only query. K10020 needs the list of parameter ids it should return.
  async query(cmd, timeoutMs) {
    if (!READ_ONLY_COMMANDS[cmd]) throw new Error(`K${cmd} is not in the read-only list`);
    let body = Buffer.alloc(0);
    if (cmd === 10020) {
      body = Buffer.alloc(61);
      body[0] = 60;
      for (let i = 1; i <= 60; i++) body[i] = i;
    }
    const hl = await this.command(this.hl(cmd, body), cmd + 1, timeoutMs);
    return hl.subarray(16, 16 + hl.readUInt16LE(6));
  }

  close() { clearInterval(this.ackTimer); }
}

// Get commands only. --query refuses anything else, so it cannot change a camera.
const READ_ONLY_COMMANDS = {
  10020: "camera params (settings)", 10030: "status light", 10040: "night vision", 10044: "infrared LED",
  10050: "video params", 10070: "timestamp overlay", 10074: "logo overlay", 10090: "camera time",
  10200: "motion alarm", 10290: "motion tagging", 10446: "connection status", 10448: "battery usage",
  10604: "RTSP params", 10620: "night check", 10624: "auto night switch type", 10632: "alarm flashing",
  10640: "spotlight", 10720: "accessories", 10788: "integrated floodlight", 10820: "white light",
};
const PRIVATE_FIELD = /mac|ip$|^ip|ssid|uid|enr|p2p|key|token|pass|did$|sn$|serial|bssid|email|auth/i;

function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = PRIVATE_FIELD.test(k) ? "<hidden>" : redact(x);
    return o;
  }
  return v;
}

function describePayload(buf) {
  const text = buf.toString("latin1");
  const brace = text.search(/[{[]/);
  if (brace >= 0) {
    try { return JSON.stringify(redact(JSON.parse(text.slice(brace)))); } catch (_) { /* not JSON */ }
  }
  const hex = buf.subarray(0, 64).toString("hex");
  const num = buf.length === 4 ? ` (uint32 ${buf.readUInt32LE(0)})` : buf.length === 1 ? ` (byte ${buf[0]})` : "";
  return `${buf.length} bytes: ${hex}${buf.length > 64 ? "..." : ""}${num}`;
}

const NV_NAMES = { 1: "on", 2: "off", 3: "auto" };
const NV_VALUES = { on: 1, off: 2, auto: 3 };

// ---------------------------------------------------------------------------------------------
// Camera details from the Wyze cloud (read only), then run
// ---------------------------------------------------------------------------------------------

async function cameraFromCloud() {
  const root = path.join(__dirname, "..", "..", "..");
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  const WyzeAPI = require(path.join(root, "src", "index"));
  const wyze = new WyzeAPI({ username: process.env.USERNAME, password: process.env.PASSWORD, keyId: process.env.KEY_ID, apiKey: process.env.API_KEY, logLevel: "error" });
  const list = (await wyze.getObjectList()).data.device_list;
  const model = opt("model", "HL_DB2");
  const name = typeof opt("name", null) === "string" ? opt("name").toLowerCase() : null;
  const cam = list.find((d) => d.product_model === model && (!name || d.nickname.toLowerCase().includes(name)));
  if (!cam) throw new Error(`no ${model} camera in the Wyze device list`);
  const p = cam.device_params || {};
  return { nickname: cam.nickname, model: cam.product_model, mac: cam.mac, enr: cam.enr, uid: p.p2p_id, ip: p.ip, dtls: p.dtls };
}

async function main() {
  const cam = await cameraFromCloud();
  const host = typeof opt("host", null) === "string" ? opt("host") : cam.ip;
  const port = Number(opt("port", 32761));
  log(`Camera: ${cam.nickname} (${cam.model}), dtls flag ${cam.dtls}, address ${host}:${port}`);
  if (!cam.enr || !cam.uid || !host) throw new Error("the Wyze device list is missing enr, P2P id or IP for this camera");
  if (cam.dtls !== 1) log("Note: this camera does not have the dtls flag; the DTLS step may not apply to it.");

  const session = new Session({ host, port, uid: cam.uid, authKey: calculateAuthKey(cam.enr, cam.mac), enr: cam.enr });
  let av = null;
  try {
    log("1. Discovery and session ...");
    await session.connect(TIMEOUT_MS);
    log(`   ok (${session.isCC51 ? "CC51" : "IOTC"} form)`);

    log("2. DTLS handshake (ECDHE-PSK, ChaCha20-Poly1305) ...");
    const dtls = new DtlsClient((d) => session.sendDtls(d), derivePsk(cam.enr));
    session.attach(dtls);
    dtls.start();
    await Promise.race([dtls.done, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: DTLS handshake")), TIMEOUT_MS))]);
    log("   ok");

    log("3. AV login ...");
    av = new AvChannel(dtls, cam.enr);
    const login = await av.login(TIMEOUT_MS);
    log(`   ok (two-way audio: ${login.twoWay})`);

    log("4. K10000 to K10003 authentication ...");
    const auth = await av.authenticate(TIMEOUT_MS);
    log(`   ok (challenge status ${auth.status})`);
    if (auth.info) {
      const basic = auth.info.cameraInfo && auth.info.cameraInfo.basicInfo;
      log("   camera replied with keys:", Object.keys(auth.info).join(", "));
      if (basic) log(`   firmware ${basic.firmware}, model ${basic.model}`);
    }
    const queryArg = opt("query", null);
    if (typeof queryArg === "string") {
      log("5. Read-only queries ...");
      for (const code of queryArg.split(",").map((x) => Number(x.trim().replace(/^K/i, "")))) {
        if (!READ_ONLY_COMMANDS[code]) { log(`   K${code}: refused, not a read-only get command`); continue; }
        try {
          const payload = await av.query(code, Number(opt("query-timeout", 4000)));
          log(`   K${code} ${READ_ONLY_COMMANDS[code]}: ${describePayload(payload)}`);
        } catch (e) {
          log(`   K${code} ${READ_ONLY_COMMANDS[code]}: ${e.message}`);
        }
      }
      log("\nREAD ONLY: nothing was written to the camera.");
      return 0;
    }
    const setArg = opt("set", null);
    if (setArg !== null && !(typeof setArg === "string" && NV_VALUES[setArg.toLowerCase()])) {
      throw new Error("--set needs on, off or auto");
    }
    if (args.includes("--night-vision") || setArg !== null) {
      log("5. Night vision (K10040) ...");
      const before = await av.getNightVision(TIMEOUT_MS);
      log(`   currently ${before} (${NV_NAMES[before] || "unknown value"})`);
      if (setArg !== null) {
        const target = NV_VALUES[setArg.toLowerCase()];
        log(`6. Setting night vision to ${setArg.toLowerCase()} (K10042) ...`);
        const result = await av.setNightVision(target, TIMEOUT_MS);
        log(`   camera answered ${result}`);
        const after = await av.getNightVision(TIMEOUT_MS);
        log(`   read back ${after} (${NV_NAMES[after] || "unknown value"}) ${after === target ? "- matches" : "- DOES NOT MATCH"}`);
        if (args.includes("--restore") && before !== after) {
          log(`7. Restoring the previous value (${NV_NAMES[before] || before}) ...`);
          await av.setNightVision(before, TIMEOUT_MS);
          const restored = await av.getNightVision(TIMEOUT_MS);
          log(`   read back ${restored} (${NV_NAMES[restored] || "unknown value"}) ${restored === before ? "- restored" : "- NOT RESTORED, set it in the Wyze app"}`);
        }
        return after === target ? 0 : 1;
      }
      log("\nREAD ONLY: nothing was written to the camera.");
      return 0;
    }
    log("\nAUTHENTICATED. Nothing was written to the camera.");
    return 0;
  } finally {
    if (av) av.close();
    session.close();
  }
}

/**
 * Everything device-report.js needs from one camera, without printing anything: can it be reached, does
 * the DTLS session and the K10000 to K10003 authentication work, and what do the read-only commands in
 * `codes` answer. It never sends a setting. The result holds no address, id or key.
 */
const DEFAULT_PROBE_CODES = [10020, 10030, 10040, 10044, 10050, 10070, 10074, 10200, 10290, 10446, 10448, 10604, 10620, 10624, 10632, 10640, 10720, 10788, 10820];

function answerSummary(buf) {
  const text = buf.toString("latin1");
  const brace = text.search(/[{[]/);
  if (brace >= 0) {
    try { return redact(JSON.parse(text.slice(brace))); } catch (_) { /* not JSON */ }
  }
  // Bytes are spaced apart, so a short answer never looks like a MAC address to the report's scrubber.
  const out = { bytes: buf.length, hex: buf.subarray(0, 32).toString("hex").replace(/(..)(?=.)/g, "$1 ") };
  if (buf.length === 1) out.value = buf[0];
  if (buf.length === 4) out.uint32 = buf.readUInt32LE(0);
  return out;
}

async function probeCamera({ host, port = 32761, uid, enr, mac, timeoutMs = 8000, queryTimeoutMs = 2000, codes = DEFAULT_PROBE_CODES }) {
  const result = { reachable: false, sessionForm: null, dtlsHandshake: false, avLogin: false, authenticated: false };
  const session = new Session({ host, port, uid, authKey: calculateAuthKey(enr, mac), enr });
  let dtls = null;
  let av = null;
  const within = (promise, label) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), timeoutMs))]);
  try {
    await session.connect(timeoutMs);
    result.reachable = true;
    result.sessionForm = session.isCC51 ? "CC51" : "IOTC";
    dtls = new DtlsClient((d) => session.sendDtls(d), derivePsk(enr));
    session.attach(dtls);
    dtls.start();
    await within(dtls.done, "DTLS handshake");
    result.dtlsHandshake = true;
    av = new AvChannel(dtls, enr);
    await av.login(timeoutMs);
    result.avLogin = true;
    const auth = await av.authenticate(timeoutMs);
    result.authenticated = true;
    result.challengeStatus = auth.status;
    const basic = auth.info && auth.info.cameraInfo && auth.info.cameraInfo.basicInfo;
    if (basic) result.camera = { firmware: basic.firmware, model: basic.model, hardware: basic.hardware };
    result.answers = {};
    for (const code of codes) {
      if (!READ_ONLY_COMMANDS[code]) continue; // only get commands are ever sent
      try {
        result.answers[`K${code}`] = { meaning: READ_ONLY_COMMANDS[code], answer: answerSummary(await av.query(code, queryTimeoutMs)) };
      } catch (e) {
        result.answers[`K${code}`] = { meaning: READ_ONLY_COMMANDS[code], answer: null };
      }
    }
  } catch (e) {
    result.error = e.message;
  } finally {
    if (av) av.close();
    if (dtls) dtls.close();
    session.close();
  }
  return result;
}

module.exports = { probeCamera, DEFAULT_PROBE_CODES, READ_ONLY_COMMANDS };

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`\nFAILED: ${e.message}`);
    process.exit(1);
  });
}
