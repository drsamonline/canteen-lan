/* test-node.js — headless tests for the Canteen order engine, plus a live check.
 * Run: node test-node.js
 *
 * The engine is pure and dependency-free, so the whole mechanic — the menu, the
 * order protocol, status changes, the per-table bill, the calls, replay and the
 * snapshot roundtrip — is tested here without a browser. The last group starts a
 * real lan-host and drives it over SSE + POST, so the transport is exercised too.
 */
"use strict";
var path = require("path");
var http = require("http");
var C = require(path.join(__dirname, "docs", "play", "canteen.js"));

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  (" + extra + ")" : "")); }
}

console.log("Canteen engine " + C.version + " — tests");

/* ---- 1. a fresh board ---- */
(function () {
  var d = C.newDoc();
  ok("newDoc has the default menu", d.menu.length === C.defaultMenu().length && d.menu.length > 0);
  ok("newDoc starts with no orders", d.orders.length === 0 && d.v === 1);
  ok("newDoc starts with no calls", d.calls.length === 0);
  var s = C.stats(d);
  ok("empty stats", s.orders === 0 && s.items === 0 && s.revenue === 0 && s.open === 0);
})();

/* ---- 2. resolving {sku,qty} against the menu ---- */
(function () {
  var d = C.newDoc();
  var items = C.resolveItems(d, [{ sku: "chai", qty: 2 }, { sku: "dosa", qty: 1 }]);
  ok("resolves known skus", items.length === 2);
  ok("snapshots the name", items[0].name === "Masala chai");
  ok("snapshots the price", items[0].price === 1500);
  ok("keeps the qty", items[0].qty === 2);

  var unknown = C.resolveItems(d, [{ sku: "pizza", qty: 1 }]);
  ok("drops an unknown sku", unknown.length === 0);

  var dup = C.resolveItems(d, [{ sku: "chai", qty: 1 }, { sku: "chai", qty: 3 }]);
  ok("merges duplicate lines", dup.length === 1 && dup[0].qty === 4);

  var clamped = C.resolveItems(d, [{ sku: "chai", qty: 9999 }]);
  ok("clamps a huge qty", clamped[0].qty === C.MAX_QTY);

  var zero = C.resolveItems(d, [{ sku: "chai", qty: 0 }, { sku: "chai", qty: -5 }]);
  ok("ignores non-positive qty", zero.length === 0);
})();

/* ---- 3. placing an order ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "o1", table: "12", by: "ana", note: "less spicy",
    items: [{ sku: "chai", qty: 2 }, { sku: "samosa", qty: 1 }] });
  ok("order added", d.orders.length === 1 && d.orders[0].id === "o1");
  ok("table kept", d.orders[0].table === "12");
  ok("status defaults to placed", d.orders[0].status === "placed");
  ok("note kept", d.orders[0].note === "less spicy");
  ok("total is 2*15 + 30 = 60", C.totalOf(d.orders[0]) === 6000);
  ok("an order with no resolvable items is ignored", (function () {
    var e = C.newDoc(); C.apply(e, { t: "order", id: "x", table: "1", items: [{ sku: "nope", qty: 1 }] });
    return e.orders.length === 0;
  })());
})();

/* ---- 4. moving an order along ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "o1", table: "A", items: [{ sku: "thali", qty: 1 }] });
  C.apply(d, { t: "status", id: "o1", status: "preparing" });
  ok("status -> preparing", C.orderById(d, "o1").status === "preparing");
  C.apply(d, { t: "status", id: "o1", status: "served" });
  ok("status -> served", C.orderById(d, "o1").status === "served");
  C.apply(d, { t: "status", id: "o1", status: "nonsense" });
  ok("a bad status falls back to placed", C.orderById(d, "o1").status === "placed");
  C.apply(d, { t: "status", id: "missing", status: "served" });
  ok("status for an unknown order is a no-op", d.orders.length === 1);
})();

/* ---- 5. cancel and the clear-served sweep ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "a", table: "1", items: [{ sku: "chai", qty: 1 }] });
  C.apply(d, { t: "order", id: "b", table: "1", items: [{ sku: "coffee", qty: 1 }] });
  C.apply(d, { t: "cancel", id: "a" });
  ok("cancel marks the order", C.orderById(d, "a").status === "cancelled");
  ok("a cancelled order is not billed", C.tableTotals(d)["1"] === 2000);
  C.apply(d, { t: "status", id: "b", status: "served" });
  C.apply(d, { t: "clear" });
  ok("clear removes served and cancelled", d.orders.length === 0);
  ok("rev advanced", d.rev > 0);
})();

/* ---- 6. the per-table bill ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "a", table: "12", items: [{ sku: "chai", qty: 2 }] });   /* 3000 */
  C.apply(d, { t: "order", id: "b", table: "12", items: [{ sku: "dosa", qty: 1 }] });   /* 6000 */
  C.apply(d, { t: "order", id: "c", table: "7",  items: [{ sku: "thali", qty: 1 }] });  /* 12000 */
  var totals = C.tableTotals(d);
  ok("table 12 total is 9000", totals["12"] === 9000);
  ok("table 7 total is 12000", totals["7"] === 12000);
  ok("ordersForTable returns only that table", C.ordersForTable(d, "12").length === 2);
  ok("stats: 3 orders, 4 items", C.stats(d).orders === 3 && C.stats(d).items === 4);
  ok("stats: revenue is 21000", C.stats(d).revenue === 21000);
  ok("stats: 2 tables", C.stats(d).tables === 2);
  ok("stats: 3 open", C.stats(d).open === 3);
})();

/* ---- 7. calls (call waiter / request bill) ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "call", table: "12", kind: "waiter" });
  ok("call added", d.calls.length === 1 && d.calls[0].kind === "waiter");
  C.apply(d, { t: "call", table: "12", kind: "waiter" });
  ok("a repeat call does not duplicate", d.calls.length === 1);
  C.apply(d, { t: "call", table: "12", kind: "bill" });
  ok("a different kind is a separate call", d.calls.length === 2);
  ok("callsForTable finds them", C.callsForTable(d, "12").length === 2);
  C.apply(d, { t: "call", table: "12", kind: "nonsense" });
  ok("a bad kind is ignored", d.calls.length === 2);
  C.apply(d, { t: "ack", table: "12", kind: "waiter" });
  ok("ack removes one call", C.callsForTable(d, "12").length === 1 && d.calls[0].kind === "bill");
  C.apply(d, { t: "ack", table: "12" });
  ok("ack without a kind clears the table's calls", C.callsForTable(d, "12").length === 0);
})();

/* ---- 8. sanitisation: hostile input cannot poison the board ---- */
(function () {
  ok("bad sku -> empty", C.normSku("PIZZA!") === "");
  ok("sku lowercased", C.normSku("Chai") === "chai");
  ok("table cleaned and uppercased", C.normTable(" t-12 ") === "T-12");
  ok("empty table -> ?", C.normTable("!!!") === "?");
  ok("negative price -> 0", C.normPrice(-5) === 0);
  ok("price clamped", C.normPrice(9e12) === 100000000);
  ok("qty floored", C.normQty(2.9) === 2);
  ok("bad status -> placed", C.normStatus("explode") === "placed");
  var d = C.newDoc();
  C.apply(d, null); C.apply(d, "hi"); C.apply(d, { t: "wat" });
  ok("garbage messages do not throw", d.orders.length === 0);
  C.apply(d, { t: "menu", items: [{ sku: "chai", name: "Chai", price: 1000 }, { sku: "BAD!", name: "x", price: 5 }] });
  ok("menu drops bad skus", d.menu.length === 1 && d.menu[0].sku === "chai");
  C.apply(d, { t: "order", id: "z", table: "1", items: [{ sku: "chai", qty: 1, price: 1 }] });
  ok("a guest cannot set the price", C.totalOf(d.orders[0]) === 1000);
})();

/* ---- 9. snapshot roundtrip ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "o1", table: "5", by: "bo", note: "no onion", items: [{ sku: "dosa", qty: 2 }] });
  C.apply(d, { t: "status", id: "o1", status: "preparing" });
  C.apply(d, { t: "call", table: "5", kind: "bill" });
  var back = C.fromJSON(C.toJSON(d));
  ok("roundtrip keeps the order count", back.orders.length === d.orders.length);
  ok("roundtrip keeps the status", back.orders[0].status === "preparing");
  ok("roundtrip keeps the note", back.orders[0].note === "no onion");
  ok("roundtrip keeps the total", C.totalOf(back.orders[0]) === 12000);
  ok("roundtrip keeps the calls", back.calls.length === 1 && back.calls[0].kind === "bill");
  ok("fromJSON tolerates junk", C.fromJSON("{not json").orders.length === 0);
})();

/* ---- 10. replay rebuilds the same board from history ---- */
(function () {
  var history = [
    { t: "menu", items: [{ sku: "chai", name: "Chai", price: 1000 }, { sku: "samosa", name: "Samosa", price: 3000 }] },
    { t: "order", id: "s1", table: "3", by: "ana", items: [{ sku: "chai", qty: 1 }, { sku: "samosa", qty: 1 }] },
    { t: "order", id: "s2", table: "4", by: "bo", items: [{ sku: "chai", qty: 2 }] },
    { t: "status", id: "s2", status: "served" },
    { t: "cancel", id: "s1" },
    { t: "call", table: "4", kind: "bill" }
  ];
  var live = C.newDoc();
  history.forEach(function (m) { C.apply(live, m); });
  var replayed = C.replay(history);
  ok("replay matches live apply", C.toJSON(replayed) === C.toJSON(live));
  ok("replay kept the cancelled order", C.orderById(replayed, "s1").status === "cancelled");
  ok("replay kept the served order", C.orderById(replayed, "s2").status === "served");
  ok("replay revenue excludes the cancelled order", C.stats(replayed).revenue === 2000);
  ok("replay kept the call", replayed.calls.length === 1);
})();

/* ---- 11. money formatting ---- */
(function () {
  ok("whole rupees", C.money(1500) === "\u20b915");
  ok("paise shown", C.money(1250) === "\u20b912.50");
  ok("single-digit paise padded", C.money(1205) === "\u20b912.05");
  ok("zero", C.money(0) === "\u20b90");
  ok("bad input -> zero", C.money("x") === "\u20b90");
})();

/* ---- 12. the CSV row ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "o1", table: "9", by: "cy", items: [{ sku: "chai", qty: 2 }, { sku: "dosa", qty: 1 }] });
  var row = C.orderToRow(d.orders[0]);
  ok("row table", row.table === "9");
  ok("row items joined", row.items === "2x Masala chai; 1x Masala dosa");
  ok("row total", row.total === "\u20b990");
})();

/* ---- 13. live: the room transport carries a real order ---- */
function get(url, onData) {
  return new Promise(function (resolve) {
    var req = http.get(url, function (res) {
      res.setEncoding("utf8");
      res.on("data", onData);
      res.on("end", resolve);
    });
    req.on("error", function () {});
  });
}
function post(url, obj) {
  return new Promise(function (resolve) {
    var body = JSON.stringify(obj);
    var req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      function (res) { var b = ""; res.on("data", function (c) { b += c; }); res.on("end", function () { resolve({ status: res.statusCode, body: b }); }); });
    req.on("error", function () { resolve({ status: 0 }); });
    req.write(body); req.end();
  });
}

(async function () {
  var { createHost } = require(path.join(__dirname, "host", "lan-host.js"));
  var host = createHost({ room: "canteen-test", history: 50, replay: true });
  var port = await host.listen(0);

  var room = C.newDoc();
  host.onMessage(function (m) { C.apply(room, m); });   /* the host keeps the board */

  /* the host seeds the menu, as host/room.js does */
  host.broadcast({ t: "menu", items: C.defaultMenu() });

  var seen = "";
  get("http://127.0.0.1:" + port + "/events", function (buf) { seen += buf; });
  await new Promise(function (r) { setTimeout(r, 100); });
  ok("a client is connected", host.clients() === 1);

  var r = await post("http://127.0.0.1:" + port + "/send", { t: "order", id: "L1", table: "12", by: "ana", items: [{ sku: "chai", qty: 2 }] });
  ok("POST /send returns ok", r.status === 200 && JSON.parse(r.body).ok === true);

  await new Promise(function (r2) { setTimeout(r2, 120); });
  ok("the SSE client received the menu", seen.indexOf("Masala chai") !== -1);
  ok("the SSE client received the order", seen.indexOf("event: message") !== -1 && seen.indexOf("\"L1\"") !== -1);
  ok("the host board resolved the order", room.orders.length === 1 && C.totalOf(room.orders[0]) === 3000);

  await post("http://127.0.0.1:" + port + "/send", { t: "call", table: "12", kind: "bill" });
  await new Promise(function (r3) { setTimeout(r3, 80); });
  ok("the host board recorded the bill call", room.calls.length === 1 && room.calls[0].kind === "bill");

  var health = await new Promise(function (res) {
    http.get("http://127.0.0.1:" + port + "/health", function (x) { var b = ""; x.on("data", function (c) { b += c; }); x.on("end", function () { res(JSON.parse(b)); }); });
  });
  ok("health reports the room", health.ok === true && health.room === "canteen-test");

  await host.close();
  ok("host closes cleanly", true);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
