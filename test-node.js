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
  /* the audit log stamps wall-clock time, so two runs differ by a millisecond or
     two; everything else must be identical */
  var stripTs = function (json) {
    var o = JSON.parse(json);
    (o.log || []).forEach(function (e) { e.ts = 0; });
    return JSON.stringify(o);
  };
  ok("replay matches live apply", stripTs(C.toJSON(replayed)) === stripTs(C.toJSON(live)));
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

/* ---- 13. the demo board the landing page embeds ---- */
(function () {
  var T = 1767225600000;                       /* a fixed clock: the demo carries recent stamps */
  var d = C.demoDoc(T);
  ok("demoDoc is deterministic", C.toJSON(C.demoDoc(T)) === C.toJSON(d));
  ok("the demo orders look recently placed", C.ageMinutes(d.orders[0], T) === 6);
  ok("demo has orders on several tables", d.orders.length === 4 && C.stats(d).tables === 3);
  ok("demo shows every status", ["placed", "preparing", "served"].every(function (s) {
    return d.orders.some(function (o) { return o.status === s; });
  }));
  ok("demo has a bill and a waiter call", d.calls.length === 2);
  ok("demo revenue is the live bill", C.stats(d).revenue === C.tableTotals(d)["4"] + C.tableTotals(d)["7"] + C.tableTotals(d)["12"]);
  ok("demo survives the snapshot roundtrip", C.toJSON(C.fromJSON(C.toJSON(d))) === C.toJSON(d));
  ok("a live demo is not stamped in 1970", Math.abs(Date.now() - C.demoDoc().orders[0].ts) < 3600000);
})();

/* ---- 14. the page ships everything it loads (the bug that shipped a dead app) ---- */
(function () {
  var fs = require("fs");
  var play = path.join(__dirname, "docs", "play");
  var html = fs.readFileSync(path.join(play, "index.html"), "utf8");
  var srcs = (html.match(/<script[^>]+src="([^"]+)"/g) || []).map(function (s) {
    return s.replace(/^.*src="([^"]+)".*$/, "$1");
  });
  ok("the page loads its scripts", srcs.length >= 3);
  srcs.forEach(function (s) {
    ok("script present: " + s, !/^(https?:)?\/\//.test(s) && fs.existsSync(path.join(play, s)));
  });
  ok("web-kit is shipped locally", srcs.indexOf("web-kit.js") !== -1);
  ok("no external asset in the app page", !/(src|href)="https?:\/\//.test(html));
  var webkit = fs.readFileSync(path.join(play, "web-kit.js"), "utf8");
  ["storage", "i18n", "csv", "theme", "seo", "ui"].forEach(function (k) {
    ok("web-kit exposes " + k, new RegExp("Loom\\." + k + "\\s*=").test(webkit));
  });
  ok("web-kit fetches nothing", !/fetch\(|XMLHttpRequest|https?:\/\//.test(webkit));
})();

/* ---- 16. the menu is editable, and that is the whole point ---- */
(function () {
  var d = C.newDoc();
  var added = C.upsertMenuItem(d, { sku: "misal", name: "Misal pav", price: 7000,
    tags: ["veg", "spicy"], names: { hi: "\u092e\u093f\u0938\u0933 \u092a\u093e\u0935" } });
  ok("add an item", !!added && d.menu.length === C.defaultMenu().length + 1);
  ok("the price is in paise", C.menuItem(d, "misal").price === 7000);
  ok("tags are kept", C.menuItem(d, "misal").tags.indexOf("spicy") >= 0);
  ok("the hindi name is kept", C.menuItem(d, "misal").names.hi === "\u092e\u093f\u0938\u0933 \u092a\u093e\u0935");
  ok("an unknown tag is dropped", C.normTags(["veg", "<script>"]).length === 1);
  ok("an unknown language is dropped", Object.keys(C.normNames({ hi: "x", xx: "y" })).length === 1);
  ok("the name falls back to the room name", C.menuItemName(C.menuItem(d, "misal"), "gu") === "Misal pav");
  ok("the name follows the reader", C.menuItemName(C.menuItem(d, "misal"), "hi") !== "Misal pav");
  ok("a bad sku is refused", C.upsertMenuItem(d, { sku: "No Spaces", name: "x" }) === null);

  C.upsertMenuItem(d, { sku: "misal", name: "Misal pav (large)", price: 9000 });
  ok("editing replaces, not appends", d.menu.length === C.defaultMenu().length + 1 &&
    C.menuItem(d, "misal").price === 9000);

  C.setSoldOut(d, "misal", true);
  ok("sold out leaves the guest menu", C.availableMenu(d).every(function (m) { return m.sku !== "misal"; }));
  ok("a sold-out sku cannot be ordered", C.resolveItems(d, [{ sku: "misal", qty: 1 }]).length === 0);
  ok("sold out keeps the item on the board", !!C.menuItem(d, "misal"));
  C.setSoldOut(d, "misal", false);
  ok("back on sale", C.resolveItems(d, [{ sku: "misal", qty: 1 }]).length === 1);

  C.removeMenuItem(d, "misal");
  ok("delete removes it", !C.menuItem(d, "misal"));

  ok("search by tag", C.searchMenu(d, "", { tag: "spicy" }).length >= 1);
  ok("search by a hindi name", C.searchMenu(d, "\u0921\u094b\u0938\u093e").length === 1);
  ok("search by sku", C.searchMenu(d, "thali")[0].sku === "thali");
  ok("menu edits are logged", d.log.some(function (e) { return e.kind === "menu:set"; }));
  ok("a menu edit reaches every client as one message", (function () {
    var room = C.newDoc();
    C.apply(room, { t: "menu:set", item: { sku: "misal", name: "Misal pav", price: 7000 } });
    return room.menu.length === C.defaultMenu().length + 1;
  })());
})();

/* ---- 17. a bill split across heads adds up to the bill ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "s1", table: "5", items: [{ sku: "thali", qty: 1 }] });
  C.apply(d, { t: "order", id: "s2", table: "5", items: [{ sku: "chai", qty: 1 }] });
  ok("one head takes it all", C.splitBill(d, "5", 1).shares[0] === 13500);
  var seven = C.splitBill(d, "5", 7);
  ok("seven heads sum exactly", seven.shares.reduce(function (a, b) { return a + b; }, 0) === 13500);
  ok("no two shares differ by more than a paisa",
    Math.max.apply(null, seven.shares) - Math.min.apply(null, seven.shares) <= 1);
  ok("the paise remainder is handed out", seven.shares.join(",") === "1929,1929,1929,1929,1928,1928,1928");
  ok("heads are clamped", C.splitBill(d, "5", 0).heads === 1 && C.splitBill(d, "5", 999).heads === 50);
  ok("a cancelled order leaves the split", (function () {
    C.apply(d, { t: "cancel", id: "s1" });
    return C.splitBill(d, "5", 2).total === 1500;
  })());
})();

/* ---- 18. the shift report ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "r1", table: "1", items: [{ sku: "chai", qty: 2 }] });
  C.apply(d, { t: "order", id: "r2", table: "2", items: [{ sku: "chai", qty: 1 }, { sku: "thali", qty: 1 }] });
  C.apply(d, { t: "order", id: "r3", table: "3", items: [{ sku: "dosa", qty: 1 }] });
  C.apply(d, { t: "cancel", id: "r3" });
  var r = C.report(d);
  ok("covers exclude cancellations", r.covers === 2 && r.orders === 3 && r.cancelled === 1);
  ok("revenue excludes cancellations", r.revenue === 3000 + 13500);
  ok("the average ticket is per cover", r.average === Math.round(16500 / 2));
  ok("top sellers are ranked by quantity", r.top[0].sku === "chai" && r.top[0].qty === 3);
  ok("top sellers carry revenue", r.top[0].revenue === 4500);
})();

/* ---- 19. the log, and undo ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "u1", table: "8", items: [{ sku: "idli", qty: 1 }] });
  C.apply(d, { t: "status", id: "u1", status: "preparing", by: "ravi" });
  C.apply(d, { t: "status", id: "u1", status: "served", by: "ravi" });
  ok("every move is logged with who did it", d.log.filter(function (e) { return e.kind === "status"; }).length === 2 &&
    d.log[d.log.length - 1].by === "ravi");
  ok("undo steps back one move", (C.undoLast(d), C.orderById(d, "u1").status === "preparing"));
  ok("undo again steps back to placed", (C.undoLast(d), C.orderById(d, "u1").status === "placed"));
  ok("nothing left to undo", C.undoLast(d) === null);
  ok("a status that does not change is not logged", (function () {
    var before = d.log.length;
    C.apply(d, { t: "status", id: "u1", status: "placed" });
    return d.log.length === before;
  })());
  ok("a cleared pile is not undoable", (function () {
    var e = C.newDoc();
    C.apply(e, { t: "order", id: "c1", table: "1", items: [{ sku: "chai", qty: 1 }] });
    C.apply(e, { t: "status", id: "c1", status: "served" });
    C.apply(e, { t: "clear" });
    return e.orders.length === 0 && C.undoLast(e) === null;
  })());
  ok("the log survives a snapshot", C.toJSON(C.fromJSON(C.toJSON(d))).length > 0 &&
    C.logOf(C.fromJSON(C.toJSON(d)), 1).length === 1);
})();

/* ---- 20. a reconnected device cannot double-charge a table ---- */
(function () {
  var d = C.newDoc();
  var msg = { t: "order", id: "dup1", table: "9", items: [{ sku: "thali", qty: 1 }] };
  C.apply(d, msg); C.apply(d, msg); C.apply(d, msg);
  ok("the same order id lands once", d.orders.length === 1 && C.stats(d).revenue === 12000);
})();

/* ---- 21. how long an order has been waiting ---- */
(function () {
  var o = C.newOrder({ ts: 1000000 });
  ok("age in whole minutes", C.ageMinutes(o, 1000000 + 5 * 60000 + 30000) === 5);
  ok("an order with no timestamp has no age", C.ageMinutes(C.newOrder({}), Date.now()) === null);
})();

/* ---- 22. the QR the host prints ---- */
(function () {
  var q = require(path.join(__dirname, "host", "qr.js"));
  var r = q.encode("http://192.168.1.20:8080");
  ok("a join address fits version 2", r.version === 2 && r.size === 25);
  ok("the mask is one of the eight", r.mask >= 0 && r.mask <= 7);
  var far = r.size - 7;
  ok("three finder patterns are drawn", [[0, 0], [far, 0], [0, far]].every(function (c) {
    return r.modules[c[1]][c[0]] && r.modules[c[1] + 1][c[0] + 1] === false && r.modules[c[1] + 2][c[0] + 2];
  }));
  ok("the dark module is set", r.modules[r.size - 8][8] === true);
  ok("encoding is deterministic", JSON.stringify(q.encode("http://192.168.1.20:8080").modules) === JSON.stringify(r.modules));
  ok("a long address moves up a version", q.encode("http://192.168.100.244:3000/play/?room=canteen").version === 3);
  ok("svg output", q.toSVG("http://192.168.1.20:8080").indexOf("<svg") === 0);
  ok("terminal output has rows", q.toText("http://192.168.1.20:8080", { border: 1 }).split("\n").length === 27);
})();

/* ---- 23. the thermal docket ---- */
(function () {
  var pr = require(path.join(__dirname, "host", "print.js"));
  var text = pr.docket({ title: "KOT  table 12", lines: [["2 x Masala chai", "Rs 30.00"]], foot: "Aarti" });
  ok("the docket has a title", text.indexOf("KOT  TABLE 12") === 0 || text.indexOf("KOT  TABLE 12") >= 0);
  ok("lines are column-aligned to 32", text.split("\n").every(function (l) { return l.length <= 32; }));
  ok("esc/pos init and cut", (function () {
    var b = pr.encode(text);
    return b.slice(0, 2).toString("latin1") === "\x1b@" && b.slice(-3).toString("latin1") === "\x1dV\x00";
  })());
  ok("a printer target parses", (function () {
    var t = pr.parseTarget("192.168.1.50:9100");
    return t.host === "192.168.1.50" && t.port === 9100;
  })());
})();

/* ---- 24. the page ships everything it loads ---- */
(function () {
  var fs = require("fs");
  var play = path.join(__dirname, "docs", "play");
  var html = fs.readFileSync(path.join(play, "index.html"), "utf8");
  ["sw.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "qr.js"].forEach(function (f) {
    ok("ships " + f, fs.existsSync(path.join(play, f)));
  });
  ok("the app registers the worker", html.indexOf('navigator.serviceWorker.register("sw.js")') !== -1);
  ok("the app links the manifest", html.indexOf('rel="manifest"') !== -1);
  var sw = fs.readFileSync(path.join(play, "sw.js"), "utf8");
  ok("the worker is network-first for html", sw.indexOf("network first") !== -1 && sw.indexOf("isDoc") !== -1);
  ok("the worker caches every asset it lists", ["index.html", "canteen.js", "lan-kit.js", "web-kit.js", "qr.js"].every(function (f) {
    return sw.indexOf('"' + f + '"') !== -1;
  }));
  ok("the cache name carries the release", /canteen-\d+\.\d+\.\d+/.test(sw));
  var man = JSON.parse(fs.readFileSync(path.join(play, "manifest.webmanifest"), "utf8"));
  ok("the manifest starts in the app", man.start_url === "./" && man.icons.length >= 2);
  ok("no external asset in the app page", !/(src|href)="https?:\/\//.test(html));
})();

/* ---- 25. stock: a count, not a flag ---- */
(function () {
  var d = C.newDoc();
  ok("a new item has no count", C.menuItem(d, "thali").stock === null);
  C.setStock(d, "thali", 3);
  ok("a count is kept", C.remainingStock(d, "thali") === 3);
  ok("a counted item is still on the menu", C.isAvailable(C.menuItem(d, "thali")));
  ok("an order cannot exceed the count", (function () {
    var e = C.newDoc(); C.setStock(e, "thali", 2);
    var items = C.resolveItems(e, [{ sku: "thali", qty: 9 }]);
    return items.length === 1 && items[0].qty === 2;
  })());
  ok("two lines of one dish share the count", (function () {
    var e = C.newDoc(); C.setStock(e, "thali", 2);
    var items = C.resolveItems(e, [{ sku: "thali", qty: 2 }, { sku: "thali", qty: 2 }]);
    return items[0].qty === 2;
  })());
  C.apply(d, { t: "order", id: "k1", table: "2", items: [{ sku: "thali", qty: 2 }] });
  ok("placing an order takes the count down", C.remainingStock(d, "thali") === 1);
  C.apply(d, { t: "order", id: "k2", table: "2", items: [{ sku: "thali", qty: 5 }] });
  ok("the last one goes and no more", C.remainingStock(d, "thali") === 0 && d.orders[1].items[0].qty === 1);
  ok("an empty count is off the guest menu", !C.isAvailable(C.menuItem(d, "thali")));
  ok("and cannot be ordered at all", C.resolveItems(d, [{ sku: "thali", qty: 1 }]).length === 0);
  ok("stock:set arrives over the wire", (function () {
    var e = C.newDoc(); C.apply(e, { t: "stock:set", sku: "thali", stock: 7 });
    return C.remainingStock(e, "thali") === 7;
  })());
  ok("a blank count means unlimited", (function () {
    var e = C.newDoc(); C.setStock(e, "thali", 5); C.setStock(e, "thali", "");
    return C.remainingStock(e, "thali") === null && C.isAvailable(C.menuItem(e, "thali"));
  })());
  ok("the count is a whole number", C.normStock("2.9") === 2 && C.normStock(-4) === 0 && C.normStock("x") === null);
  ok("the count survives a snapshot without double-deducting",
    C.remainingStock(C.fromJSON(C.toJSON(d)), "thali") === 0);
  ok("a replay of the same messages lands on the same count", (function () {
    var msgs = [{ t: "stock:set", sku: "thali", stock: 3 },
                { t: "order", id: "r1", table: "1", items: [{ sku: "thali", qty: 1 }] },
                { t: "order", id: "r2", table: "1", items: [{ sku: "thali", qty: 1 }] }];
    return C.remainingStock(C.replay(msgs), "thali") === 1;
  })());
  ok("the report names what is running out", (function () {
    var e = C.newDoc(); C.setStock(e, "thali", 2);
    var r = C.report(e);
    return r.lowStock.length === 1 && r.lowStock[0].sku === "thali" && r.lowStock[0].stock === 2;
  })());
  ok("stats count what is out of stock", (function () {
    var e = C.newDoc(); C.setStock(e, "thali", 0);
    return C.stats(e).outOfStock === 1;
  })());
})();

/* ---- 26. the floor: one tile per table ---- */
(function () {
  var T = 1767225600000;
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "f1", table: "12", ts: T - 8 * 60000, items: [{ sku: "thali", qty: 1 }] });
  C.apply(d, { t: "order", id: "f2", table: "12", ts: T - 2 * 60000, items: [{ sku: "chai", qty: 1 }] });
  C.apply(d, { t: "order", id: "f3", table: "4", ts: T - 60000, items: [{ sku: "dosa", qty: 1 }] });
  C.apply(d, { t: "status", id: "f3", status: "served" });
  C.apply(d, { t: "call", table: "4", kind: "bill" });
  var plan = C.floorPlan(d, T);
  ok("one tile per table", plan.length === 2);
  ok("tables sort numerically", plan[0].table === "4" && plan[1].table === "12");
  ok("a tile carries the bill", plan[1].total === 13500);
  ok("a tile counts its open orders", plan[1].open === 2 && plan[0].open === 0);
  ok("a tile knows how long the oldest has waited", plan[1].oldest === 8);
  ok("a tile carries the calls", plan[0].calls.length === 1 && plan[0].calls[0] === "bill");
  ok("a cancelled order is not on the bill", (function () {
    var e = C.newDoc();
    C.apply(e, { t: "order", id: "c1", table: "1", items: [{ sku: "thali", qty: 1 }] });
    C.apply(e, { t: "cancel", id: "c1" });
    return C.floorPlan(e, T)[0].total === 0;
  })());
})();

/* ---- 27. the guest's slip ---- */
(function () {
  var d = C.newDoc();
  C.apply(d, { t: "order", id: "b1", table: "12", items: [{ sku: "chai", qty: 2 }] });
  C.apply(d, { t: "order", id: "b2", table: "12", items: [{ sku: "chai", qty: 1 }, { sku: "dosa", qty: 1 }] });
  C.apply(d, { t: "order", id: "b3", table: "4", items: [{ sku: "thali", qty: 1 }] });
  C.apply(d, { t: "cancel", id: "b3" });
  var slip = C.billSlip(d, "12");
  ok("the slip is one line per dish", slip.lines.length === 2);
  ok("quantities are merged across orders", slip.lines.filter(function (l) { return l.sku === "chai"; })[0].qty === 3);
  ok("the slip total is the table's bill", slip.total === 4500 + 6000);
  ok("the slip names the orders behind it", slip.ids.length === 2 && slip.ids[0] === "b1");
  ok("a cancelled order is not on the slip", C.billSlip(d, "4").lines.length === 0);
  ok("an empty table has an empty slip", C.billSlip(d, "99").total === 0);
})();

/* ---- 15. live: the room transport carries a real order ---- */
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

  /* ---- 25. the host: the pin, the journal, and serving the board itself ---- */
  var fs2 = require("fs");
  var os2 = require("os");
  var tmp = fs2.mkdtempSync(path.join(os2.tmpdir(), "canteen-"));
  var jpath = path.join(tmp, "room.jsonl");
  var play = path.join(__dirname, "docs", "play");

  var h1 = createHost({ room: "pin-test", pin: "4821", journal: jpath, appDir: play, history: 100, replay: true });
  var p1 = await h1.listen(0);
  var base1 = "http://127.0.0.1:" + p1;

  var pageRes = await new Promise(function (resolve) {
    http.get(base1 + "/", function (r) { var b = ""; r.on("data", function (c) { b += c; }); r.on("end", function () { resolve({ status: r.statusCode, body: b, type: r.headers["content-type"] }); }); });
  });
  ok("the host serves the board itself", pageRes.status === 200 && pageRes.body.indexOf("Canteen") !== -1 &&
    /text\/html/.test(pageRes.type || ""));
  var jsRes = await new Promise(function (resolve) {
    http.get(base1 + "/canteen.js", function (r) { var b = ""; r.on("data", function (c) { b += c; }); r.on("end", function () { resolve({ status: r.statusCode, type: r.headers["content-type"] }); }); });
  });
  ok("the host serves the engine with a js type", jsRes.status === 200 && /javascript/.test(jsRes.type || ""));
  var escapeRes = await new Promise(function (resolve) {
    http.get(base1 + "/../host/room.js", function (r) { resolve({ status: r.statusCode }); });
  });
  ok("a path cannot escape the app directory", escapeRes.status === 403 || escapeRes.status === 404);

  var noPin = await post(base1 + "/send", { t: "order", id: "x1", table: "1", items: [{ sku: "chai", qty: 1 }] });
  ok("without the pin the room refuses", noPin.status === 403);
  var wrongPin = await post(base1 + "/send", { t: "order", id: "x1", table: "1", pin: "0000", items: [{ sku: "chai", qty: 1 }] });
  ok("a wrong pin is refused", wrongPin.status === 403);
  var withPin = await post(base1 + "/send", { t: "order", id: "x1", table: "1", pin: "4821", items: [{ sku: "chai", qty: 1 }] });
  ok("with the pin it is accepted", withPin.status === 200 && JSON.parse(withPin.body).ok === true);
  ok("the pin never reaches the room", JSON.stringify(h1.history()).indexOf("4821") === -1);

  var health1 = await new Promise(function (res) {
    http.get(base1 + "/health", function (x) { var b = ""; x.on("data", function (c) { b += c; }); x.on("end", function () { res(JSON.parse(b)); }); });
  });
  ok("health reports that the room has a pin", health1.pin === true && health1.room === "pin-test");

  await h1.close();

  var h2 = createHost({ room: "pin-test", journal: jpath, appDir: play, history: 100, replay: true });
  ok("the journal survives a restart", h2.history().length >= 1 &&
    JSON.stringify(h2.history()).indexOf('"x1"') !== -1);
  var restarted = C.replay(h2.history());
  ok("the restarted host can rebuild the shift", restarted.orders.length === 1 &&
    C.totalOf(restarted.orders[0]) === 1500);
  await h2.close();

  /* ---- 26. the mirror: a second host stays in step, and does not loop ---- */
  var hb = createHost({ room: "mirror-b", history: 100, replay: true });
  var pB = await hb.listen(0);
  var ha = createHost({ room: "mirror-a", history: 100, replay: true,
    mirror: { host: "127.0.0.1", port: pB } });
  var pA = await ha.listen(0);
  await new Promise(function (r) { setTimeout(r, 100); });
  await post("http://127.0.0.1:" + pA + "/send", { t: "order", id: "m1", table: "3", items: [{ sku: "chai", qty: 1 }] });
  await new Promise(function (r) { setTimeout(r, 400); });
  ok("the mirror receives the order", JSON.stringify(hb.history()).indexOf('"m1"') !== -1);
  ok("the mirror marks what came from a peer", hb.history().some(function (m) { return m._via === "mirror"; }));
  ok("the first host keeps one copy", ha.history().filter(function (m) { return m.id === "m1"; }).length === 1);
  ok("the mirror keeps one copy", hb.history().filter(function (m) { return m.id === "m1"; }).length === 1);
  ok("the mirror rebuilds the same board", C.replay(hb.history()).orders.length === 1);
  await ha.close();
  await hb.close();

  /* the journal is a plain JSONL file: no database, nothing to install */
  var lines = fs2.readFileSync(jpath, "utf8").trim().split("\n");
  ok("the journal is one JSON object per line", lines.length >= 1 && lines.every(function (l) {
    try { return !!JSON.parse(l); } catch (e) { return false; }
  }));
  fs2.rmSync(tmp, { recursive: true, force: true });

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
