# Home Monitoring System (HMS)

The Wyze HMS is the security/alarm subscription service. This library exposes the bits you need to read the current alarm mode and switch between **off**, **home**, and **away**.

## Setup — find your HMS ID

The HMS is keyed by an `hms_id` rather than a device mac.

```js
await wyze.getHmsID();
const plans = await wyze.getPlanBindingListByUser();
// dig the hms_id out of plans.data.binding_list
```

| Method | Notes |
|---|---|
| `getPlanBindingListByUser(groupId = "hms")` | Subscription/plan info. The default, `"hms"`, is the Home Monitoring plan and contains the `hms_id`. Pass `"cam-plus"` for the camera plans, where each plan's `deviceList` names the cameras it covers. |
| `getCamPlusPlans()` | The account's Cam Plus plans as a plain list (see below) |
| `getHmsID()` | Convenience wrapper around `getPlanBindingListByUser()` |

## Cam Plus plans

Not part of the monitoring system, but it comes from the same plan service. `getCamPlusPlans()` returns every plan the account has had, expired ones included:

```js
const plans = await wyze.getCamPlusPlans();
// [{ pid: "cam-plus-yearly", name: "Annual Plan", status: "RENEW", active: true,
//    expires: 1804106553000, quantity: 1, used: 1, macs: ["AABBCCDDEEFF"] }, ...]
const covered = plans.filter((plan) => plan.active).flatMap((plan) => plan.macs);
```

`active` is true only for a plan that has not expired by its date, whatever its status says. `macs` are the cameras the plan covers; `used` and `quantity` are seats taken and seats bought. Wyze lists no features for a plan, so this tells you who has one and until when, not what it allows. In practice, a camera on a plan gets video clips, AI labels and no five-minute wait between events; one without a plan gets a picture about every five minutes.

## Reading the current state

```js
const status = await wyze.getHmsUpdate(hms_id);
// status.data.* — includes the current monitoring profile
```

| Method | Notes |
|---|---|
| `getHmsUpdate(hms_id)` | Wraps `monitoringProfileStateStatus(hms_id)` |
| `monitoringProfileStateStatus(hms_id)` | Lower-level — full state |

## Setting the mode

```js
await wyze.setHMSState(hms_id, "off");
await wyze.setHMSState(hms_id, "home");
await wyze.setHMSState(hms_id, "away");
```

| Method | Notes |
|---|---|
| `setHMSState(hms_id, mode)` | High-level — `"off"` / `"home"` / `"away"` |
| `monitoringProfileActive(hms_id, home, away)` | Lower-level — pass `(0, 0)`, `(1, 0)`, or `(0, 1)` |
| `disableRemeAlarm(hms_id)` | Stops a currently-sounding alarm. Called automatically when you set `"off"`. |

The `setHMSState("off")` path additionally calls `disableRemeAlarm(hms_id)` — important if an alarm is currently sounding.

## Mode mapping

| `setHMSState` arg | `monitoringProfileActive(home, away)` |
|---|---|
| `"off"` | `(0, 0)` + `disableRemeAlarm(hms_id)` |
| `"home"` | `(1, 0)` |
| `"away"` | `(0, 1)` |

## Example: full setup

```js
const wyze = new Wyze({ /* ... */ });

const plans = await wyze.getPlanBindingListByUser();
const hms = plans.data.binding_list.find(p => p.is_active);
const hms_id = hms.hms_sub.hms_id;

// Disarm
await wyze.setHMSState(hms_id, "off");

// Arm-home
await wyze.setHMSState(hms_id, "home");

// Check
const status = await wyze.getHmsUpdate(hms_id);
console.log(status);
```

## Notes

- HMS endpoints live on `hms.api.wyze.com` (PATCH for state changes) — completely separate from camera/lock APIs.
- An HMS subscription is required for the modes to actually arm sensors. Without a subscription, the API still returns OK but nothing happens.
