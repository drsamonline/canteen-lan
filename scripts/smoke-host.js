#!/usr/bin/env node
/* smoke-host.js — start the real host, talk to it over HTTP, restart it, check the journal.
 *
 *   node scripts/smoke-host.js
 *
 * `test-node.js` covers the engine, the transport and the page. This covers the one
 * thing it cannot: `host/room.js` wiring its routes, its PIN, its journal and its
 * printer together, in a real process, twice — because "the shift survived a restart"
 * is a claim that has to be run, not read.
 *
 * Zero dependencies. Cleans up after itself.
 *
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
"use strict";
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "canteen-smoke-"));
const PIN = "4321";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  (" + extra + ")" : "")); }
}

function start(port) {
  const c = spawn("node", ["host/room.js", "--port", String(port), "--pin", PIN, "--data", data], { cwd: REPO });
  c.out = "";
  c.stdout.on("data", (d) => (c.out += d));
  c.stderr.on("data", (d) => (c.out += d));
  return c;
}
function get(port, p) {
  return new Promise((res) => {
    http.get("http://127.0.0.1:" + port + p, (r) => {
      let b = ""; r.on("data", (c) => (b += c));
      r.on("end", () => res({ status: r.statusCode, body: b, type: r.headers["content-type"] }));
    }).on("error", () => res({ status: 0, body: "" }));
  });
}
function post(port, p, obj) {
  return new Promise((res) => {
    const body = JSON.stringify(obj);
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res({ status: r.statusCode, body: b })); });
    req.on("error", () => res({ status: 0, body: "" }));
    req.write(body); req.end();
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  console.log("Canteen host — smoke test");
  const A = 18097, B = 18096;

  /* ---- the first shift ---- */
  const a = start(A);
  await wait(1300);

  const home = await get(A, "/");
  ok("GET / serves the board itself", home.status === 200 && /Canteen/.test(home.body) && /text\/html/.test(home.type));
  const js = await get(A, "/canteen.js");
  ok("GET /canteen.js serves the engine", js.status === 200 && /javascript/.test(js.type));
  const qr = await get(A, "/qr.svg");
  ok("GET /qr.svg draws a scannable code", qr.status === 200 && /^<svg/.test(qr.body));
  const join = await get(A, "/join");
  ok("GET /join is a page a phone can scan", join.status === 200 && /Scan to order/.test(join.body) && join.body.indexOf(PIN) !== -1);
  const escape = await get(A, "/../../etc/passwd");
  ok("a path cannot escape the app directory", escape.status === 403 || escape.status === 404);

  ok("POST /send without the pin is refused", (await post(A, "/send", { t: "order", id: "sm1", table: "3", items: [{ sku: "chai", qty: 1 }] })).status === 403);
  ok("POST /send with a wrong pin is refused", (await post(A, "/send", { t: "order", id: "sm1", table: "3", pin: "0000", items: [{ sku: "chai", qty: 1 }] })).status === 403);
  ok("POST /send with the pin is accepted", (await post(A, "/send", { t: "order", id: "sm1", table: "3", pin: PIN, items: [{ sku: "chai", qty: 2 }] })).status === 200);
  ok("a dish can be added over the wire", (await post(A, "/send", { t: "menu:set", pin: PIN, item: { sku: "misal", name: "Misal pav", price: 7000, tags: ["spicy"] } })).status === 200);
  ok("a dish can be marked sold out", (await post(A, "/send", { t: "menu:sold", pin: PIN, sku: "misal", soldOut: true })).status === 200);
  await wait(350);

  const state = JSON.parse((await get(A, "/state")).body);
  ok("/state shows the order", state.orders.length === 1 && state.stats.revenue === 3000);
  ok("/state shows the new dish", state.stats.menu === 11);
  ok("/state shows it sold out", state.stats.soldOut === 1);
  const report = JSON.parse((await get(A, "/report")).body);
  ok("/report computes the shift", report.covers === 1 && report.revenue === 3000);
  ok("/print without a printer explains itself", (await post(A, "/print", { id: "sm1", type: "kot" })).status === 501);
  ok("the host drew a join QR in the terminal", /██/.test(a.out));
  ok("the pin never reaches the room", JSON.stringify(state.orders).indexOf(PIN) === -1);

  a.kill();
  await wait(400);

  /* ---- the same shift, after a restart ---- */
  const b = start(B);
  await wait(1500);
  const after = JSON.parse((await get(B, "/state")).body);
  ok("the shift survives a restart", after.orders.length === 1 && after.stats.revenue === 3000);
  ok("the menu edit survives a restart", after.stats.menu === 11 && after.stats.soldOut === 1);
  ok("the host says it restored from the journal", /restored from the journal/.test(b.out));
  b.kill();

  const lines = fs.readFileSync(path.join(data, "room-canteen.jsonl"), "utf8").trim().split("\n");
  ok("the journal is plain JSONL, one message per line", lines.length >= 3 && lines.every(function (l) {
    try { return !!JSON.parse(l); } catch (e) { return false; }
  }));

  fs.rmSync(data, { recursive: true, force: true });
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
