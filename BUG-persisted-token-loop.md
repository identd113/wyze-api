# Bug: stale persisted token permanently blocks re-login

## Status

**Fixed.** `_handleAccessTokenError` now clears `refresh_token` and deletes the persisted
token file via a new `_clearPersistedTokens()` method when `refreshToken()` fails, so the
next `maybeLogin()` finds nothing to reload and falls through to a real login. Covered by
`tests/token-persistence.test.js`.

## Symptom

Reported upstream as [homebridge-wyze-smart-home#268](https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/268),
specifically the later comments on that thread (cheme75, Aug 2025; awakenalive, Sep 2025):

```
Wyze API Error (2001): 'access token is error'
Wyze API Error (2002): 'refresh token is error'
Error getting devices: Error: Refresh Token could not be used to get a new access token. Error: Wyze API Error (2002) - refresh token is error
```

This repeats forever on every poll cycle. Credentials are valid (confirmed by users rotating
apiKey/keyId, disabling 2FA, even reinstalling the OS) — none of that helps. The only fix
users found was manually deleting `wyze-{uuid}.json` from Homebridge's persist directory,
after which login succeeds immediately with the *same* credentials that were failing moments
before. Also plausibly related to [homebridge-wyze-smart-home#306](https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/306)
(see "Related" below), though #306's primary cause is the separate missing-MFA issue fixed
in `FIX-mfa-login.md`.

## Root cause

`maybeLogin()` will never fall through to a real username/password login as long as *any*
parseable token file exists on disk, even one already proven invalid:

```
maybeLogin()                              src/index.js:~456-465
  if (!this.access_token) _loadPersistedTokens()
  if (this.access_token) return           // <-- returns here every time the file has *a* token
```

`_loadPersistedTokens()` (`src/index.js:677-697`) has no concept of "this token was already
tried and rejected" — it just reads the file and trusts it:

```js
if (parsedData.access_token && parsedData.refresh_token) {
  this.access_token = parsedData.access_token;
  this.refresh_token = parsedData.refresh_token;
}
```

When a request fails on a bad access token, `_handleAccessTokenError` (`src/index.js:344-364`)
clears `this.access_token = ""` and tries `refreshToken()`. If the refresh token is *also*
bad (error 2002), that throws — but nothing here clears `this.refresh_token`, and nothing
deletes or overwrites the persisted file. The bad pair stays on disk untouched.

Next poll cycle: `access_token` is empty again (cleared above) → `maybeLogin()` calls
`_loadPersistedTokens()` → reloads the *exact same* broken pair from disk → `access_token`
is truthy again → `maybeLogin()` returns immediately, never reaching the
debounce/`tryLogin()`/`login()` branch that would attempt a fresh username/password/apiKey
(and now MFA) login. This repeats indefinitely. Config changes (new apiKey, disabling 2FA,
new password) are irrelevant because `login()` — the only code path that would actually use
them — is never called again once a token file exists, valid or not.

## Proposed fix

In `_handleAccessTokenError`, when `refreshToken()` also fails, treat that as proof the
persisted pair is dead: clear `this.refresh_token` too (not just `access_token`) and delete
the on-disk token file (or overwrite it with empty values) so the *next* `maybeLogin()` call
finds nothing to reload and falls through to a genuine `login()` attempt instead of
re-hydrating the same broken tokens forever.

## Related

A 2FA account that never completed verification (pre-`FIX-mfa-login.md`) could plausibly end
up with a persisted-but-half-authorized token that trips this same loop — worth re-testing
against #268-style reports now that `FIX-mfa-login.md` (v1.1.16) has landed, in case some
of them clear up on their own.
