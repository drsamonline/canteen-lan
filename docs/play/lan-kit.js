/* lan-kit.js — the browser client for a drsamonline LAN room. Zero dependencies.
 *
 * Talks to a lan-host over Server-Sent Events (server -> client) and POST
 * (client -> server). Works on a LAN with no internet and no accounts.
 *
 *   const c = Lan.client({ url: Lan.hostUrl(8080), pin: "4821",
 *                          onOpen:   h => console.log("joined", h.room),
 *                          onMessage: m => console.log("got", m) });
 *   c.send({ from: "me", text: "hello room" });
 *
 * The room PIN (optional) rides on every POST, so a host that set one can refuse
 * a stranger on the same Wi-Fi without any account or token.
 *
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
(function (root) {
  "use strict";
  var Lan = { version: "1.1.0" };

  function base(url) { return String(url || "").replace(/\/+$/, ""); }
  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return s; } }

  Lan.client = function (opts) {
    opts = opts || {};
    var url = base(opts.url || "");
    var pin = opts.pin == null ? "" : String(opts.pin);
    var es = new EventSource(url + "/events");
    es.addEventListener("hello", function (e) { if (opts.onOpen) opts.onOpen(safeParse(e.data)); });
    es.addEventListener("message", function (e) { if (opts.onMessage) opts.onMessage(safeParse(e.data)); });
    es.onerror = function (e) { if (opts.onError) opts.onError(e); };
    return {
      url: url,
      send: function (msg) {
        var body = msg && typeof msg === "object" ? Object.assign({}, msg) : { t: "text", text: msg };
        if (pin) body.pin = pin;
        return fetch(url + "/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }).then(function (r) { return r.json(); });
      },
      close: function () { try { es.close(); } catch (e) {} }
    };
  };

  /* A short, unambiguous room code (no 0/O/1/I/L). */
  Lan.roomCode = function (n) {
    n = n || 4;
    var A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", s = "";
    for (var i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  };

  /* The host URL for this device on the current LAN. */
  Lan.hostUrl = function (port) {
    return "http://" + location.hostname + ":" + (port || 8080);
  };

  root.Lan = Lan;
})(typeof globalThis !== "undefined" ? globalThis : this);
