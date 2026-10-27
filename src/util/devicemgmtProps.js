/**
 * Per-model property lists for the devicemgmt `get_iot_prop` request, used by
 * the newer cameras (Floodlight Pro, Battery Cam Pro, OG, Pan v4).
 *
 * Ported verbatim from SecKatie/wyzeapy `devicemgmt_get_iot_props_list`
 * (src/wyzeapy/payload_factory.py). Keep in sync with that file when Wyze adds
 * properties; the server answers with the capabilities requested here.
 */
const PROPS = {
  "LD_CFP": [
    {
      "iid": 2,
      "name": "camera",
      "properties": [
        "motion-detect",
        "resolution",
        "bit-rate",
        "live-stream-mode",
        "recording-mode",
        "frame-rate",
        "night-shot",
        "night-shot-state",
        "rotate-angle",
        "time-watermark",
        "logo-watermark",
        "recording-trigger-source",
        "recording-content-type",
        "motion-push",
        "speaker",
        "microphone",
        "unusual-sound-push",
        "flip",
        "motion-detect-recording",
        "cool-down-interval",
        "infrared-mode",
        "sound-collection-on",
        "live-stream-protocol",
        "ai-push",
        "voice-template",
        "motion-category"
      ]
    },
    {
      "iid": 3,
      "name": "device-info",
      "properties": [
        "device-id",
        "device-model",
        "firmware-ver",
        "mac",
        "timezone",
        "lat",
        "ip",
        "lon",
        "hardware-ver",
        "public-ip"
      ]
    },
    {
      "iid": 1,
      "name": "iot-device",
      "properties": [
        "iot-state",
        "iot-power",
        "push-switch"
      ]
    },
    {
      "iid": 9,
      "name": "camera-ai",
      "properties": [
        "smart-detection-type",
        "on"
      ]
    },
    {
      "iid": 4,
      "name": "floodlight",
      "properties": [
        "on",
        "enabled",
        "mode",
        "trigger-source",
        "brightness",
        "light-on-duration",
        "voice-template",
        "motion-warning-switch",
        "motion-activate-light-switch",
        "motion-activate-light-schedule",
        "motion-activate-brightness",
        "ambient-light-switch",
        "ambient-light-schedule",
        "ambient-light-brightness",
        "motion-tag",
        "light-model",
        "flash-with-siren"
      ]
    },
    {
      "iid": 11,
      "name": "indicator-light",
      "properties": [
        "on",
        "mode",
        "brightness",
        "color",
        "color-temperature"
      ]
    },
    {
      "iid": 8,
      "name": "memory-card-management",
      "properties": [
        "storage-used-space",
        "storage-total-space",
        "storage-status",
        "sd-card-playback-enabled"
      ]
    },
    {
      "iid": 6,
      "name": "motion-detection",
      "properties": [
        "sensitivity-motion",
        "on",
        "motion-zone",
        "motion-zone-selected-block",
        "motion-zone-block-size",
        "motion-tag",
        "edge-detection-type",
        "motion-warning-switch",
        "motion-warning-tone",
        "motion-warning-interval",
        "motion-warning-schedule",
        "motion-warning-sound",
        "motion-warning-trigger-setting"
      ]
    },
    {
      "iid": 7,
      "name": "siren",
      "properties": [
        "state"
      ]
    },
    {
      "iid": 5,
      "name": "wifi",
      "properties": [
        "on",
        "signal-strength",
        "wifi-ssid",
        "wifi-encrypted-password"
      ]
    }
  ],
  "AN_RSCW": [
    {
      "iid": 2,
      "name": "camera",
      "properties": [
        "motion-detect",
        "resolution",
        "bit-rate",
        "live-stream-mode",
        "recording-mode",
        "frame-rate",
        "night-shot",
        "night-shot-state",
        "time-watermark",
        "logo-watermark",
        "cool-down-interval",
        "recording-content-type",
        "video-length-limit",
        "motion-push",
        "speaker",
        "unusual-sound-push",
        "microphone",
        "infrared-mode",
        "motion-detect-recording",
        "live-stream-protocol",
        "recording-resolution",
        "recording-start-time",
        "recording-schedule-duration",
        "voice-template",
        "rotate-angle",
        "sound-collection-on",
        "ai-push"
      ]
    },
    {
      "iid": 3,
      "name": "device-info",
      "properties": [
        "device-id",
        "device-model",
        "firmware-ver",
        "mac",
        "timezone",
        "lat",
        "ip",
        "lon",
        "company-code",
        "device-setting-channel",
        "network-connection-mode",
        "hardware-ver",
        "public-ip"
      ]
    },
    {
      "iid": 1,
      "name": "iot-device",
      "properties": [
        "iot-state",
        "iot-power",
        "push-switch",
        "mqtt-check"
      ]
    },
    {
      "iid": 7,
      "name": "battery",
      "properties": [
        "battery-level",
        "low-battery-push",
        "power-source",
        "charging-status",
        "power-saving"
      ]
    },
    {
      "iid": 12,
      "name": "camera-ai",
      "properties": [
        "smart-detection-type",
        "on"
      ]
    },
    {
      "iid": 8,
      "name": "indicator-light",
      "properties": [
        "on",
        "mode"
      ]
    },
    {
      "iid": 6,
      "name": "memory-card-management",
      "properties": [
        "storage-used-space",
        "storage-total-space",
        "storage-status",
        "sd-card-playback-enabled"
      ]
    },
    {
      "iid": 11,
      "name": "motion-detection",
      "properties": [
        "sensitivity-motion",
        "on",
        "area-length",
        "motion-zone",
        "motion-zone-block-size",
        "motion-zone-selected-block",
        "edge-detection-type",
        "motion-tag"
      ]
    },
    {
      "iid": 4,
      "name": "siren",
      "properties": [
        "state",
        "siren-on-ts"
      ]
    },
    {
      "iid": 14,
      "name": "solar-panel",
      "properties": [
        "enabled",
        "on"
      ]
    },
    {
      "iid": 5,
      "name": "spotlight",
      "properties": [
        "on",
        "enabled",
        "brightness",
        "motion-activate-light-switch",
        "sunset-to-sunrise",
        "motion-activate-light-schedule",
        "trigger-source"
      ]
    },
    {
      "iid": 9,
      "name": "wifi",
      "properties": [
        "on",
        "signal-strength",
        "wifi-ssid",
        "wifi-encrypted-password"
      ]
    }
  ],
  "GW_GC1": [
    {
      "iid": 2,
      "name": "camera",
      "properties": [
        "motion-detect",
        "resolution",
        "bit-rate",
        "live-stream-mode",
        "recording-mode",
        "frame-rate",
        "night-shot",
        "night-shot-state",
        "time-watermark",
        "logo-watermark",
        "cool-down-interval",
        "recording-content-type",
        "video-length-limit",
        "motion-push",
        "speaker",
        "unusual-sound-push",
        "microphone",
        "infrared-mode",
        "motion-detect-recording",
        "live-stream-protocol",
        "recording-resolution",
        "recording-start-time",
        "recording-schedule-duration",
        "voice-template",
        "rotate-angle",
        "sound-collection-on",
        "ai-push"
      ]
    },
    {
      "iid": 3,
      "name": "device-info",
      "properties": [
        "device-id",
        "device-model",
        "firmware-ver",
        "mac",
        "timezone",
        "lat",
        "ip",
        "lon",
        "company-code",
        "device-setting-channel",
        "network-connection-mode",
        "hardware-ver",
        "public-ip"
      ]
    },
    {
      "iid": 1,
      "name": "iot-device",
      "properties": [
        "iot-state",
        "iot-power",
        "push-switch",
        "mqtt-check"
      ]
    },
    {
      "iid": 12,
      "name": "camera-ai",
      "properties": [
        "smart-detection-type",
        "on"
      ]
    },
    {
      "iid": 8,
      "name": "indicator-light",
      "properties": [
        "on",
        "mode"
      ]
    },
    {
      "iid": 6,
      "name": "memory-card-management",
      "properties": [
        "storage-used-space",
        "storage-total-space",
        "storage-status",
        "sd-card-playback-enabled"
      ]
    },
    {
      "iid": 11,
      "name": "motion-detection",
      "properties": [
        "sensitivity-motion",
        "on",
        "area-length",
        "motion-zone",
        "motion-zone-block-size",
        "motion-zone-selected-block",
        "edge-detection-type",
        "motion-tag"
      ]
    },
    {
      "iid": 4,
      "name": "siren",
      "properties": [
        "state",
        "siren-on-ts"
      ]
    },
    {
      "iid": 5,
      "name": "spotlight",
      "properties": [
        "on",
        "enabled",
        "brightness",
        "motion-activate-light-switch",
        "sunset-to-sunrise",
        "motion-activate-light-schedule",
        "trigger-source"
      ]
    },
    {
      "iid": 9,
      "name": "wifi",
      "properties": [
        "on",
        "signal-strength",
        "wifi-ssid",
        "wifi-encrypted-password"
      ]
    }
  ],
  "HL_PAN4": [
    {
      "iid": 2,
      "name": "camera",
      "properties": [
        "motion-detect",
        "resolution",
        "bit-rate",
        "live-stream-mode",
        "recording-mode",
        "frame-rate",
        "night-shot",
        "night-shot-state",
        "time-watermark",
        "logo-watermark",
        "cool-down-interval",
        "motion-push",
        "infrared-mode",
        "motion-detect-recording",
        "rotate-angle",
        "sound-collection-on"
      ]
    },
    {
      "iid": 3,
      "name": "device-info",
      "properties": [
        "device-id",
        "device-model",
        "firmware-ver",
        "mac",
        "timezone",
        "lat",
        "ip",
        "lon",
        "company-code",
        "hardware-ver",
        "public-ip"
      ]
    },
    {
      "iid": 1,
      "name": "iot-device",
      "properties": [
        "iot-state",
        "iot-power",
        "push-switch"
      ]
    },
    {
      "iid": 12,
      "name": "camera-ai",
      "properties": [
        "smart-detection-type",
        "on"
      ]
    },
    {
      "iid": 8,
      "name": "indicator-light",
      "properties": [
        "on",
        "mode"
      ]
    },
    {
      "iid": 6,
      "name": "motion-detection",
      "properties": [
        "sensitivity-motion",
        "on",
        "motion-zone",
        "motion-zone-block-size",
        "motion-zone-selected-block",
        "motion-tag"
      ]
    },
    {
      "iid": 4,
      "name": "siren",
      "properties": [
        "state",
        "siren-on-ts"
      ]
    },
    {
      "iid": 5,
      "name": "spotlight",
      "properties": [
        "on",
        "enabled",
        "brightness"
      ]
    },
    {
      "iid": 9,
      "name": "wifi",
      "properties": [
        "on",
        "signal-strength",
        "wifi-ssid"
      ]
    }
  ]
};

// The Cam OG Telephoto 3x (GW_GC2) is the OG's sibling and is listed beside it in
// mrlt8/docker-wyze-bridge and SecKatie/ha-wyzeapi, but wyzeapy has no property list for it.
// It uses the OG's until someone with one reports what Wyze actually answers.
PROPS.GW_GC2 = PROPS.GW_GC1;

module.exports = Object.freeze(PROPS);
