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
   * @param {number} [opts.silenceByte=0xff] — PCMU silence (mu-law zero)
   */
  constructor({ send, makePacket, maxWaitMs = 80, maxConceal = 10, maxHeld = 60, silenceByte = 0xff }) {
    this.send = send;
    this.makePacket = makePacket;
    this.maxWaitMs = maxWaitMs;
    this.maxConceal = maxConceal;
    this.maxHeld = maxHeld;
    this.silenceByte = silenceByte;
    this.held = new Map(); // seq -> { pkt, at }
    this.nextSeq = null;
    this.lastTemplate = null;
    this.nextTs = null; // timestamp the next packet should carry
    this.stats = { received: 0, inOrder: 0, reordered: 0, duplicate: 0, late: 0, concealed: 0, jumped: 0 };
  }

  /** True while packets are being held (the caller should keep calling `tick`). */
  get waiting() {
    return this.held.size > 0;
  }

  push(pkt, now) {
    const seq = pkt.header.sequenceNumber;
    this.stats.received += 1;
    if (this.nextSeq === null) {
      this.nextSeq = seq;
    }
    const d = seqDelta(seq, this.nextSeq);
    if (d < 0) {
      this.stats.late += 1; // its slot was already played (or filled with silence)
      return;
    }
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
      if (gap > this.maxConceal || !this.lastTemplate) {
        this.stats.jumped += 1;
        this.nextSeq = nearest;
        continue;
      }
      const size = this.lastTemplate.payload.length;
      const silence = Buffer.alloc(size, this.silenceByte);
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
