/* host/qr.js — the QR encoder lives in docs/play/qr.js, because the board draws
 * the guest's bill slip with it too. This is the Node door to that one copy.
 *
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
"use strict";
module.exports = require(require("path").join(__dirname, "..", "docs", "play", "qr.js"));
