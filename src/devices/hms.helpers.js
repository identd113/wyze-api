/**
 * High-level helpers for HMS — orchestrate the low-level endpoints in hms.js
 * into single-call operations.
 */
module.exports = {
  /**
   * Resolve the HMS device ID bound to this account. Wyze returns a list of
   * plans (sometimes multiple — e.g. an expired plan alongside an active
   * one), so this finds the first plan that actually has a device bound to
   * it instead of indexing [0] blindly.
   * @returns {Promise<string>} the hms_id
   */
  async getHmsID() {
    const response = await this.getPlanBindingListByUser();
    const plans = Array.isArray(response?.data) ? response.data : [];
    for (const plan of plans) {
      const device = Array.isArray(plan?.deviceList) ? plan.deviceList[0] : null;
      if (device?.device_id) return device.device_id;
    }
    throw new Error(
      `getHmsID: no HMS device found in plan list. Got ${plans.length} plan(s); none had a non-empty deviceList.`
    );
  },

  /**
   * @param {string} hms_id
   * @param {string} mode — "off" / "home" / "away"
   */
  async setHMSState(hms_id, mode) {
    if (mode === "off") {
      await this.disableRemeAlarm(hms_id);
      await this.monitoringProfileActive(hms_id, 0, 0);
    } else if (mode === "away") {
      await this.monitoringProfileActive(hms_id, 0, 1);
    } else if (mode === "home") {
      await this.monitoringProfileActive(hms_id, 1, 0);
    }
  },

  async getHmsUpdate(hms_id) {
    return this.monitoringProfileStateStatus(hms_id);
  },
};
