# Cameras — Local Settings and the Test Page

Some camera settings are not in Wyze's cloud. `wyze-api` asks the camera itself over your own network (the local session described in [Local Protocol](Local-Protocol.md)). Three methods use it, and a web page and a report script make it easy to try them. This page covers what the camera can be asked, what each tool does, and what is not known yet.

## Methods

All three take the camera's `mac` from the device list. They need a camera that reports the `dtls` flag, has an IP address in the Wyze device list and has its key and id, and they must run on the same network as the camera. If it cannot be reached, the error says why (`night vision cannot be reached: ...`). Calls for one camera run one at a time, so two cannot collide.

```js
const nv = await wyze.getCameraNightVision(cam.mac);        // "on" | "off" | "auto"
const set = await wyze.setCameraNightVision(cam.mac, "auto"); // { before, after, matches }
const alarms = await wyze.getCameraAlarmSettings(cam.mac);  // { smoke, co }: "on" | "off" | "unknown"
```

- **`getCameraNightVision(mac)`** reads night vision.
- **`setCameraNightVision(mac, value)`** sets `"on"`, `"off"` or `"auto"` and reads it back. `matches` says whether the camera now reports what was asked. Any other value throws.
- **`getCameraAlarmSettings(mac)`** reads the two toggles on the Wyze app's *Alarm Settings* page: listening for a **smoke alarm** sound and for a **CO alarm** sound. It is **read only**: the command that changes them is not known, so there is no setter.

## What the camera keeps (and the cloud does not)

The alarm toggles are not in the cloud property list or in devicemgmt (`smoke_alarm_switch` and `co_alarm_switch` in the device parameters did not move when the toggles were changed). They are in the camera's own settings record, `K10020`, where `1` is on and `2` is off:

| Param | Setting | How it is known |
|---|---|---|
| 13, 14 | Motion detection | Read on a Cam v3 |
| 15 | Sound detection | Read on a Cam v3 |
| 17 | Smoke alarm sound | By elimination: toggling only CO left it at 1 |
| 18 | CO alarm sound | Toggled on its own and watched |
| 50 | Infrared LED | Read on a Cam v3 |

Checked on a Cam v3 with a floodlight, 2026-11-18. Other models may differ. The full record, and which values are only guessed, is in [`docs/camera-properties.md`](https://github.com/wyze-smart-home/wyze-api/blob/2.0.0/docs/camera-properties.md).

A camera with a floodlight accessory also reports it in its own records (`K10720`), which is how a Cam v3 with a floodlight is told apart from a Floodlight v2.

## The test page

```bash
npm run camera-test            # port 8099
npm run camera-test -- --port 9000
```

A web page for trying your cameras from a browser, run on a computer on the same network as the cameras. It prints a link ending in `?token=...` (the token changes at every start). The Homebridge plugin can start the same page when you give it a web port. Every setting on the page is read only except night vision, which asks for a confirm first.

Each camera's card has:

- **A snapshot.** Wyze's last saved picture shows when the page opens (it can be old, and the card says so). The page never starts a live stream by itself.
- **Night vision.** After a change, the page waits five seconds, takes a live snapshot and shows it next to the one from before.
- **What may it support?** A list of features, each one *seen on this device*, *likely* (the model is known to have it) or *not seen* (nothing read shows it, which is not the same as "no"). It combines the device list, the property list, devicemgmt and, if you ran Test, what the camera answered.
- **Scan again.** A scan is saved so it is not repeated: the report for 10 minutes, a device's capability groups until its firmware changes, the device list for 1 minute. With a `persistPath` (the Homebridge plugin passes its own), the capability groups also survive a restart.
- **Report links.** Every "Report" link opens a GitHub issue form with what the page knows already filled in (model, kind, versions, and what a test found). Nothing is sent until you press the button on GitHub.

Other devices (locks, thermostats and so on) are listed too. Scanning for the groups a device may answer to is **off by default** and is switched on with a tick box, because it asks Wyze about 13 groups per device and counts against the rate limit.

Who can reach it, and the checks it makes, are in [`scripts/README.md`](https://github.com/wyze-smart-home/wyze-api/blob/2.0.0/scripts/README.md). It is plain HTTP for your own network: do not forward the port to the internet.

## The device report

```bash
node scripts/device-report.js                       # every device
node scripts/device-report.js --model HL_CFL2       # one model
node scripts/device-report.js --local               # also ask each camera directly
node scripts/device-report.js --discovery           # also find the devicemgmt groups each device has
```

A read-only report to paste into a bug or new-device issue. Names, addresses, serial numbers and tokens are removed before it is written; read the file before you share it. `--local` adds what the camera itself answers (night vision, the alarm toggles, the infrared LED, the floodlight record). `--discovery` asks Wyze which capability groups each device answers to, which shows what framework a new model uses. It is off by default, and about 13 requests per device are spread out with a 300 ms pause.

To find out what a setting in the Wyze app changes, read the report, change **one** setting in the app, read it again and compare the two files.

## Not known yet

- The command that **writes** the alarm toggles (only the read is known).
- Which of the other `K10020` params mean what.
- Whether Smoke/CO listening produces an event the library can read. An event sample is needed before a Homebridge sensor can be built on it.
- The same reads on a Cam v2, Pan or Doorbell: the Cam v3 is the only model tested.

## See also

- **[Cameras — Controls](Cameras.md)** — cloud controls
- **[Local Protocol](Local-Protocol.md)** — how the local session is built
- **[Troubleshooting](Troubleshooting.md)**
