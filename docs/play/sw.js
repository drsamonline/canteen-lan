/* sw.js — the board keeps working when the Wi-Fi blinks. Zero dependencies.
 *
 * The rule that matters: HTML is served NETWORK-FIRST (the cache is only the
 * offline fallback), assets are CACHE-FIRST with a background refresh, and CACHE
 * is bumped on every release. A cache-first worker hides every release from a
 * returning reader — that is the bug this file exists to avoid.
 *
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
"use strict";

var CACHE = "canteen-1.4.0";
var ASSETS = [
  "./",
  "index.html",
  "canteen.js",
  "qr.js",
  "lan-kit.js",
  "web-kit.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;                       /* never touch /send */
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  var isDoc = req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") >= 0;
  if (isDoc) {
    /* network first: a new release is never hidden behind a stale cache */
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match("index.html"); });
    }));
    return;
  }

  /* assets: cache first, refresh in the background */
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
