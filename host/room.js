#!/usr/bin/env node
/* room.js — run a Canteen room host on your LAN. Zero dependencies.
 *
 *   node host/room.js                            # room "canteen", port 8080
 *   node host/room.js --port 8080 --room canteen
 *   node host/room.js --menu my-menu.json        # seed the menu from a file
 *   node host/room.js --pin 4821                 # a stranger on the Wi-Fi is refused
 *   node host/room.js --print 192.168.1.50:9100  # every order prints a KOT
 *   node host/room.js --data .canteen            # where the journal lives
 *   node host/room.js --mirror 192.168.1.21:8080 # keep a second host in step
 *
 * What the host does:
 *   - serves the board itself at /, so a guest needs no internet and no app store
 *   - keeps a journal on disk, so a restart replays the shift instead of losing it
 *   - replays its history to anyone who joins late
 *   - prints the join address, and a QR, in the terminal
 *   - offers /join (a scannable page), /qr.svg, /state and /report
 *
 * PolyForm Noncommercial License 1.0.0. (c) 2026 Dr Sohil Momin. Part of the Forge system.
 */
"use strict";
const os = require("os");
const fs = require("fs");
const path = require("path");
const { createHost } = require("./lan-host.js");
const qr = require("./qr.js");
const printer = require("./print.js");
const C = require(path.join(__dirname, "..", "docs", "play", "canteen.js"));

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const room = arg("room", "canteen");
const port = parseInt(arg("port", "8080"), 10);
const menuFile = arg("menu", "");
const pin = arg("pin", "");
const dataDir = path.resolve(arg("data", ".canteen"));
const printTarget = printer.parseTarget(arg("print", ""));
const mirrorTarget = printer.parseTarget(arg("mirror", ""));
/* a mirror of the same room usually shares its PIN; --mirror-pin is for when it does not */
const mirrorPin = arg("mirror-pin", pin);
const appDir = path.join(__dirname, "..", "docs", "play");
const journal = path.join(dataDir, "room-" + room + ".jsonl");

function loadMenu() {
  if (!menuFile) return C.defaultMenu();
  try {
    const parsed = JSON.parse(fs.readFileSync(menuFile, "utf8"));
    const menu = C.normMenu(parsed);
    return menu.length ? menu : C.defaultMenu();
  } catch (e) {
    console.error("Could not read menu '" + menuFile + "': " + e.message + " — using the default menu.");
    return C.defaultMenu();
  }
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach((name) => {
    (ifaces[name] || []).forEach((a) => {
      if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address });
    });
  });
  return out;
}

/* ₹120 -> "Rs 120.00": a thermal roll has no rupee glyph. */
function rs(paise) { return "Rs " + (paise / 100).toFixed(2); }

function kotText(order) {
  return printer.docket({
    title: "KOT  table " + order.table,
    lines: order.items.map((l) => [l.qty + " x " + l.name, rs(l.price * l.qty)])
      .concat([[C.totalOf(order) ? "TOTAL" : "", rs(C.totalOf(order))]]),
    foot: (order.by || "") + (order.note ? "\n** " + order.note + " **" : "")
  });
}

function billText(order) {
  return printer.docket({
    title: "BILL  table " + order.table,
    lines: order.items.map((l) => [l.qty + " x " + l.name, rs(l.price * l.qty)])
      .concat([["TOTAL", rs(C.totalOf(order))]]),
    foot: "Thank you · " + new Date().toLocaleString()
  });
}

(async function () {
  /* ---- the board the host keeps: rebuilt from the journal on boot ---- */
  const board = C.newDoc([]);

  const host = createHost({
    room: room, history: 5000, replay: true, pin: pin, journal: journal, appDir: appDir,
    mirror: mirrorTarget ? { host: mirrorTarget.host, port: mirrorTarget.port, pin: mirrorPin } : null,
    routes: {
      "/state": function (req, res) {
        const st = C.stats(board);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          room: room, stats: st, tables: C.tableTotals(board), menu: board.menu,
          orders: board.orders, calls: board.calls, report: C.report(board)
        }));
      },
      "/report": function (req, res) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(C.report(board)));
      },
      "/qr.svg": function (req, res, url) {
        const to = url.searchParams.get("to") || defaultUrl();
        res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" });
        res.end(qr.toSVG(to, { scale: 6, border: 4 }));
      },
      "/join": function (req, res, url) {
        const to = url.searchParams.get("to") || defaultUrl();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(joinPage(to));
      },
      "/print": function (req, res) {
        if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on("end", async () => {
          if (!printTarget) {
            res.writeHead(501, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "no printer configured (start the host with --print host:port)" }));
            return;
          }
          let req2 = {};
          try { req2 = JSON.parse(body || "{}"); } catch (e) {}
          const order = C.orderById(board, req2.id);
          if (!order) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "no such order" })); return; }
          try {
            await printer.send(req2.type === "bill" ? billText(order) : kotText(order), printTarget);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, printer: printTarget }));
          } catch (e) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      }
    }
  });

  /* The journal was loaded before this process could subscribe, so the shift that
     happened before a restart is replayed into the board here. */
  host.history().forEach(function (m) { C.apply(board, m); });

  /* the board follows the room: every message the host broadcasts is applied */
  host.onMessage(function (m) {
    C.apply(board, m);
    if (m.t === "order") {
      const o = C.orderById(board, m.id);
      if (printTarget && o) printer.send(kotText(o), printTarget).catch(function () {});
    }
  });

  const bound = await host.listen(port);

  /* A journal that already holds the menu (because someone edited it from the
     kitchen) wins over the --menu file: the room's live menu is the truth. */
  const seeded = host.history().some(function (m) { return m && (m.t === "menu" || m.t === "menu:set"); });
  if (!seeded) {
    const menu = loadMenu();
    host.broadcast({ t: "menu", items: menu });
  }

  /* The address the code carries, with the PIN in it: scan, and the board opens
     already pointed at this room and already holding the PIN. */
  function defaultUrl(withPin) {
    const a = lanAddresses()[0];
    const base = "http://" + (a ? a.address : "localhost") + ":" + bound + "/";
    return pin && withPin !== false ? base + "?pin=" + encodeURIComponent(pin) : base;
  }

  function joinPage(to) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Join ${room}</title>
<style>
 body{margin:0;background:#0d0e0f;color:#eceae3;font:16px/1.6 system-ui,sans-serif;
      display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
 .card{background:#191c1f;border:1px solid #2b3034;border-radius:6px;padding:26px 24px;max-width:420px;width:100%}
 .k{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#f0a91a}
 h1{font-size:1.5rem;margin:6px 0 4px;font-weight:600}
 p{color:#9a938a;margin:0 0 14px;font-size:14px}
 .qr{background:#fff;padding:10px;border-radius:4px;display:inline-block}
 .qr svg{display:block;width:220px;height:220px}
 code{font-family:ui-monospace,Menlo,monospace;background:#0d0e0f;border:1px solid #2b3034;
      border-radius:4px;padding:10px 12px;display:block;margin:12px 0;font-size:15px;word-break:break-all}
 a{display:inline-block;background:#f0a91a;color:#14120f;text-decoration:none;font-weight:600;
   padding:11px 18px;border-radius:4px;margin-top:6px}
 .pin{font-family:ui-monospace,Menlo,monospace;color:#57b98a}
</style></head><body><div class="card">
 <div class="k">Canteen · room ${room}</div>
 <h1>Scan to order</h1>
 <p>Point the camera at the code, or type the address. Same Wi-Fi, no internet.</p>
 <div class="qr">${qr.toSVG(to, { scale: 5, border: 2 })}</div>
 <code>${to}</code>
 ${pin ? '<p>Room PIN <span class="pin">' + pin + "</span> — needed to send orders.</p>" : ""}
 <a href="${to}">Open the board →</a>
</div></body></html>`;
  }

  console.log("Canteen room host");
  console.log("  room:   " + room);
  console.log("  board:  http://localhost:" + bound + "/  (served from docs/play)");
  console.log("  menu:   " + board.menu.length + " item(s)" + (seeded ? " (restored from the journal)" : " (seeded)"));
  console.log("  pin:    " + (pin ? pin : "none"));
  console.log("  print:  " + (printTarget ? printTarget.host + ":" + printTarget.port : "none (browser print only)"));
  console.log("  mirror: " + (mirrorTarget ? mirrorTarget.host + ":" + mirrorTarget.port : "none"));
  console.log("  journal " + journal);
  lanAddresses().forEach((a) => {
    console.log("  on the LAN (" + a.name + "):  http://" + a.address + ":" + bound + "/");
  });
  console.log("\n  Guests: open that address, or scan the code on /join");
  console.log("  (the code carries the room PIN, so scanning joins in one step)\n");
  try { console.log(qr.toText(defaultUrl(), { border: 1 })); } catch (e) { /* terminal qr is a nicety */ }
  console.log("\nCtrl-C to stop.\n");

  host.onMessage((m) => {
    if (!m) return;
    if (m.t === "order") console.log("  order " + m.id + "  table " + m.table + "  (clients: " + host.clients() + ")");
    else if (m.t === "call") console.log("  call  " + m.kind + "  table " + m.table + "  (clients: " + host.clients() + ")");
    else if (m.t === "menu:set") console.log("  menu  set " + (m.item && m.item.sku) + "  (clients: " + host.clients() + ")");
    else if (m.t === "menu:del") console.log("  menu  del " + m.sku);
    else if (m.t === "menu:sold") console.log("  menu  " + (m.soldOut ? "sold out " : "available ") + m.sku);
    else if (m.t === "clear") console.log("  clear served  (clients: " + host.clients() + ")");
  });
})();
