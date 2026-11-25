const axios = require("axios");
const crypto = require("../utils/crypto");
const constants = require("../constants");
const { freshStamp } = require("../util/requestStamp");

/**
 * Olive-signed plugin services (earth, sirius, platform, membership,
 * lockwood). All share the same signing scheme: signature2 over the
 * sorted params/body, plus appid/appinfo/phoneid/access_token headers.
 */
module.exports = {
  async _oliveSignedGet(url, params, label) {
    await this.maybeLogin();
    const signature = crypto.oliveCreateSignature(params, this.access_token);
    const config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params,
    };
    this.log.debug(`Performing request: ${url}`);
    try {
      const result = await axios.get(url, {
        ...config,
        // Signed over the nonce in the params, so it is stamped and signed again after a rate-limit wait.
        __wyzeRebuild: () => {
          const again = freshStamp(params);
          return {
            params: again,
            headers: { ...config.headers, access_token: this.access_token, signature2: crypto.oliveCreateSignature(again, this.access_token) },
          };
        },
      });
              this.log.debug(`API response ${label || "Olive GET"}: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response ${label || "Olive GET"} (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }
  },

  async _oliveSignedPost(url, payload, label) {
    await this.maybeLogin();
    const bodyStr = JSON.stringify(payload);
    const signature = crypto.oliveCreateSignatureSingle(bodyStr, this.access_token);
    const config = {
      headers: {
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
    };
    this.log.debug(`Performing request: ${url}`);
    try {
      const result = await axios.post(url, bodyStr, {
        ...config,
        __wyzeRebuild: () => {
          const again = JSON.stringify(freshStamp(payload));
          return {
            data: again,
            headers: { ...config.headers, access_token: this.access_token, signature2: crypto.oliveCreateSignatureSingle(again, this.access_token) },
          };
        },
      });
              this.log.debug(`API response ${label || "Olive POST"}: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response ${label || "Olive POST"} (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }
  },

  /**
   * Earth (thermostat) GET. `nonce` is added if not supplied.
   */
  async _earthGet(urlPath, params = {}) {
    const withNonce = params.nonce ? params : { ...params, nonce: Date.now().toString() };
    return this._oliveSignedGet(
      `${constants.earthBaseUrl}${urlPath}`,
      withNonce,
      `Earth GET ${urlPath}`
    );
  },

  async _earthPost(urlPath, payload) {
    return this._oliveSignedPost(
      `${constants.earthBaseUrl}${urlPath}`,
      payload,
      `Earth POST ${urlPath}`
    );
  },
};
