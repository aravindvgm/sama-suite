"use strict";

/**
 * Backwards-compatible entry: some tooling reads package.json "main".
 * Canonical production bootstrap is `node index.js` from core-backend root.
 *
 * This file only exports the same Express `app` as ../server.js — it does
 * not call listen(), so `node src/server.js` alone will not bind a port.
 * Use `npm start` / `node index.js` for the full server + migrations.
 */

module.exports = require("../server");
