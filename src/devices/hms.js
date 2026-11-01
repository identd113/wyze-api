const payloadFactory = require("../utils/payloadFactory");
const constants = require("../constants");

/**
 * Wyze Home Monitoring System (HMS).
 *
 * High-level (`setHMSState`, `getHmsID`, `getHmsUpdate`) wraps the
 * lower-level membership / monitoring / reme-alarm endpoints. All call
 * paths route through `_hmsRequest` (services/hms.js) or
 * `_oliveSignedGet` (services/olive.js).
 */
module.exports = {
  // ---- Low-level endpoints --------------------------------------------------

  async disableRemeAlarm(hms_id) {
    return this._hmsRequest("delete", `${constants.hmsBaseUrl}/api/v1/reme-alarm`, {
      body: { hms_id, remediation_id: "emergency" },
      label: "DisableRemeAlarm",
    });
  },

  // `groupId` picks the plan family: "hms" (Home Monitoring, the default) or "cam-plus" (cameras; each plan's
  // `deviceList` names the cameras it covers).
  async getPlanBindingListByUser(groupId = "hms") {
    const payload = { ...payloadFactory.oliveCreateHmsPayload(), group_id: groupId };
    return this._oliveSignedGet(
      `${constants.membershipBaseUrl}/platform/v2/membership/get_plan_binding_list_by_user`,
      payload,
      "GetPlanBindingListByUser"
    );
  },

  /**
   * The account's Cam Plus plans and the cameras each one covers.
   * Wyze reports no list of features for a plan, so this is only who has one, until when, and in what state.
   * @returns {Promise<Array<{pid: string, name: string, status: string, active: boolean, expires: number|null,
   *   quantity: number, used: number, macs: string[]}>>} every plan, expired ones included
   */
  async getCamPlusPlans() {
    const response = await this.getPlanBindingListByUser("cam-plus");
    const rows = response && Array.isArray(response.data) ? response.data : [];
    return rows.map((row) => ({
      pid: String(row.pid ?? ""),
      name: String(row.plan_name ?? row.pid ?? ""),
      status: String(row.service_status ?? ""),
      active: row.service_status !== "EXPIRED" && Number(row.expired_date) > Date.now(),
      expires: Number.isFinite(Number(row.expired_date)) ? Number(row.expired_date) : null,
      quantity: Number(row.quantity) || 0,
      used: Number(row.used) || 0,
      macs: (Array.isArray(row.deviceList) ? row.deviceList : []).map((device) => String(device.device_id)),
    }));
  },

  async monitoringProfileStateStatus(hms_id) {
    const params = payloadFactory.oliveCreateHmsGetPayload(hms_id);
    return this._hmsRequest(
      "get",
      `${constants.hmsBaseUrl}/api/v1/monitoring/v1/profile/state-status`,
      { params, sign: true, contentType: true, label: "MonitoringProfileStateStatus" }
    );
  },

  async monitoringProfileActive(hms_id, home, away) {
    const params = payloadFactory.oliveCreateHmsPatchPayload(hms_id);
    const body = [
      { state: "home", active: home },
      { state: "away", active: away },
    ];
    return this._hmsRequest(
      "patch",
      `${constants.hmsBaseUrl}/api/v1/monitoring/v1/profile/active`,
      { params, body, sign: true, label: "MonitoringProfileActive" }
    );
  },

};
