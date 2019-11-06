/**
 * Author: Ben West
 * https://github.com/bewest
 * Advisor: Scott Hanselman
 * http://www.hanselman.com/blog/BridgingDexcomShareCGMReceiversAndNightscout.aspx
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 *
 * @description: Allows user to store their Dexcom data in their own
 * Nightscout server by facilitating the transfer of latest records
 * from Dexcom's server into theirs.
 */
const fetch = require("node-fetch");
const qs = require("querystring");
const crypto = require("crypto");

// Defaults
const bridge = getenv("DEXCOM_SERVER");
const server = bridge == "US" ? "share1.dexcom.com"
  : bridge == "EU" ? "shareous1.dexcom.com"
  : bridge && bridge.indexOf(".") > 1 ? bridge
  : "share1.dexcom.com";

const Defaults = {
  applicationId: "d89443d2-327c-4a6f-89e5-496bbb0317db",
  agent: "Dexcom Share/3.0.2.11 CFNetwork/711.2.23 Darwin/14.0.0",
  login: `https://${server}/ShareWebServices/Services/General/LoginPublisherAccountByName`,
  accept: "application/json",
  "content-type": "application/json",
  LatestGlucose: `https://${server}/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues`,
  // ?sessionID=e59c836f-5aeb-4b95-afa2-39cf2769fede&minutes=1440&maxCount=1"
  MIN_PASSPHRASE_LENGTH: 12
};

function trendToDirection(trend) {
  const Trends = [
    "NONE",
    "ExtremeRise",
    "FastRise",
    "Rise",
    "Flat",
    "Fall",
    "FastFall",
    "ExtremeFall",
    "NOT COMPUTABLE",
    "RATE OUT OF RANGE"
  ];
  return Trends[trend] || Trends[0];
}

// assemble the POST body for the login endpoint
function login_payload(opts) {
  var body = {
    password: opts.password,
    applicationId: opts.applicationId || Defaults.applicationId,
    accountName: opts.accountName
  };
  return body;
}

// Login to Dexcom's server.
function authorize(opts) {
  const url = Defaults.login;
  const body = login_payload(opts);
  const headers = {
    "User-Agent": Defaults.agent,
    "Content-Type": Defaults["content-type"],
    Accept: Defaults.accept
  };
  const req = {
    body: JSON.stringify(body),
    headers,
    method: "POST"
  };

  return _fetch(url, req); 
}

async function _fetch(url, opts) {
  const res = await fetch(url, opts);
  if (res.ok) {
    return await res.json();
  } else {
    const body = await res.text();
    throw new Error(`Status code ${res.status}, ${body}`);
  }
}

// Assemble query string for fetching data.
function fetch_query(opts) {
  // ?sessionID=e59c836f-5aeb-4b95-afa2-39cf2769fede&minutes=1440&maxCount=1"
  const q = {
    sessionID: opts.sessionID,
    minutes: opts.minutes || 1440,
    maxCount: opts.maxCount || 1
  };
  return `${Defaults.LatestGlucose}?${qs.stringify(q)}`;
}

// Asynchronously fetch data from Dexcom's server.
// Will fetch `minutes` and `maxCount` records.
function fetchData(opts) {
  var url = fetch_query(opts);
  var body = "";
  var headers = {
    "User-Agent": Defaults.agent,
    "Content-Type": Defaults["content-type"],
    "Content-Length": 0,
    Accept: Defaults.accept
  };

  var req = {
    body: body,
    json: true,
    headers: headers,
    method: "POST",
    rejectUnauthorized: false
  };
  return _fetch(url, req);
}

// Authenticate and fetch data from Dexcom.
async function do_everything(opts, then) {
  var login_opts = opts.login;
  var fetch_opts = opts.fetch;
  const sessionID = await authorize(login_opts);
  fetch_opts.sessionID = body;
  const glucose = await fetchData(fetch_opts);
  return glucose;
}

// Map Dexcom's property values to Nightscout's.
function dex_to_entry(d) {
  /*
[ { DT: '/Date(1426292016000-0700)/',
    ST: '/Date(1426295616000)/',
    Trend: 4,
    Value: 101,
    WT: '/Date(1426292039000)/' } ]
*/
  const extractTimestamp = /\(([0-9]*)\)/;
  const wall = Number(d.WT.match(extractTimestamp)[1]);
  return {
    type: "sgv", content: {
      sgv: d.Value,
      ts: wall,
      direction: trendToDirection(d.Trend),
      device: "share2",
    }
  };
}

function engine(opts) {
  var runs = 0;
  var failures = 0;
  async function my() {
    console.log("RUNNING", runs, "failures", failures);
    if (my.sessionID) {
      var fetch_opts = Object.create(opts.fetch);
      if (runs === 0) {
        console.log("First run, fetching", opts.firstFetchCount);
        fetch_opts.maxCount = opts.firstFetchCount;
      }
      fetch_opts.sessionID = my.sessionID;
      try {
        const glucose = await fetchData(fetch_opts)
        to_nightscout(glucose);
      } catch (e) {
        console.warn(e);
        my.sessionID = null;
        return refresh_token();
      }
    } else {
      failures++;
      return refresh_token();
    }
  }

  async function refresh_token() {
    console.log("Fetching new token");
    try {
      const sessionID = await authorize(opts.login);
      my.sessionID = sessionID;
      failures = 0;
      return my();
    } catch (err) {
      failures++;
      console.warn("Error refreshing token", err);
      if (failures >= opts.maxFailures) {
        throw "Too many login failures, check DEXCOM_USER_NAME and DEXCOM_PASSWORD";
      }
    }
  }

  function to_nightscout(glucose) {
    if (glucose) {
      runs++;
      // Translate to Nightscout data.
      var entries = glucose.map(dex_to_entry);
      log_entries(entries);
    }
  }

  my();
  return my;
}

function getenv(varName, defaultValue) {
  const value = process.env[varName]
  return value || defaultValue;
}

// If run from commandline, run the whole program.
if (getenv("DEXCOM_USER_NAME", "@").match(/\@/)) {
  throw new Error("environment variable DEXCOM_USER_NAME should be Dexcom Share user name, not an email address");
}

const args = process.argv.slice(2);

const config = {
  accountName: getenv("DEXCOM_USER_NAME"),
  password: getenv("DEXCOM_PASSWORD")
};

const interval = Math.max(60000, getenv("SHARE_INTERVAL", 60000 * 2.5));
const fetch_config = {
  maxCount: getenv("maxCount", 1),
  minutes: getenv("minutes", 1440)
};
const meta = {
  login: config,
  fetch: fetch_config,
  maxFailures: getenv("maxFailures", 3),
  firstFetchCount: getenv("firstFetchCount", 3)
};

setInterval(engine(meta), interval);

function log_entries(entries) {
  for (const entry of entries) {
    if (global.postMessage) {
      global.postMessage(entry);
    } else {
      console.log(JSON.stringify(entry));
    }
  }
}
