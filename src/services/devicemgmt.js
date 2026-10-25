const axios = require("axios");
const nodeCrypto = require("crypto");
const constants = require("../constants");
const devicemgmtProps = require("../util/devicemgmtProps");

/**
 * DeviceMgmt API — used by newer cameras (Floodlight Pro / Battery Cam Pro
 * / OG cam) that don't respond to the standard run_action endpoint.
 *
 * - run_action: POST to devicemgmt-service-beta.wyze.com with bare
 *   `authorization: <access_token>` header (no olive signing).
 * - get_iot_prop: POST to the same host with the per-model property list
 *   (src/util/devicemgmtProps.js, ported from SecKatie/wyzeapy).
 * - set_toggle: POST to ai-subscription-service-beta.wyzecam.com with
 *   olive signing (uses _oliveSignedPost from services/olive.js).
 */
module.exports = {
  _deviceMgmtBuildCapability(type, value) {
    switch (type) {
      case "floodlight":
        return { iid: 4, name: "floodlight", properties: [{ prop: "on", value }] };
      case "spotlight":
        return { iid: 5, name: "spotlight", properties: [{ prop: "on", value }] };
      case "power":
        return {
          functions: [{ in: { "wakeup-live-view": "1" }, name: value }],
          iid: 1,
          name: "iot-device",
        };
      case "siren":
        return { functions: [{ in: {}, name: value }], name: "siren" };
      default:
        throw new Error(`_deviceMgmtBuildCapability: unsupported type ${type}`);
    }
  },

  async _deviceMgmtRunAction(deviceMac, deviceModel, type, value) {
    await this.maybeLogin();
    const payload = {
      capabilities: [this._deviceMgmtBuildCapability(type, value)],
      nonce: Date.now(),
      targetInfo: {
        id: deviceMac,
        productModel: deviceModel,
        type: "DEVICE",
      },
      // OG cam needs a transactionId — server doesn't validate the value.
      transactionId: nodeCrypto.randomBytes(16).toString("hex"),
    };
    const url = `${constants.devicemgmtBaseUrl}/device-management/api/action/run_action`;
    this.log.debug(`Performing request: ${url}`);
    try {
      const result = await axios.post(url, payload, {
        headers: { authorization: this.access_token },
      });
              this.log.debug(`API response DeviceMgmt run_action: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response DeviceMgmt run_action (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }
  },

  /**
   * Reads current state for a devicemgmt-API camera (Floodlight Pro, Battery
   * Cam Pro, OG, Pan v4). Returns the raw response; see
   * `_deviceMgmtParseState` for the normalized view.
   */
  async _deviceMgmtGetIotProp(deviceMac, deviceModel) {
    const capabilities = devicemgmtProps[deviceModel];
    if (!capabilities) {
      throw new Error(`_deviceMgmtGetIotProp: no property list for model ${deviceModel}`);
    }
    await this.maybeLogin();
    const payload = {
      capabilities,
      nonce: Date.now(),
      targetInfo: { id: deviceMac, productModel: deviceModel, type: "DEVICE" },
    };
    const url = `${constants.devicemgmtBaseUrl}/device-management/api/device-property/get_iot_prop`;
    this.log.debug(`Performing request: ${url}`);
    try {
      const result = await axios.post(url, payload, {
        headers: { authorization: this.access_token },
      });
      this.log.debug(`API response DeviceMgmt get_iot_prop: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response DeviceMgmt get_iot_prop (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }
  },

  /**
   * Normalizes a devicemgmt get_iot_prop response (mirrors wyzeapy's
   * CameraService.update): { motion, floodlight, siren, notify, on, available }.
   * Fields the camera doesn't report are left undefined.
   */
  _deviceMgmtParseState(response) {
    const state = {};
    // Wyze reports these as booleans; accept 1/"1"/"true" too so a string "0" is never read as on.
    const flag = (v) => (v === undefined ? undefined : v === true || v === 1 || v === "1" || v === "true");
    for (const cap of response?.data?.capabilities || []) {
      const props = cap.properties || {};
      switch (cap.name) {
        case "camera":
          state.motion = flag(props["motion-detect-recording"]);
          break;
        case "floodlight":
        case "spotlight":
          state.floodlight = flag(props.on);
          break;
        case "siren":
          state.siren = flag(props.state);
          break;
        case "iot-device":
          state.notify = flag(props["push-switch"]);
          state.on = flag(props["iot-power"]);
          state.available = flag(props["iot-state"]);
          break;
        default:
      }
    }
    return state;
  },

  async _deviceMgmtSetToggle(deviceMac, deviceModel, toggleType, state) {
    const payload = {
      data: [
        {
          device_firmware: "1234567890",
          device_id: deviceMac,
          device_model: deviceModel,
          page_id: [toggleType.pageId],
          toggle_update: [{ toggle_id: toggleType.toggleId, toggle_status: state }],
        },
      ],
      nonce: String(Date.now()),
    };
    return this._oliveSignedPost(
      `${constants.aiSubscriptionBaseUrl}/v4/subscription-service/toggle-management`,
      payload,
      "DeviceMgmtSetToggle"
    );
  },
};
