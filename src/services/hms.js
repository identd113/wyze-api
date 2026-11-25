const axios = require("axios");
const crypto = require("../utils/crypto");
const constants = require("../constants");
const { freshStamp } = require("../util/requestStamp");

/**
 * HMS service (hms.api.wyze.com) — handles three distinct shapes:
 *   - DELETE with body, no signing (Authorization header only)
 *   - GET with olive signing + Authorization header
 *   - PATCH with olive signing + body
 */
module.exports = {
  async _hmsRequest(method, url, options = {}) {
    await this.maybeLogin();
    const { params, body, sign = false, contentType = false, label } = options;

    const m = method.toLowerCase();

    // Signed over the params (which hold a nonce), so a request sent again after a rate-limit wait is stamped and
    // signed again with the token as it is by then.
    const build = (stamp = false) => {
      const sent = stamp ? freshStamp(params) : params;
      const headers = {
        Authorization: this.access_token,
        "User-Agent": this.userAgent,
      };
      if (sign) {
        const signature = crypto.oliveCreateSignature(sent, this.access_token);
        Object.assign(headers, {
          appid: constants.oliveAppId,
          appinfo: constants.appInfo,
          phoneid: this.phoneId,
          access_token: this.access_token,
          signature2: signature,
        });
      }
      if (contentType) headers["Content-Type"] = "application/json";

      const config = { headers };
      if (sent) config.params = sent;
      // axios.delete takes the body via config.data; patch and post take it as an argument.
      if (body !== undefined) config.data = stamp ? freshStamp(body) : body;
      return config;
    };
    const rebuild = () => build(true);
    const first = build();
    const config = m === "delete" ? { ...first, __wyzeRebuild: rebuild } : { headers: first.headers, ...(first.params ? { params: first.params } : {}), __wyzeRebuild: rebuild };

    this.log.debug(`Performing request: ${url}`);
    try {
      let result;
      if (m === "get") result = await axios.get(url, config);
      else if (m === "delete") result = await axios.delete(url, config);
      else if (m === "patch") result = await axios.patch(url, body, config);
      else if (m === "post") result = await axios.post(url, body, config);
      else throw new Error(`_hmsRequest: unsupported method ${method}`);

              this.log.debug(`API response ${label || "HMS"}: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response ${label || "HMS"} (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }
  },
};
