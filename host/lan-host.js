/* lan-host.js — the tiny LAN host for drsamonline apps. Zero dependencies.
 *
 * A local HTTP server that gives a room a real-time channel with no framework
 * and no WebSocket library: server -> clients over Server-Sent Events, and
 * clients -> server over plain POST. Works on a LAN with no internet.
 *
 *   const host = require("./lan-host.js").createHost({
 *     room: "canteen",
 *     pin: "4821",              // optional: every POST must carry it
 *     journal: "/tmp/room.jsonl",  // optional: the history survives a restart
 *     appDir: "../docs/play",   // optional: serve the app itself from here
 *     mirror: {host, port, pin},// optional: keep a second host in step
 *     routes: { "/state": (req, res, url) => {...} }
 *   });
 *   const port = await host.listen(0);
 *   host.onMessage(m => console.log("got", m));
 *   host.broadcast({ hello: "room" });
 *
 * PolyForm Noncommercial License 1.0.0. (c) 2026 Dr Sohil Momin.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

function createHost(opts) {
  opts = opts || {};
  const room = opts.room || "default";
  const pin = opts.pin ? String(opts.pin) : "";
  const clients = new Set();
  const handlers = [];
  const history = [];                 // last N messages, for late joiners
  const HISTORY_MAX = opts.history === undefined ? 500 : opts.history;
  const journal = opts.journal || "";
  const appDir = opts.appDir ? path.resolve(opts.appDir) : "";
  const routes = opts.routes || {};
  const mirror = opts.mirror || null;

  /* A second host on the LAN receives every message this one broadcasts, so the
     counter keeps running if the first machine dies. `_via` is what stops the
     two of them forwarding the same message at each other forever. */
  function mirrorSend(msg) {
    if (!mirror || !msg || msg._via) return;
    const body = JSON.stringify(Object.assign({}, msg, { _via: "mirror", pin: mirror.pin || "" }));
    const req = http.request({
      host: mirror.host, port: Number(mirror.port) || 8080, path: "/send", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 3000
    }, function (res) { res.resume(); });
    req.on("error", function () { /* a dead mirror must not stop the room */ });
    req.on("timeout", function () { req.destroy(); });
    req.end(body);
  }

  /* ---- the journal: history that survives a restart ---- */

  function journalLoad() {
    if (!journal) return;
    let text = "";
    try { text = fs.readFileSync(journal, "utf8"); } catch (e) { return; }
    text.split("\n").forEach(function (line) {
      if (!line.trim()) return;
      try {
        const m = JSON.parse(line);
        history.push(m);
        if (history.length > HISTORY_MAX) history.shift();
      } catch (e) { /* a half-written last line is not a reason to refuse to boot */ }
    });
  }

  function journalAppend(msg) {
    if (!journal) return;
    try {
      fs.mkdirSync(path.dirname(journal), { recursive: true });
      fs.appendFileSync(journal, JSON.stringify(msg) + "\n");
    } catch (e) { /* the room keeps running; the journal is best-effort */ }
  }

  journalLoad();

  function broadcast(msg) {
    if (HISTORY_MAX) { history.push(msg); if (history.length > HISTORY_MAX) history.shift(); }
    journalAppend(msg);
    const payload = "event: message\ndata: " + JSON.stringify(msg) + "\n\n";
    for (const c of Array.from(clients)) {
      try { c.write(payload); } catch (e) { clients.delete(c); }
    }
    handlers.forEach(function (h) { try { h(msg); } catch (e) {} });
    mirrorSend(msg);
  }

  /* ---- static: the board is served by the host, so a guest needs no internet ---- */

  function serveFile(res, file) {
    fs.readFile(file, function (err, buf) {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const isDoc = ext === ".html";
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Length": buf.length,
        "Cache-Control": isDoc ? "no-cache" : "public, max-age=300",
        "Service-Worker-Allowed": "/"
      });
      res.end(buf);
    });
  }

  function serveApp(url, res) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(appDir, rel);
    /* never let a path escape the app directory */
    if (!file.startsWith(appDir + path.sep) && file !== path.join(appDir, "index.html")) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("forbidden");
      return;
    }
    serveFile(res, file);
  }

  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-room-pin");
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
      res.write("event: hello\ndata: " + JSON.stringify({ room: room, pin: !!pin, clients: clients.size + 1 }) + "\n\n");
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
        try { msg = JSON.parse(body); } catch (e) { msg = null; }
        if (!msg || typeof msg !== "object") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "bad json" }));
          return;
        }
        if (pin && String(msg.pin == null ? "" : msg.pin) !== pin) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "pin" }));
          return;
        }
        delete msg.pin;                       /* the room never sees the secret */
        broadcast(msg);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, clients: clients.size }));
      });
      return;
    }

    /* The shift as a file. A backup that needs no shell: download the journal
       from the board, and put it back the same way. */
    if (url.pathname === "/journal") {
      if (req.method === "GET") {
        const body = history.map(function (m) { return JSON.stringify(m); }).join("\n") + "\n";
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": 'attachment; filename="canteen-' + room + '.jsonl"',
          "Cache-Control": "no-cache"
        });
        res.end(body);
        return;
      }
      if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
      let body = "";
      req.on("data", function (c) { body += c; if (body.length > 8e6) req.destroy(); });
      req.on("end", function () {
        if (pin && String(req.headers["x-room-pin"] || "") !== pin) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "pin" }));
          return;
        }
        const lines = String(body).split("\n").filter(function (l) { return l.trim(); });
        let restored = 0, refused = 0;
        lines.slice(-5000).forEach(function (line) {
          let m;
          try { m = JSON.parse(line); } catch (e) { refused++; return; }
          if (!m || typeof m !== "object" || Array.isArray(m)) { refused++; return; }
          delete m.pin; delete m._via;
          broadcast(m);              /* journals it, applies it, tells every client */
          restored++;
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, restored: restored, refused: refused }));
      });
      return;
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      if (url.pathname === "/" && appDir) { serveApp(url, res); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, room: room, clients: clients.size, pin: !!pin,
        mirror: mirror ? mirror.host + ":" + mirror.port : null }));
      return;
    }

    if (routes[url.pathname]) { routes[url.pathname](req, res, url); return; }

    if (appDir) { serveApp(url, res); return; }

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
    history: function () { return history.slice(); },
    close: function () {
      for (const c of Array.from(clients)) { try { c.end(); } catch (e) {} }
      return new Promise(function (resolve) { server.close(function () { resolve(); }); });
    },
  };
}

module.exports = { createHost: createHost };
