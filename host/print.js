/* print.js — a docket to a thermal printer on the same LAN, over raw ESC/POS.
 *
 * No driver, no CUPS, no package: an 80 mm receipt printer listens on TCP 9100
 * and takes ESC/POS bytes, so this is a socket and a string. The canteen's
 * kitchen printer is the one place an order is allowed to leave the board, and
 * it is on the same Wi-Fi.
 *
 *   node host/room.js --print 192.168.1.50:9100
 *
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
"use strict";
const net = require("net");

const ESC = "\x1b", GS = "\x1d";
const INIT = ESC + "@";
const ALIGN_LEFT = ESC + "a\x00";
const ALIGN_CENTER = ESC + "a\x01";
const BOLD_ON = ESC + "E\x01";
const BOLD_OFF = ESC + "E\x00";
const FEED = "\n\n\n";
const CUT = GS + "V\x00";

/* A docket as plain text, 32 columns — the width of a 58 mm roll. */
function docket(opts) {
  opts = opts || {};
  const width = opts.width || 32;
  const out = [];
  function rule(ch) { return (ch || "-").repeat(width); }
  function pair(left, right) {
    left = String(left); right = String(right);
    const gap = Math.max(1, width - left.length - right.length);
    return left + " ".repeat(gap) + right;
  }
  out.push(rule("="));
  out.push(String(opts.title || "").toUpperCase());
  out.push(rule("="));
  (opts.lines || []).forEach(function (l) {
    if (Array.isArray(l)) out.push(pair(l[0], l[1]));
    else out.push(String(l));
  });
  if (opts.foot) { out.push(rule("-")); String(opts.foot).split("\n").forEach(function (f) { out.push(f); }); }
  out.push(rule("="));
  return out.join("\n") + "\n";
}

/* Text -> ESC/POS bytes. ASCII only: a thermal roll has no glyphs for ₹, so
 * amounts are written "Rs 120.00" by the caller. */
function encode(text, opts) {
  opts = opts || {};
  const body = String(text).replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?");
  return Buffer.from(INIT + ALIGN_LEFT + body + FEED + CUT, "latin1");
}

/* Send a docket. Resolves {ok, bytes}; rejects only on a socket error. */
function send(text, target) {
  target = target || {};
  const host = target.host || "127.0.0.1";
  const port = Number(target.port) || 9100;
  const bytes = encode(text, target);
  return new Promise(function (resolve, reject) {
    const sock = net.connect({ host: host, port: port });
    let done = false;
    const finish = function (err) {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (e) {}
      if (err) reject(err); else resolve({ ok: true, bytes: bytes.length, host: host, port: port });
    };
    sock.setTimeout(Number(target.timeout) || 4000, function () { finish(new Error("printer timeout")); });
    sock.on("connect", function () { sock.write(bytes, function () { finish(null); }); });
    sock.on("error", finish);
  });
}

/* "192.168.1.50:9100" -> {host, port} */
function parseTarget(s) {
  if (!s) return null;
  const m = String(s).match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return null;
  return { host: m[1], port: Number(m[2]) || 9100 };
}

module.exports = { docket: docket, encode: encode, send: send, parseTarget: parseTarget };
