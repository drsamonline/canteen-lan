/* canteen.js — the app-specific layer of Canteen, the shared table-ordering board.
 *
 * The whole point of Canteen is one thing: order food from your table, over the
 * room's own Wi-Fi, with no accounts and no internet. Everything common comes
 * from the shared kits —
 *
 *   web-kit  — storage, i18n (EN/HI/GU), CSV, theme, a11y, ui
 *   lan-kit  — the LAN room transport (SSE server -> client, POST client -> server)
 *
 * — so this file keeps ONLY the one unique mechanic: the order board document
 * (the menu, the orders, and the table calls) and the tiny message protocol that
 * keeps every device in the room in step. It is pure, zero-dependency, and runs
 * unchanged in the browser (window.Canteen) and under Node (module.exports), so
 * it is unit-tested headlessly.
 *
 * Money is kept in integer paise, so a running total never drifts.
 *
 * Part of the Forge system. MIT License. (c) 2026 Dr Sohil Momin.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Canteen = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "0.1.0";

  var MAX_ORDERS = 5000;
  var MAX_ITEMS_PER_ORDER = 50;
  var MAX_MENU = 200;
  var MAX_QTY = 99;
  var MAX_PRICE = 100000000;        /* paise: ₹10,00,000 */
  var MAX_CALLS = 500;
  var SKU = /^[a-z0-9][a-z0-9-]{0,23}$/;
  var STATUSES = { placed: 1, preparing: 1, served: 1, cancelled: 1 };
  var CALL_KINDS = { waiter: 1, bill: 1 };

  function isNum(n) { return typeof n === "number" && isFinite(n); }

  /* ---------- normalisers (a hostile or buggy peer cannot inject anything) ---------- */

  function normSku(s) {
    s = String(s == null ? "" : s).trim().toLowerCase();
    return SKU.test(s) ? s : "";
  }

  function normQty(q) {
    q = Number(q);
    if (!isNum(q)) return 0;
    return Math.min(MAX_QTY, Math.max(0, Math.floor(q)));
  }

  function normPrice(p) {
    p = Number(p);
    if (!isNum(p) || p < 0) return 0;
    return Math.min(MAX_PRICE, Math.floor(p));
  }

  function normTable(t) {
    t = String(t == null ? "" : t).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    return t.slice(0, 8) || "?";
  }

  function normName(s, max) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max || 40);
  }

  function normStatus(s) {
    s = String(s == null ? "" : s).toLowerCase();
    return STATUSES[s] ? s : "placed";
  }

  function normKind(k) {
    k = String(k == null ? "" : k).toLowerCase();
    return CALL_KINDS[k] ? k : "";
  }

  /* A short, collision-resistant id. */
  function newId(rand) {
    rand = rand || Math.random;
    var A = "abcdefghijklmnopqrstuvwxyz0123456789", s = "";
    for (var i = 0; i < 10; i++) s += A[Math.floor(rand() * A.length)];
    return s;
  }

  /* ---------- the default menu (a small Indian canteen, prices in paise) ---------- */

  function defaultMenu() {
    return [
      { sku: "chai",   name: "Masala chai",       price: 1500 },
      { sku: "coffee", name: "Filter coffee",     price: 2000 },
      { sku: "samosa", name: "Samosa (2 pcs)",    price: 3000 },
      { sku: "vada",   name: "Medu vada (2 pcs)", price: 2500 },
      { sku: "idli",   name: "Idli (2 pcs)",      price: 3000 },
      { sku: "dosa",   name: "Masala dosa",       price: 6000 },
      { sku: "poha",   name: "Poha",              price: 3500 },
      { sku: "thali",  name: "Veg thali",         price: 12000 },
      { sku: "lime",   name: "Lime soda",         price: 3000 },
      { sku: "water",  name: "Bottled water",     price: 2000 }
    ];
  }

  function normMenuItem(m) {
    if (!m || typeof m !== "object") return null;
    var sku = normSku(m.sku);
    if (!sku) return null;
    return { sku: sku, name: normName(m.name, 40) || sku, price: normPrice(m.price) };
  }

  function normMenu(items) {
    var out = [], seen = {};
    (Array.isArray(items) ? items : []).forEach(function (m) {
      var x = normMenuItem(m);
      if (x && !seen[x.sku]) { seen[x.sku] = 1; out.push(x); }
      if (out.length >= MAX_MENU) return;
    });
    return out.slice(0, MAX_MENU);
  }

  /* ---------- the document ---------- */

  function newDoc(menu) {
    return { v: 1, rev: 0, menu: normMenu(menu || defaultMenu()), orders: [], calls: [] };
  }

  function menuItem(doc, sku) {
    var menu = (doc && doc.menu) || [];
    for (var i = 0; i < menu.length; i++) if (menu[i].sku === sku) return menu[i];
    return null;
  }

  function setMenu(doc, items) {
    if (!doc) return doc;
    doc.menu = normMenu(items);
    doc.rev++;
    return doc;
  }

  /* Resolve the {sku, qty} lines a guest sent against the current menu, taking a
   * snapshot of the name and price so a later menu change cannot rewrite a
   * placed order. Unknown SKUs are dropped. */
  function resolveItems(doc, items) {
    var out = [];
    (Array.isArray(items) ? items : []).forEach(function (line) {
      if (!line || typeof line !== "object") return;
      var sku = normSku(line.sku), qty = normQty(line.qty);
      if (!sku || qty < 1) return;
      var m = menuItem(doc, sku);
      if (!m) return;
      var existing = null;
      for (var i = 0; i < out.length; i++) if (out[i].sku === sku) existing = out[i];
      if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + qty);
      else out.push({ sku: sku, name: m.name, price: m.price, qty: qty });
      if (out.length > MAX_ITEMS_PER_ORDER) out.length = MAX_ITEMS_PER_ORDER;
    });
    return out;
  }

  function totalOf(order) {
    var items = (order && order.items) || [], sum = 0;
    items.forEach(function (l) { sum += normPrice(l.price) * normQty(l.qty); });
    return sum;
  }

  function newOrder(opts) {
    opts = opts || {};
    return {
      id: opts.id || newId(),
      table: normTable(opts.table),
      by: normName(opts.by, 24) || "guest",
      note: normName(opts.note, 80),
      status: "placed",
      ts: isNum(opts.ts) ? opts.ts : 0,
      items: (opts.items || []).map(function (l) {
        return { sku: normSku(l.sku), name: normName(l.name, 40), price: normPrice(l.price), qty: normQty(l.qty) };
      }).filter(function (l) { return l.sku && l.qty > 0; })
    };
  }

  function orderById(doc, id) {
    var orders = (doc && doc.orders) || [];
    for (var i = 0; i < orders.length; i++) if (orders[i].id === id) return orders[i];
    return null;
  }

  function addOrder(doc, order) {
    if (!doc || !order || !order.items || !order.items.length) return doc;
    if (doc.orders.length >= MAX_ORDERS) doc.orders.shift();
    doc.orders.push(order);
    doc.rev++;
    return doc;
  }

  function setStatus(doc, id, status) {
    var o = orderById(doc, id);
    if (o) { o.status = normStatus(status); doc.rev++; }
    return doc;
  }

  function cancelOrder(doc, id) { return setStatus(doc, id, "cancelled"); }

  /* Drop every served or cancelled order — the "wipe the done pile" action. */
  function clearServed(doc) {
    if (!doc) return doc;
    var before = doc.orders.length;
    doc.orders = doc.orders.filter(function (o) { return o.status !== "served" && o.status !== "cancelled"; });
    if (doc.orders.length !== before) doc.rev++;
    return doc;
  }

  function ordersForTable(doc, table) {
    table = normTable(table);
    return ((doc && doc.orders) || []).filter(function (o) { return o.table === table; });
  }

  /* The live bill for each table: the sum of everything not cancelled. */
  function tableTotals(doc) {
    var out = {};
    ((doc && doc.orders) || []).forEach(function (o) {
      if (o.status === "cancelled") return;
      out[o.table] = (out[o.table] || 0) + totalOf(o);
    });
    return out;
  }

  /* ---------- calls (call a waiter / ask for the bill) ---------- */

  function addCall(doc, table, kind) {
    if (!doc) return doc;
    table = normTable(table); kind = normKind(kind);
    if (!kind) return doc;
    var calls = doc.calls || (doc.calls = []);
    for (var i = 0; i < calls.length; i++) {
      if (calls[i].table === table && calls[i].kind === kind) { doc.rev++; return doc; }
    }
    if (calls.length >= MAX_CALLS) calls.shift();
    calls.push({ id: table + ":" + kind, table: table, kind: kind });
    doc.rev++;
    return doc;
  }

  function ackCall(doc, table, kind) {
    if (!doc || !doc.calls) return doc;
    table = normTable(table); kind = normKind(kind);
    var before = doc.calls.length;
    doc.calls = doc.calls.filter(function (c) { return !(c.table === table && (!kind || c.kind === kind)); });
    if (doc.calls.length !== before) doc.rev++;
    return doc;
  }

  function callsForTable(doc, table) {
    table = normTable(table);
    return ((doc && doc.calls) || []).filter(function (c) { return c.table === table; });
  }

  /* ---------- the one function the app calls for every inbound message ---------- */

  function apply(doc, msg) {
    if (!doc || !msg || typeof msg !== "object") return doc;
    switch (msg.t) {
      case "menu":
        setMenu(doc, msg.items);
        break;
      case "order":
        addOrder(doc, newOrder({
          id: msg.id,
          table: msg.table,
          by: msg.by,
          note: msg.note,
          ts: msg.ts,
          items: resolveItems(doc, msg.items)
        }));
        break;
      case "status":
        setStatus(doc, msg.id, msg.status);
        break;
      case "cancel":
        cancelOrder(doc, msg.id);
        break;
      case "clear":
        clearServed(doc);
        break;
      case "call":
        addCall(doc, msg.table, msg.kind);
        break;
      case "ack":
        ackCall(doc, msg.table, msg.kind);
        break;
      /* "hello"/"cursor"/anything else: not part of the board. */
      default: break;
    }
    return doc;
  }

  /* Apply a whole sequence — used by a late joiner replaying the room history. */
  function replay(messages) {
    var doc = newDoc();
    (messages || []).forEach(function (m) { apply(doc, m); });
    return doc;
  }

  function stats(doc) {
    var orders = (doc && doc.orders) || [], items = 0, revenue = 0, open = 0, tables = {};
    orders.forEach(function (o) {
      items += (o.items || []).reduce(function (n, l) { return n + l.qty; }, 0);
      if (o.status !== "cancelled") { revenue += totalOf(o); tables[o.table] = 1; }
      if (o.status === "placed" || o.status === "preparing") open++;
    });
    return {
      orders: orders.length,
      items: items,
      revenue: revenue,
      open: open,
      tables: Object.keys(tables).length,
      calls: ((doc && doc.calls) || []).length
    };
  }

  /* A validated, size-bounded snapshot for storage / a static export. */
  function toJSON(doc) {
    var out = {
      v: 1, rev: (doc && doc.rev) || 0,
      menu: normMenu(doc && doc.menu),
      orders: [], calls: []
    };
    ((doc && doc.orders) || []).forEach(function (o) {
      out.orders.push({
        id: o.id, table: normTable(o.table), by: normName(o.by, 24), note: normName(o.note, 80),
        status: normStatus(o.status), ts: isNum(o.ts) ? o.ts : 0,
        items: (o.items || []).map(function (l) {
          return { sku: normSku(l.sku), name: normName(l.name, 40), price: normPrice(l.price), qty: normQty(l.qty) };
        })
      });
    });
    ((doc && doc.calls) || []).forEach(function (c) {
      out.calls.push({ id: c.id, table: normTable(c.table), kind: normKind(c.kind) });
    });
    return JSON.stringify(out);
  }

  function fromJSON(text) {
    var raw;
    try { raw = typeof text === "string" ? JSON.parse(text) : text; } catch (e) { return newDoc(); }
    if (!raw || typeof raw !== "object") return newDoc();
    var doc = newDoc(raw.menu);
    (raw.orders || []).forEach(function (o) {
      addOrder(doc, newOrder({ id: o.id, table: o.table, by: o.by, note: o.note, ts: o.ts, items: o.items }));
      var added = orderById(doc, o.id);
      if (added) added.status = normStatus(o.status);
    });
    (raw.calls || []).forEach(function (c) { addCall(doc, c.table, c.kind); });
    doc.rev = raw.rev || doc.rev;
    return doc;
  }

  /* The order as a CSV row — handy for the kitchen's end-of-day export. */
  function orderToRow(order) {
    return {
      table: normTable(order && order.table),
      by: normName(order && order.by, 24),
      status: normStatus(order && order.status),
      items: (order && order.items || []).map(function (l) { return l.qty + "x " + l.name; }).join("; "),
      total: money(totalOf(order))
    };
  }

  /* A price in paise as rupees: "₹12" when whole, else "₹12.50". */
  function money(paise) {
    paise = normPrice(paise);
    var r = Math.floor(paise / 100), p = paise % 100;
    return "\u20b9" + r + (p ? "." + (p < 10 ? "0" + p : p) : "");
  }

  return {
    version: VERSION,
    MAX_QTY: MAX_QTY,
    MAX_ITEMS_PER_ORDER: MAX_ITEMS_PER_ORDER,
    newId: newId,
    newDoc: newDoc,
    defaultMenu: defaultMenu,
    normSku: normSku,
    normQty: normQty,
    normPrice: normPrice,
    normTable: normTable,
    normName: normName,
    normStatus: normStatus,
    normKind: normKind,
    normMenu: normMenu,
    setMenu: setMenu,
    menuItem: menuItem,
    resolveItems: resolveItems,
    totalOf: totalOf,
    newOrder: newOrder,
    orderById: orderById,
    addOrder: addOrder,
    setStatus: setStatus,
    cancelOrder: cancelOrder,
    clearServed: clearServed,
    ordersForTable: ordersForTable,
    tableTotals: tableTotals,
    addCall: addCall,
    ackCall: ackCall,
    callsForTable: callsForTable,
    apply: apply,
    replay: replay,
    stats: stats,
    toJSON: toJSON,
    fromJSON: fromJSON,
    orderToRow: orderToRow,
    money: money
  };
});
