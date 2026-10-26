#!/usr/bin/env node
/* room.js — run a Canteen room host on your LAN. Zero dependencies.
 *
 *   node host/room.js                          # room "canteen", port 8080
 *   node host/room.js --room canteen --port 8080
 *   node host/room.js --menu my-menu.json      # override the menu (JSON array)
 *
 * The host keeps the last 500 messages and replays them to a late joiner, and it
 * seeds the room with the menu so every device that joins sees the same prices.
 *
 * PolyForm Noncommercial License 1.0.0. (c) 2026 Dr Sohil Momin. Part of the Forge system.
 */
"use strict";
const os = require("os");
const fs = require("fs");
const path = require("path");
const { createHost } = require("./lan-host.js");
const C = require(path.join(__dirname, "..", "docs", "play", "canteen.js"));

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const room = arg("room", "canteen");
const port = parseInt(arg("port", "8080"), 10);
const menuFile = arg("menu", "");

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

(async function () {
  const host = createHost({ room: room, history: 500, replay: true });
  const bound = await host.listen(port);

  const menu = loadMenu();
  /* Seed the room: this lands in history, so a late joiner is caught up. */
  host.broadcast({ t: "menu", items: menu });

  console.log("Canteen room host");
  console.log("  room:  " + room);
  console.log("  menu:  " + menu.length + " item(s)");
  console.log("  on this machine:  http://localhost:" + bound);
  lanAddresses().forEach((a) => {
    console.log("  on the LAN (" + a.name + "):  http://" + a.address + ":" + bound);
  });
  console.log("\nOpen the Canteen board on every device and enter the LAN address above.");
  console.log("Ctrl-C to stop.\n");

  host.onMessage((m) => {
    if (!m) return;
    if (m.t === "order") console.log("  order " + m.id + "  table " + m.table + "  (clients: " + host.clients() + ")");
    else if (m.t === "call") console.log("  call  " + m.kind + "  table " + m.table + "  (clients: " + host.clients() + ")");
    else if (m.t === "clear") console.log("  clear served  (clients: " + host.clients() + ")");
  });
})();
