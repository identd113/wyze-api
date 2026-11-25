"use strict";

/**
 * Puts an RTP audio stream back in order before it is handed to ffmpeg.
 *
 * Wyze audio arrives over WebRTC with no jitter buffer in between, so a late or lost
 * packet reaches ffmpeg as a hole in the sequence numbers ("RTP: missed N packets",
 * "Queue input is backward in time") and is heard as crackle. This buffer:
 *
 *   - passes packets through immediately while they arrive in order (no added delay),
 *   - holds a packet that arrives early for up to `maxWaitMs`, giving the missing one
 *     time to show up, and releases them in sequence order,
 *   - when a packet never arrives, fills its slot with silence (same sequence number,
 *     same timestamp step), so ffmpeg always sees a continuous stream,
 *   - drops duplicates and packets that arrive after their slot was already filled.
 *
 * It is a pure data structure: time is passed in, and packets are built through
 * `makePacket`, so it can be tested without sockets or timers.
 */

const SEQ_MOD = 0x10000;
const TS_MOD = 0x100000000;

/** Signed distance from `from` to `to` on the 16-bit sequence circle. */
function seqDelta(to, from) {
  const d = (to - from + SEQ_MOD) % SEQ_MOD;
  return d >= SEQ_MOD / 2 ? d - SEQ_MOD : d;
}

class RtpReorderBuffer {
  /**
   * @param {object} opts
   * @param {(pkt:object)=>void} opts.send — called with each packet, in order
   * @param {(template:object, seq:number, ts:number, payload:Buffer)=>object} opts.makePacket
   *        builds a replacement packet (used for silence)
   * @param {number} [opts.maxWaitMs=80] — how long to wait for a missing packet
   * @param {number} [opts.maxConceal=10] — most silent packets inserted for one gap;
   *        a longer gap is jumped over instead of filled
   * @param {number} [opts.maxHeld=60] — safety cap on held packets
   * @param {number} [opts.silenceByte=0xff] — PCMU silence (mu-law zero). PCMA uses 0xd5; other codecs are not concealed
   * @param {{name:string, clockRate?:number}|null} [opts.codec] — the audio codec the camera negotiated (from the SDP
   *        answer). Wyze answers PCMU on a dynamic payload type (96), which the packet alone cannot tell from video, so the
   *        codec decides what silence is. Can be given later with `setCodec`.
   * @param {number} [opts.maxLate=20] — this many late packets in a row mean the sender restarted its numbering (a
   *        backward jump of less than half the range looks like "late" for ever), so the buffer restarts from the new number
   */
  constructor({ send, makePacket, maxWaitMs = 80, maxConceal = 10, maxHeld = 60, silenceByte = 0xff, codec = null, maxLate = 20 }) {
    this.send = send;
    this.makePacket = makePacket;
    this.maxWaitMs = maxWaitMs;
    this.maxConceal = maxConceal;
    this.maxHeld = maxHeld;
    this.silenceByte = silenceByte;
    this.maxLate = maxLate;
    this.lateRun = 0;
    this.codec = null;
    this.setCodec(codec);
    this.held = new Map(); // seq -> { pkt, at }
    this.nextSeq = null;
    this.lastTemplate = null;
    this.nextTs = null; // timestamp the next packet should carry
    this.stats = { received: 0, inOrder: 0, reordered: 0, duplicate: 0, late: 0, concealed: 0, jumped: 0 };
  }

  /** Tell the buffer which codec was negotiated (see the constructor); null goes back to reading the payload type. */
  setCodec(codec) {
    this.codec = codec && typeof codec.name === "string" ? codec : null;
  }

  /**
   * The byte that is silence for this RTP payload type, or null when it is not a codec whose silence is known.
   * With a negotiated codec that decides, whatever the payload type: only 8 kHz G.711 is one byte per sample.
   */
  silenceFor(payloadType) {
    if (this.codec) {
      const name = this.codec.name.toUpperCase();
      if (this.codec.clockRate && this.codec.clockRate !== 8000) return null;
      if (name === "PCMU") return this.silenceByte;
      if (name === "PCMA") return 0xd5;
      return null;
    }
    if (payloadType === 0) return this.silenceByte; // PCMU: mu-law zero, 0xff
    if (payloadType === 8) return 0xd5; // PCMA: A-law zero
    return null;
  }

  /** True while packets are being held (the caller should keep calling `tick`). */
  get waiting() {
    return this.held.size > 0;
  }

  push(pkt, now) {
    const seq = pkt.header.sequenceNumber;
    this.stats.received += 1;
    // A new SSRC is a new stream: its numbering has nothing to do with the old one.
    if (this.lastTemplate && pkt.header.ssrc !== this.lastTemplate.header.ssrc) this._restart();
    if (this.nextSeq === null) {
      this.nextSeq = seq;
    }
    let d = seqDelta(seq, this.nextSeq);
    if (d < 0) {
      this.stats.late += 1; // its slot was already played (or filled with silence)
      this.lateRun += 1;
      if (this.lateRun < this.maxLate) return;
      // So many in a row are not late, the numbering restarted: carry on from here.
      this._restart();
      this.nextSeq = seq;
      d = 0;
    }
    this.lateRun = 0;
    if (this.held.has(seq)) {
      this.stats.duplicate += 1;
      return;
    }
    if (d === 0) this.stats.inOrder += 1;
    else this.stats.reordered += 1;
    this.held.set(seq, { pkt, at: now });
    this._drain(now);
  }

  /** Call regularly while `waiting` is true. */
  tick(now) {
    this._drain(now);
  }

  /** Release everything still held (stream ending). */
  flush() {
    const seqs = [...this.held.keys()].sort((a, b) => seqDelta(a, this.nextSeq) - seqDelta(b, this.nextSeq));
    for (const s of seqs) {
      const e = this.held.get(s);
      this.held.delete(s);
      this._emit(e.pkt);
      this.nextSeq = (s + 1) % SEQ_MOD;
    }
  }

  /** Release what is held and forget the old numbering (the sender restarted). */
  _restart() {
    this.flush();
    this.nextSeq = null;
    this.nextTs = null;
    this.lastTemplate = null;
    this.lateRun = 0;
    this.stats.restarted = (this.stats.restarted || 0) + 1;
  }

  _emit(pkt) {
    this.lastTemplate = pkt;
    this.nextTs = (pkt.header.timestamp + pkt.payload.length) % TS_MOD;
    this.send(pkt);
  }

  _drain(now) {
    for (;;) {
      const e = this.held.get(this.nextSeq);
      if (e) {
        this.held.delete(this.nextSeq);
        this._emit(e.pkt);
        this.nextSeq = (this.nextSeq + 1) % SEQ_MOD;
        continue;
      }
      if (this.held.size === 0) return;

      // A packet is missing. Decide whether to keep waiting for it.
      let oldest = Infinity;
      for (const h of this.held.values()) if (h.at < oldest) oldest = h.at;
      const waited = now - oldest;
      if (waited < this.maxWaitMs && this.held.size < this.maxHeld) return;

      // Give up on it: play silence in its place, or jump a long gap.
      const nearest = [...this.held.keys()].reduce(
        (best, s) => (seqDelta(s, this.nextSeq) < seqDelta(best, this.nextSeq) ? s : best)
      );
      const gap = seqDelta(nearest, this.nextSeq);
      // Silence is only known for the 8 kHz G.711 codecs, one byte per sample (PCMU and PCMA). For anything else (Opus, a
      // dynamic payload type) a made-up packet would be an invalid frame with a wrong timestamp step, so the gap is jumped.
      const silenceByte = this.lastTemplate ? this.silenceFor(this.lastTemplate.header.payloadType) : null;
      if (gap > this.maxConceal || !this.lastTemplate || silenceByte === null) {
        this.stats.jumped += 1;
        this.nextSeq = nearest;
        continue;
      }
      const size = this.lastTemplate.payload.length;
      const silence = Buffer.alloc(size, silenceByte);
      this.stats.concealed += 1;
      const filler = this.makePacket(this.lastTemplate, this.nextSeq, this.nextTs, silence);
      this.nextSeq = (this.nextSeq + 1) % SEQ_MOD;
      this.lastTemplate = filler;
      this.nextTs = (this.nextTs + size) % TS_MOD;
      this.send(filler);
    }
  }
}

module.exports = { RtpReorderBuffer, seqDelta };
