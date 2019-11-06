cgm-plugin-dexcom-share
=======================

This plugin fetches data from dexcom share and relays it so the cgm can integrate it.

The bridge periodically queries Dexcom's Share web services for new CGM data.

### Prerequisites

* A working Dexcom Share receiver paired to an Apple device that is
  successfully uploading data to Dexcom.  You must be able to see the Dexcom
  data in the Dexcom Follow app for the bridge to work.
* Your Dexcom Sharer username and password
* A working CGM installation

### Environment

`VARIABLE` (default) - description

#### Required

* `DEXCOM_ACCOUNT_NAME` - Your Dexcom Share2 username
* `DEXCOM_PASSWORD` - Your Dexcom Share2 password

#### Optional

* `maxCount` (1) - The maximum number of records to fetch per update
* `minutes` (1440) - The time window to search for new data per update (default is one day in minutes)
* `firstFetchCount` (3) - Changes `maxCount` during the very first update only.
* `maxFailures` (3) - The program will stop running after this many
  consecutively failed login attempts with a clear error message in the logs.
* `SHARE_INTERVAL` (150000) - The time to wait between each update (default is 2.5 minutes in milliseconds)
* `NS` - A fully-qualified Nightscout URL (e.g. `https://sitename.herokuapp.com`) which overrides `WEBSITE_HOSTNAME`

#### Azure Specific

* It is highly recommended that you set the `API_SECRET`, `DEXCOM_ACCOUNT_NAME` and `DEXCOM_PASSWORD` in **Connection Strings**.
* No need to set `WEBSITE_HOSTNAME` because the value is obtained from the existing [Azure website environment][azure-environment].

### More information

[As described by Scott Hanselman][blog-post], the bridge logs in to Dexcom
Share as the data publisher.  It re-uses the token every `5` minutes to fetch
the `maxCount` latest glucose records within the last specified `minutes`.
This information is then sent to the user's specified Nightscout install,
making the data available to the beloved pebble watch and other equipment owned
and operated by the receiver's owner.  It will continue to re-use the same
`sessionID` until it expires, at which point it should attempt to log in again.
If it can log in again, it will continue to re-use the new token to fetch data,
storing it into Nightscout.

This project is not FDA approved, not recommended for therapy, and not
recommended by [Dexcom][dexcom-eula].

