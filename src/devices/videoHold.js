"use strict";

/**
 * Keeps a camera's video packets until ffmpeg is ready to take them.
 *
 * The camera sends its first keyframe (with the SPS/PPS) the moment the stream is up, which
 * is before ffmpeg has started and bound its port, so the first keyframe used to be lost
 * and a second one had to be requested. This holds everything from the first keyframe on,
 * and `release()` hands it over in order, then lets packets pass straight through.
 * Packets before the first keyframe are dropped: no decoder can use them.
 */
class VideoHold {
  /**
   * @param {object} opts
   * @param {(packet:Buffer)=>void} opts.send — called with each packet, in order
   * @param {number} [opts.max=1500] — most packets held; at that point it releases itself
   * @param {(first:Buffer)=>(Buffer|null)} [opts.prefix] — given the first held packet, may return
   *        one more packet to send before it (the parameter sets a keyframe needs to be decoded)
   */
  constructor({ send, max = 1500, prefix = null }) {
    this.send = send;
    this.max = max;
    this.prefix = prefix;
    this.held = [];
    this.holding = true;
    this.started = false; // a keyframe has been seen
  }

  push(packet, startsKeyframe) {
    if (!this.holding) return this.send(packet);
    if (!this.started) {
      if (!startsKeyframe) return;
      this.started = true;
    }
    this.held.push(packet);
    if (this.held.length >= this.max) this.release();
  }

  /** Hand over what is held and stop holding. `hadKeyframe` says whether it began with one. */
  release() {
    const hadKeyframe = this.started;
    if (this.holding) {
      this.holding = false;
      const held = this.held;
      this.held = [];
      if (this.prefix && held.length > 0) {
        const extra = this.prefix(held[0]);
        if (extra) this.send(extra);
      }
      for (const packet of held) this.send(packet);
    }
    return { hadKeyframe };
  }
}

module.exports = { VideoHold };
