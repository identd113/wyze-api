const nodeCrypto = require("crypto");
const fs = require("fs");
const { spawn } = require("child_process");
const {
  startRtpForwarding,
  pickFreeUdpPort,
  closeAllSessions,
  writeSdpFile,
  writeAudioSdpFile,
  resolveFfmpegPath,
  localIpAddress,
} = require("./cameraStreamCapture");
const {
  propertyIds: PIDs,
  propertyValues: PVals,
  DeviceModels,
  DeviceMgmtToggleProps,
} = require("../types");

/**
 * Camera helpers — pure device-object accessors, convenience lookup wrappers,
 * stream utility functions, and thin-wrapper controls. None of the functions
 * here contain branching logic or direct API calls (those live in cameras.js).
 */
module.exports = {
  // ---- Model-branching controls --------------------------------------------

  async cameraTurnOn(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "power", "wakeup");
    }
    await this.runAction(deviceMac, deviceModel, "power_on");
  },

  async cameraTurnOff(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "power", "sleep");
    }
    await this.runAction(deviceMac, deviceModel, "power_off");
  },

  async cameraSirenOn(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "siren", "siren-on");
    }
    await this.runAction(deviceMac, deviceModel, "siren_on");
  },

  async cameraSirenOff(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "siren", "siren-off");
    }
    await this.runAction(deviceMac, deviceModel, "siren_off");
  },

  // Models whose integrated light is exposed as a "spotlight" capability on
  // the devicemgmt API (everything else on that API uses "floodlight").
  // Mirrors SecKatie/wyzeapy CameraService.floodlight_on/off.
  async _cameraLightSet(deviceMac, deviceModel, on) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      const type = DeviceModels.CAMERA_DEVICEMGMT_SPOTLIGHT.includes(deviceModel) ? "spotlight" : "floodlight";
      return this._deviceMgmtRunAction(deviceMac, deviceModel, type, on ? "1" : "0");
    }
    if (DeviceModels.CAMERA_LIGHT_RUN_ACTION.includes(deviceModel)) {
      // Bulb Cam: P1056 can be read but not written - the light is driven by run_action.
      return this.runAction(deviceMac, deviceModel, on ? "floodlight_on" : "floodlight_off");
    }
    await this.setProperty(
      deviceMac,
      deviceModel,
      PIDs.CAMERA_FLOOD_LIGHT,
      on ? PVals.CAMERA_FLOOD_LIGHT.ON : PVals.CAMERA_FLOOD_LIGHT.OFF
    );
  },

  async cameraFloodLightOn(deviceMac, deviceModel) {
    return this._cameraLightSet(deviceMac, deviceModel, true);
  },

  async cameraFloodLightOff(deviceMac, deviceModel) {
    return this._cameraLightSet(deviceMac, deviceModel, false);
  },

  /**
   * Current state of a devicemgmt-API camera as
   * { motion, floodlight, siren, notify, on, available }.
   */
  async cameraGetDeviceMgmtState(deviceMac, deviceModel) {
    const response = await this._deviceMgmtGetIotProp(deviceMac, deviceModel);
    return this._deviceMgmtParseState(response);
  },

  async cameraMotionOn(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, DeviceMgmtToggleProps.EVENT_RECORDING_TOGGLE, "1"
      );
    }
    if (
      DeviceModels.CAMERA_OUTDOOR.includes(deviceModel) ||
      DeviceModels.CAMERA_OUTDOOR_V2.includes(deviceModel)
    ) {
      return this.setProperty(deviceMac, deviceModel, PIDs.WCO_MOTION_DETECTION, "1");
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION_STATE, 1);
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION, 1);
  },

  async cameraMotionOff(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, DeviceMgmtToggleProps.EVENT_RECORDING_TOGGLE, "0"
      );
    }
    if (
      DeviceModels.CAMERA_OUTDOOR.includes(deviceModel) ||
      DeviceModels.CAMERA_OUTDOOR_V2.includes(deviceModel)
    ) {
      return this.setProperty(deviceMac, deviceModel, PIDs.WCO_MOTION_DETECTION, "0");
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION_STATE, 0);
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION, 0);
  },

  async cameraNotificationsOn(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, DeviceMgmtToggleProps.NOTIFICATION_TOGGLE, "1"
      );
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, "1");
  },

  async cameraNotificationsOff(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, DeviceMgmtToggleProps.NOTIFICATION_TOGGLE, "0"
      );
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, "0");
  },

  // ---- Thin-wrapper controls -----------------------------------------------

  // Raw-value entry points ("power_on" / "siren_on" / "1" ...). Cameras on the
  // devicemgmt API don't answer run_action/set_property, so they are routed to
  // the model-aware On/Off methods; all other models keep the original behavior.
  async cameraPrivacy(deviceMac, deviceModel, value) {
    if (this.cameraUsesDeviceMgmt(deviceModel)) {
      return value === "power_on"
        ? this.cameraTurnOn(deviceMac, deviceModel)
        : this.cameraTurnOff(deviceMac, deviceModel);
    }
    await this.runAction(deviceMac, deviceModel, value);
  },

  async cameraRestart(deviceMac, deviceModel) {
    return this.runAction(deviceMac, deviceModel, "restart");
  },

  /**
   * Open or close the garage door (single trigger action).
   */
  async garageDoor(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "garage_door_trigger");
  },

  async cameraSiren(deviceMac, deviceModel, value) {
    if (this.cameraUsesDeviceMgmt(deviceModel)) {
      return value === "siren_on"
        ? this.cameraSirenOn(deviceMac, deviceModel)
        : this.cameraSirenOff(deviceMac, deviceModel);
    }
    await this.runAction(deviceMac, deviceModel, value);
  },

  // Raw-value entry points (value is the P1056 value: "1" on, "2" off). Models
  // that don't accept P1056 writes (devicemgmt cameras, Bulb Cam) are routed
  // through _cameraLightSet; everything else keeps the original behavior.
  async cameraFloodLight(deviceMac, deviceModel, value) {
    if (this._cameraLightUsesActionApi(deviceModel)) {
      return this._cameraLightSet(deviceMac, deviceModel, String(value) === "1");
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, value);
  },

  async cameraSpotLight(deviceMac, deviceModel, value) {
    return this.cameraFloodLight(deviceMac, deviceModel, value);
  },

  /** True for cameras controlled and read through the devicemgmt API. */
  cameraUsesDeviceMgmt(deviceModel) {
    return DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel);
  },

  /** False for cameras that can't be powered on/off through the API (see DeviceModels). */
  cameraSupportsPowerControl(deviceModel) {
    return !DeviceModels.CAMERA_NO_POWER_CONTROL.includes(deviceModel);
  },

  /** True for cameras with a doorbell button. */
  cameraIsDoorbell(deviceModel) {
    return DeviceModels.DOORBELL.includes(deviceModel);
  },

  _cameraLightUsesActionApi(deviceModel) {
    return this.cameraUsesDeviceMgmt(deviceModel) || DeviceModels.CAMERA_LIGHT_RUN_ACTION.includes(deviceModel);
  },

  async cameraSpotLightOn(deviceMac, deviceModel) {
    return this._cameraLightSet(deviceMac, deviceModel, true);
  },

  async cameraSpotLightOff(deviceMac, deviceModel) {
    return this._cameraLightSet(deviceMac, deviceModel, false);
  },

  async cameraSoundNotificationOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.SOUND_NOTIFICATION, "1");
  },

  async cameraSoundNotificationOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.SOUND_NOTIFICATION, "0");
  },

  async cameraNotifications(deviceMac, deviceModel, value) {
    if (this.cameraUsesDeviceMgmt(deviceModel)) {
      return String(value) === "1"
        ? this.cameraNotificationsOn(deviceMac, deviceModel)
        : this.cameraNotificationsOff(deviceMac, deviceModel);
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, value);
  },

  async cameraMotionRecording(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, value);
  },

  async cameraMotionRecordingOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, "1");
  },

  async cameraMotionRecordingOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, "0");
  },

  async cameraGetSignalingUrl(deviceMac, deviceModel, options = {}) {
    const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, options);
    return info.signaling_url;
  },

  async cameraGetIceServers(deviceMac, deviceModel, options = {}) {
    const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, options);
    return info.ice_servers;
  },

  // ---- Device-info pure accessors ------------------------------------------

  cameraGetSignalStrength(device) {
    return device?.device_params?.signal_strength ?? null;
  },

  cameraGetIp(device) {
    return device?.device_params?.ip ?? null;
  },

  cameraGetFirmware(device) {
    return device?.firmware_ver ?? null;
  },

  cameraGetTimezone(device) {
    return device?.timezone_name ?? null;
  },

  cameraGetLastSeen(device) {
    const ts = device?.device_params?.last_login_time;
    return typeof ts === "number" ? new Date(ts) : null;
  },

  // ---- Pure device-object accessors -----------------------------------------

  cameraIsOnline(device) {
    if (device?.conn_state !== undefined) return device.conn_state === 1;
    if (device?.device_params?.status !== undefined) return device.device_params.status === 1;
    if (device?.is_online !== undefined) return Boolean(device.is_online);
    return false;
  },

  cameraGetThumbnail(device) {
    const thumbnails = device?.device_params?.camera_thumbnails;
    if (Array.isArray(thumbnails) && thumbnails.length > 0) {
      return thumbnails[0]?.url ?? null;
    }
    return null;
  },

  cameraGetSnapshot(device) {
    const thumbnails = device?.device_params?.camera_thumbnails;
    if (Array.isArray(thumbnails) && thumbnails.length > 0) {
      return thumbnails[0] ?? null;
    }
    return null;
  },

  cameraToSummary(device) {
    return {
      mac: device?.mac,
      productModel: device?.product_model,
      nickname: device?.nickname,
      online: this.cameraIsOnline(device),
      thumbnail: this.cameraGetThumbnail(device),
    };
  },

  // ---- Convenience lookup wrappers ------------------------------------------

  async getCameras() {
    return this.getDevicesByType("Camera");
  },

  async getOnlineCameras() {
    const cameras = await this.getCameras();
    return cameras.filter((camera) => this.cameraIsOnline(camera));
  },

  async getOfflineCameras() {
    const cameras = await this.getCameras();
    return cameras.filter((camera) => !this.cameraIsOnline(camera));
  },

  async getCamera(mac) {
    const cameras = await this.getCameras();
    return cameras.find((camera) => camera.mac === mac);
  },

  async getCameraByName(nickname) {
    const cameras = await this.getCameras();
    return cameras.find(
      (camera) => camera?.nickname?.toLowerCase() === nickname?.toLowerCase()
    );
  },

  async getCameraSnapshot(mac) {
    const camera = await this.getCamera(mac);
    return camera ? this.cameraGetSnapshot(camera) : null;
  },

  async getCameraSnapshotUrl(mac) {
    const snapshot = await this.getCameraSnapshot(mac);
    return snapshot?.url ?? null;
  },

  async getCameraSummaries() {
    const cameras = await this.getCameras();
    return cameras.map((device) => this.cameraToSummary(device));
  },

  // ---- Long-lived RTP forwarding (for HomeKit streaming) -------------------

  /** Close every open camera WebRTC session (call on shutdown). */
  async closeAllCameraSessions() {
    await closeAllSessions();
  },

  /**
   * Establish a WebRTC connection to the camera and continuously forward
   * incoming H.264 RTP packets to `localRtpPort` on 127.0.0.1.
   * Returns `{ stop() }` — call stop() when the stream ends.
   */
  async cameraStartRtpForwarding(deviceMac, deviceModel, localRtpPort, options = {}) {
    const { localAudioRtpPort, onVideoIdle, videoIdleMs, ...rest } = options;
    const conn = await this.getCameraWebRTCConnectionInfo(deviceMac, deviceModel, {
      ...rest,
      noCache: true,
    });
    return startRtpForwarding({
      signalingUrl: conn.signalingUrl,
      iceServers: conn.iceServers,
      localRtpPort,
      localAudioRtpPort,
      onVideoIdle,
      videoIdleMs,
      sessionKey: deviceMac, // one WebRTC session per camera
      logger: this.apiLogEnabled ? this.log : null,
    });
  },

  /**
   * Allocate a local RTP port and generate an SSRC for a HomeKit stream session.
   * Call once per prepareStream, then pass the result into startCameraHKStream.
   */
  async prepareCameraHKStream() {
    const [localRtpPort, localAudioRtpPort] = await Promise.all([pickFreeUdpPort(), pickFreeUdpPort()]);
    // Mask to 31 bits — FFmpeg's -ssrc flag treats the value as signed int32
    // and rejects anything > 2147483647.
    const videoSsrc = nodeCrypto.randomBytes(4).readUInt32BE(0) & 0x7FFFFFFF;
    const audioSsrc = nodeCrypto.randomBytes(4).readUInt32BE(0) & 0x7FFFFFFF;
    const localAddress = localIpAddress();
    return { localRtpPort, localAudioRtpPort, videoSsrc, audioSsrc, localAddress };
  },

  /**
   * Start a HomeKit SRTP video+audio stream for a camera.
   * Connects WebRTC, forwards RTP locally, bridges to HomeKit via FFmpeg SRTP.
   * Automatically reconnects (up to 3 times) if the stream drops unexpectedly.
   * Returns { stop() } — call stop() to tear everything down.
   */
  async startCameraHKStream(deviceMac, deviceModel, {
    localRtpPort,
    localAudioRtpPort = null,
    targetAddress,
    videoPort,
    rtcpPort,
    srtpKey,
    srtpSalt,
    videoSsrc,
    audioPort = null,
    audioRtcpPort = null,
    audioSrtpKey = null,
    audioSrtpSalt = null,
    audioSsrc = null,
    bitrate = 300,
    logger = null,
  }) {
    const log = (level, msg) => {
      if (logger && typeof logger[level] === "function") logger[level](msg);
    };

    const MAX_RETRIES = 3;
    const MAX_AUDIO_RETRIES = 3;
    // An audio process that ran this long without a single audio packet means the camera
    // sends none (microphone off), not that ffmpeg failed.
    const AUDIO_SILENCE_MIN_MS = 15_000;
    let stopped = false;
    let retries = 0;
    let audioRetries = 0;

    // Current-attempt resources
    let forwarder = null;
    let videoFfmpeg = null;
    let audioFfmpeg = null;
    let videoSdpPath = null;
    let audioSdpPath = null;
    let keepaliveTimer = null;

    const cleanup = () => {
      if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
      try { videoFfmpeg?.kill("SIGKILL"); } catch (_) {}
      try { audioFfmpeg?.kill("SIGKILL"); } catch (_) {}
      try { forwarder?.stop(); } catch (_) {}
      try { if (videoSdpPath) fs.unlinkSync(videoSdpPath); } catch (_) {}
      try { if (audioSdpPath) fs.unlinkSync(audioSdpPath); } catch (_) {}
      forwarder = videoFfmpeg = audioFfmpeg = null;
      videoSdpPath = audioSdpPath = null;
    };

    // Spawn (or respawn) the audio FFmpeg process. The forwarder keeps
    // pumping RTP into localAudioRtpPort regardless, so audio recovery is
    // independent of WebRTC — we only need to relaunch ffmpeg.
    const spawnAudio = () => {
      if (!(localAudioRtpPort && audioPort && audioSrtpKey && audioSrtpSalt)) return;
      audioSdpPath = writeAudioSdpFile(localAudioRtpPort, forwarder?.audioCodec ?? null);
      const audioStartedAt = Date.now();
      const audioSrtpParams = Buffer.concat([audioSrtpKey, audioSrtpSalt]).toString("base64");

      audioFfmpeg = spawn(resolveFfmpegPath(), [
        "-loglevel", "warning",
        "-protocol_whitelist", "file,rtp,udp,srtp,crypto",
        "-fflags", "+genpts+nobuffer",
        "-flags", "low_delay",
        "-i", audioSdpPath,
        "-c:a", "libopus",
        "-ar", "24000",
        "-ac", "1",
        "-b:a", "24k",
        "-payload_type", "110",
        "-ssrc", String(audioSsrc),
        "-f", "rtp",
        "-srtp_out_suite", "AES_CM_128_HMAC_SHA1_80",
        "-srtp_out_params", audioSrtpParams,
        `srtp://${targetAddress}:${audioPort}?rtcpport=${audioRtcpPort}&pkt_size=188`,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      if (logger) {
        audioFfmpeg.stderr.on("data", (chunk) =>
          log("debug", `[stream] [ffmpeg/audio] ${chunk.toString().trimEnd()}`)
        );
      }

      audioFfmpeg.once("close", async (code) => {
        if (stopped) return;
        log("warn", `[stream] FFmpeg/audio exited (${code})`);
        try { if (audioSdpPath) fs.unlinkSync(audioSdpPath); } catch (_) {}
        audioFfmpeg = null;
        audioSdpPath = null;
        // A camera that negotiates audio but never sends any (microphone off in
        // the Wyze app) isn't a failure to retry: carry on with video only.
        // (A process that died almost at once failed for another reason: retry it.)
        if (forwarder?.audioSeen && !forwarder.audioSeen() && Date.now() - audioStartedAt >= AUDIO_SILENCE_MIN_MS) {
          log("debug", "[stream] camera sent no audio (microphone off?) — continuing video-only");
          return;
        }
        if (audioRetries < MAX_AUDIO_RETRIES) {
          audioRetries++;
          const delay = Math.min(1000 * audioRetries, 8000);
          log("debug", `[stream] Restarting audio in ${delay}ms (attempt ${audioRetries}/${MAX_AUDIO_RETRIES})`);
          await new Promise((r) => setTimeout(r, delay));
          if (!stopped && videoFfmpeg) spawnAudio();
        } else {
          log("warn", "[stream] Audio retry budget exhausted — continuing video-only");
        }
      });
    };

    const attempt = async () => {
      // Silent-stall recovery: if WebRTC quietly stops delivering video,
      // kill the video ffmpeg so its close-handler triggers a full reconnect.
      const onVideoIdle = () => {
        if (stopped) return;
        log("warn", "[stream] video idle — forcing reconnect");
        try { videoFfmpeg?.kill("SIGKILL"); } catch (_) {}
      };

      // Fresh local ports for every attempt. The ones picked when HomeKit prepared
      // the stream can have been taken since (several WebRTC sessions open sockets
      // at once), and retrying on the same number would fail the same way every time.
      localRtpPort = await pickFreeUdpPort();
      if (localAudioRtpPort) localAudioRtpPort = await pickFreeUdpPort();
      if (stopped) return;

      forwarder = await this.cameraStartRtpForwarding(
        deviceMac, deviceModel, localRtpPort,
        {
          ...(localAudioRtpPort ? { localAudioRtpPort } : {}),
          onVideoIdle,
          videoIdleMs: 10_000,
        }
      );

      // stop() may have been called while this (re)connect was negotiating: close
      // the forwarder we just got instead of starting ffmpeg for a dead stream.
      if (stopped) {
        try { forwarder.stop(); } catch (_) {}
        return;
      }

      // Video stream — bake the camera's SPS/PPS into the SDP so FFmpeg can
      // decode the very first IDR slice without waiting for in-band params.
      videoSdpPath = writeSdpFile(localRtpPort, forwarder.spropParameterSets, forwarder.videoPayloadType);
      const videoSrtpParams = Buffer.concat([srtpKey, srtpSalt]).toString("base64");

      videoFfmpeg = spawn(resolveFfmpegPath(), [
        "-loglevel", "warning",
        "-protocol_whitelist", "file,rtp,udp,srtp,crypto",
        // +discardcorrupt + igndts + ignore_err keeps FFmpeg running through
        // packet loss / out-of-order / DTS hiccups instead of exiting (0)
        // mid-stream, which used to trigger our 2-4s reconnect cycle and
        // look like jitter to the viewer.
        "-fflags", "+genpts+discardcorrupt+igndts+nobuffer",
        "-flags", "low_delay",
        "-err_detect", "ignore_err",
        "-max_delay", "500000",
        "-reorder_queue_size", "0",
        "-i", videoSdpPath,
        "-c:v", "copy",
        // Let timestamps pass through unchanged — we're stream-copying H.264
        // and the SRTP output side doesn't care about monotonic DTS. Without
        // this, FFmpeg spams "Non-monotonous DTS" every time RTP arrives
        // slightly out of order. (`-vsync` was renamed to `-fps_mode`.)
        "-fps_mode", "passthrough",
        "-payload_type", "99",
        "-ssrc", String(videoSsrc),
        "-f", "rtp",
        "-srtp_out_suite", "AES_CM_128_HMAC_SHA1_80",
        "-srtp_out_params", videoSrtpParams,
        `srtp://${targetAddress}:${videoPort}?rtcpport=${rtcpPort}&pkt_size=1316`,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      if (logger) {
        videoFfmpeg.stderr.on("data", (chunk) =>
          log("warn", `[stream] [ffmpeg/video] ${chunk.toString().trimEnd()}`)
        );
      }

      // Audio stream (optional — only if HomeKit provided audio params).
      // Self-heals via spawnAudio's close-handler if audio FFmpeg dies while
      // video is still running.
      audioRetries = 0;
      spawnAudio();

      // Force a single fresh keyframe right after FFmpeg comes up so it
      // locks decoding immediately. We deliberately do *not* PLI on a
      // short interval — each PLI causes the camera to reset its encoder
      // and drop intermediate frames, which shows up as the playback
      // clock jumping forward in chunks.
      setTimeout(() => forwarder?.requestKeyframe?.(), 200);

      // Reconnect on unexpected video FFmpeg exit
      videoFfmpeg.once("close", async (code) => {
        if (stopped) return;
        log("warn", `[stream] FFmpeg/video exited (${code})`);
        cleanup();
        if (retries < MAX_RETRIES) {
          retries++;
          const delay = Math.min(1000 * retries, 8000);
          log("debug", `[stream] Reconnecting in ${delay}ms (attempt ${retries}/${MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, delay));
          if (!stopped) {
            try { await attempt(); } catch (err) {
              log("error", `[stream] Reconnect failed: ${err.message}`);
            }
          }
        }
      });
    };

    await attempt();

    return {
      stop() {
        stopped = true;
        cleanup();
      },
    };
  },

  // ---- Stream utility functions ---------------------------------------------

  createCameraStreamClientId(deviceOrMac, prefix = "viewer") {
    const mac = typeof deviceOrMac === "string" ? deviceOrMac : deviceOrMac?.mac;
    const safePrefix = String(prefix || "viewer").replace(/[^a-zA-Z0-9_-]/g, "-");
    const macSlug =
      (mac || "camera").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase() || "camera";
    const random = nodeCrypto.randomBytes(4).toString("hex");
    return `${safePrefix}-${macSlug}-${Date.now()}-${random}`;
  },

  normalizeCameraSignalingUrl(signalingUrl) {
    if (!signalingUrl || typeof signalingUrl !== "string") return signalingUrl;
    if (signalingUrl.includes("%25")) {
      try {
        return decodeURIComponent(signalingUrl);
      } catch (_) {
        return signalingUrl;
      }
    }
    return signalingUrl;
  },

  sanitizeCameraIceServers(iceServers = []) {
    return iceServers
      .map((server) => {
        if (!server || !server.url) return null;
        const out = { urls: server.url };
        if (server.username) out.username = server.username;
        if (server.credential) out.credential = server.credential;
        return out;
      })
      .filter(Boolean);
  },

  parseCameraStatus(streamInfoResponse) {
    try {
      const item = streamInfoResponse?.data?.[0];
      if (!item?.property) return null;
      return {
        online: item.property["iot-device::iot-state"] === 1,
        powered: item.property["iot-device::iot-power"] === 1,
      };
    } catch (_) {
      return null;
    }
  },
};
