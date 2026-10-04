// src/storage-shim.js  (imported first in main.jsx, so it installs before React mounts)
//
// The app only ever touches window.storage - it never talks to the network itself. That makes
// this file the whole persistence layer, which is why moving Orbit off the browser and onto a
// server was a change here plus a small API, rather than a rewrite.
//
// The contract the app relies on:
//   get(key)        -> { key, value } | null      (null means nothing stored yet)
//   set(key, value) -> { key, value }
//
// A 404 is "no data yet" and is not an error. Anything else - offline, a 5xx, a body that isn't
// JSON - throws. That distinction is deliberate and the app depends on it: the boot effect used
// to treat every failure as "no data yet" and carry on with default groups, which over a network
// would let a transient outage overwrite real entries with an empty list.

const BASE = "/api/storage";

async function json(res) {
  try {
    return await res.json();
  } catch {
    throw new Error(`storage returned a non-JSON body (${res.status})`);
  }
}

if (!window.storage) {
  window.storage = {
    async get(key) {
      const res = await fetch(`${BASE}/${encodeURIComponent(key)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`couldn't load (${res.status})`);
      return json(res);
    },

    async set(key, value) {
      const res = await fetch(`${BASE}/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: value,
      });
      if (!res.ok) throw new Error(`couldn't save (${res.status})`);
      return json(res);
    },
  };
}
