"use strict";

/**
 * Remembers the packets of the most recent complete keyframe of a video stream, so a
 * picture can be made from an open connection without asking the camera for anything.
 *
 * A frame is the run of packets that share one RTP timestamp; a keyframe is a frame that
 * starts with an SPS or IDR slice. A frame is complete when a packet with a different
 * timestamp follows it.
 */
class KeyframeTracker {
  /** @param {{maxPackets?: number}} [opts] most packets kept for one frame (a longer one is not kept) */
  constructor({ maxPackets = 800 } = {}) {
    this.maxPackets = maxPackets;
    this.building = null; // { ts, packets, at, overflow }
    this.latest = null; // { ts, packets, at } — the last complete keyframe
  }

  /**
   * @param {Buffer} packet the serialized RTP packet
   * @param {number} timestamp its RTP timestamp
   * @param {boolean} startsKeyframe it carries an SPS or an IDR slice
   */
  push(packet, timestamp, startsKeyframe, now = Date.now()) {
    if (this.building && this.building.ts !== timestamp) {
      if (!this.building.overflow) this.latest = { ts: this.building.ts, packets: this.building.packets, at: this.building.at };
      this.building = null;
    }
    if (!this.building) {
      if (!startsKeyframe) return;
      this.building = { ts: timestamp, packets: [], at: now, overflow: false };
    }
    if (this.building.packets.length >= this.maxPackets) {
      this.building.overflow = true;
      return;
    }
    this.building.packets.push(packet);
  }
}

module.exports = { KeyframeTracker };
