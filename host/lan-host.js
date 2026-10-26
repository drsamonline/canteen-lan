/* lan-host.js — the tiny LAN host for drsamonline apps. Zero dependencies.
 *
 * A local HTTP server that gives a room a real-time channel with no framework
 * and no WebSocket library: server -> clients over Server-Sent Events, and
 * clients -> server over plain POST. Works on a LAN with no internet.
 *
 *   const host = require("./lan-host.js").createHost({ room: "canteen" });
 *   const port = await host.listen(0);            // 0 = any free port
 *   host.onMessage(m => console.log("got", m));   // observe
 *   host.broadcast({ hello: "room" });            // push to everyone
 *
 * PolyForm Noncommercial License 1.0.0. (c) 2026 Dr Sohil Momin.
 */
"use strict";
const http = require("http");

function createHost(opts) {
  opts = opts || {};
  const room = opts.room || "default";
  const clients = new Set();
  const handlers = [];
  const history = [];                 // last N messages, for late joiners
  const HISTORY_MAX = opts.history === undefined ? 50 : opts.history;

  function broadcast(msg) {
    if (HISTORY_MAX) { history.push(msg); if (history.length > HISTORY_MAX) history.shift(); }
    const payload = "event: message\ndata: " + JSON.stringify(msg) + "\n\n";
    for (const c of Array.from(clients)) {
      try { c.write(payload); } catch (e) { clients.delete(c); }
    }
    handlers.forEach(function (h) { try { h(msg); } catch (e) {} });
  }

  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    if (url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 2000\n\n");
      res.write("event: hello\ndata: " + JSON.stringify({ room: room, clients: clients.size + 1 }) + "\n\n");
      if (opts.replay) history.forEach(function (m) { res.write("event: message\ndata: " + JSON.stringify(m) + "\n\n"); });
      clients.add(res);
      const ping = setInterval(function () { try { res.write(": ping\n\n"); } catch (e) {} }, 15000);
      req.on("close", function () { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (url.pathname === "/send" && req.method === "POST") {
      let body = "";
      req.on("data", function (c) { body += c; if (body.length > 1e6) req.destroy(); });
      req.on("end", function () {
        let msg;
        try { msg = JSON.parse(body); } catch (e) { msg = { type: "text", text: body }; }
        broadcast(msg);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, clients: clients.size }));
      });
      return;
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, room: room, clients: clients.size }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  return {
    room: room,
    listen: function (port) {
      return new Promise(function (resolve) {
        server.listen(port || 0, function () { resolve(server.address().port); });
      });
    },
    broadcast: broadcast,
    onMessage: function (h) { handlers.push(h); },
    clients: function () { return clients.size; },
    close: function () {
      for (const c of Array.from(clients)) { try { c.end(); } catch (e) {} }
      return new Promise(function (resolve) { server.close(function () { resolve(); }); });
    },
  };
}

module.exports = { createHost: createHost };
