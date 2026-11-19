# Report a problem

**Short answer:** open the camera test page and use the report link at the bottom. It fills in the versions and where you came from, so we do not have to ask.

## What to do

1. Turn on the test page (set **Camera Test Page Port** under **Advanced**, restart Homebridge, open the `?token=...` link from the log on a computer in your home).
2. If a **camera** misbehaves, press **Test** on its card first. The page shows each step and what the camera answered, and the report link then includes a short summary of it.
3. If another **device** misbehaves, find it under **Other devices** and press **Test and collect report**.
4. Press the **Report** link. A GitHub form opens with the details filled in. Add a sentence on what you expected and what happened, then submit.

Nothing is sent until you press submit on GitHub, and the page removes addresses, names and ids before it fills the form. It is still worth reading what is in the form before you send it.

## What helps most

- **What you did and what you expected.** "I turned night vision on in Home, it stayed off" is perfect.
- **The log lines around it.** Homebridge's log, a few lines either side of the problem. Passwords and tokens are removed by the plugin, but look before you paste.
- **Whether it works in the Wyze app.** If the app cannot do it either, the problem is on Wyze's side.

## If you cannot use the test page

Open an issue on the plugin's [bug report form](https://github.com/wyze-smart-home/homebridge-wyze-smart-home/issues/new?template=bug-report.yml) and fill in the versions by hand (Homebridge, Node, the plugin).

## Going deeper

- **Running a report from the command line**, with `--local` to ask a camera directly and `--discovery` to see what a device answers to: [Local Settings and Test Page](Camera-Local-and-Test-Page.md#the-device-report).
- **Finding out what a setting does.** Change one setting in the Wyze app, then compare two reports: [camera properties](https://github.com/wyze-smart-home/wyze-api/blob/2.0.0/docs/camera-properties.md).

## See also

- [My device is not showing up](Device-Not-Showing-Up.md)
- [Troubleshooting](Troubleshooting.md)
