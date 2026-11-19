# My Wyze device is not showing up

**Short answer:** the plugin only creates what it knows how to control. If your device is not in the Home app, it is either not supported yet, or the plugin could not see it. The camera test page can tell you which, and can send us what we need to add it.

## Quick checks (two minutes)

1. **Is it on the supported list?** Look for your model in the plugin's [Supported hardware](https://github.com/wyze-smart-home/homebridge-wyze-smart-home#supported-hardware) table. If it is under [Not Yet Supported](https://github.com/wyze-smart-home/homebridge-wyze-smart-home#not-yet-supported), it is known and waiting.
2. **Is it in the account you logged in with?** The plugin sees what the Wyze app shows for that login. Open the Wyze app with the same login and check the device is listed there.
3. **Restart Homebridge** and read the log for the device's name. A device the plugin does not know is listed there too, with its model code.

If the model is supported and the device is in the account, see [Troubleshooting](Troubleshooting.md).

## If the model is not supported

You do not need to know anything technical. The test page does the work:

1. In the plugin's settings, open **Advanced** and set **Camera Test Page Port** (`advanced.webServerPort`) to a number from 1024 up, for example `8585`. Restart Homebridge.
2. Find the line in the Homebridge log that ends in `?token=...` and open that link from a computer on your home network.
3. Open the **Other devices** tab. Your device is listed there with its model code.
4. Press **Test and collect report**. It only reads; it changes nothing on the device, and it removes addresses, names and ids from what it shows.
5. Press **Report this device on GitHub**. A form opens with the model and findings already filled in. Read it, then submit it. Nothing is sent until you do.

That report is usually enough for us to add the device, and the report is labelled automatically so a maintainer finds it.

## Going deeper

- **Why some devices need more than one Wyze service.** Wyze has several backends. Which one a device uses decides what can be read and changed: [Endpoints](https://github.com/wyze-smart-home/wyze-api/blob/2.0.0/docs/endpoints.md).
- **What a camera may be able to do** besides what the plugin uses now: [Local Settings and Test Page](Camera-Local-and-Test-Page.md).
- **Running the same scan without Homebridge**, to attach a file to an issue: the [device report](Camera-Local-and-Test-Page.md#the-device-report).

## See also

- [Report a problem](Report-a-Problem.md)
- [Troubleshooting](Troubleshooting.md)
