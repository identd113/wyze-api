# Fix: restore 2FA/MFA login support

## Symptom

Reported upstream as [homebridge-wyze-smart-home#306](https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/306)
("Does not support 2FA?"). Users with 2FA enabled on their Wyze account can't get the plugin to
log in. Example log from the report (plugin v0.5.58, wyze-api pinned via that release):

```
ERROR   Wyze API Error (2001): 'access token is error'
ERROR   Wyze API Error (1001): 'INVALID_PARAMETER'
ERROR   Wyze API Error (1001): 'INVALID_PARAMETER'
ERROR   Error during token refresh: Wyze API Error (1001) - INVALID_PARAMETER
[Wyze] Error getting devices: Error: Refresh Token could not be used to get a new access token...
```

The reporter also noted the Homebridge Config UI X form never asks for a 2FA code at all.

## Root cause

`login()` used to handle the MFA challenge Wyze's `api/user/login` endpoint returns when an
account has 2FA enabled (no `access_token`, but an `mfa_details` block). That handling was
deleted in commit `2b87845` ("Clean up MFA (#8)", 2024-02-09) — the PR was framed as a
formatting/error-handling cleanup ("run pretty code from VS", "Move `_performLoginRequest` into
try catch") and doesn't mention removing MFA; it reads like incidental collateral damage, not a
deliberate decision. `this.mfaCode = options.mfaCode` (currently `src/index.js` constructor) is
the only surviving trace — it's stored but never read anywhere since that commit.

Current effect for a 2FA account: `login()` gets back `result.ok === true` (no `code` field on
this endpoint, so `_handleApiResponse` doesn't treat it as an error) but `result.data.access_token`
is falsy, so it just throws `Invalid credentials...`. Downstream, `homebridge-wyze-smart-home`
also has no `mfaCode` field in `config.schema.json`, so there's no way to supply one via the UI
even once this is fixed here (that side is already patched in the homebridge-wyze-smart-home repo).

## The fix (implemented in v1.1.16)

Added an MFA branch to `login()` plus a small helper in `src/index.js`, reusing the current
`_performLoginRequest()`/`result.ok` plumbing instead of the pre-2024 error-handling style
(not a revert of the old code):

```js
async login() {
  if (this.apiKey == null) {
    throw new Error('ApiKey Required, Please provide the "apiKey" parameter in config.json');
  } else if (this.keyId == null) {
    throw new Error('KeyId Required, Please provide the "keyId" parameter in config.json');
  } else {
    let result = await this._performLoginRequest();

    // Wyze responds with no access_token and an mfa_details block when the
    // account has 2FA enabled - complete the challenge with a follow-up request.
    if (result.ok && !result.data.access_token && result.data.mfa_details) {
      result = await this._performMfaLogin(result.data.mfa_details);
    }

    if (!result.ok || !result.data.access_token) {
      throw new Error(
        `Invalid credentials, please check username/password, keyId/apiKey - ${JSON.stringify(result)}`
      );
    }
    if (this.apiLogEnabled) {
      this.log.info("Successfully logged into Wyze API");
    }
    await this._updateTokens(result.data);
  }
}

/**
 * Completes a TOTP authenticator-app MFA challenge returned by the login endpoint.
 * @param {object} mfaDetails - The `mfa_details` block from the login response.
 * @returns {Promise<object>} - The result of the follow-up login request.
 * @throws {Error} - Throws if no mfaCode was configured or the account uses an
 *   unsupported MFA method (only TOTP authenticator apps are handled).
 */
async _performMfaLogin(mfaDetails) {
  if (!this.mfaCode) {
    throw new Error(
      'Your account has 2-factor auth enabled. Please provide the "mfaCode" parameter in config.json.'
    );
  }

  const totpApp = mfaDetails.totp_apps?.[0];
  if (!totpApp) {
    throw new Error(
      `Unsupported MFA method - only TOTP authenticator apps are currently supported. Received: ${JSON.stringify(mfaDetails)}`
    );
  }

  return this._performLoginRequest({
    mfa_type: "TotpVerificationCode",
    verification_id: totpApp.app_id,
    verification_code: this.mfaCode,
  });
}
```

This was drafted and syntax-checked (`node --check`) against the submodule copy of `src/index.js`
in `homebridge-wyze-smart-home`, then reverted there since this repo is the right place to own
and commit it — landed here in commit `61ed5d5` with unit test coverage
(`tests/login.test.js`) for the branch logic, the MFA request shape, and the error paths (missing
`mfaCode`, unsupported MFA method). **Still not yet verified against a live 2FA account** — the
old (pre-2024) implementation used this same `mfa_type: "TotpVerificationCode"` /
`verification_id` / `verification_code` shape and presumably worked, but that's the one thing
worth confirming with a real account before calling this fully done, since Wyze's API isn't
documented and could have changed since 2024.

## Known limitation worth calling out in the release notes

`mfaCode` is a static config value but TOTP codes rotate every 30s. This only works if the code is
current at the moment Homebridge actually attempts login — a stale code just fails with the
"provide mfaCode" error again. That's a pre-existing limitation of this approach (same as the
pre-2024 implementation), not something introduced by this fix.

## What's already done on the homebridge-wyze-smart-home side

- `config.schema.json` — added an `mfaCode` field so Homebridge Config UI X can collect it.
- `README.md` — documented `mfaCode` under Optional Fields, including the TOTP-rotation caveat above.
- `WyzeSmartHome.js` already forwarded `this.config.mfaCode` into the `WyzeAPI` constructor before
  any of this — no change needed there.

Once this lands here and gets a version bump, homebridge-wyze-smart-home needs its `wyze-api`
submodule pointer and `package.json` dependency version bumped to pick it up (same pattern as the
`e64b1d4` TLS fix → `4eebcae` "Update wyze-api submodule to 1.1.15").
