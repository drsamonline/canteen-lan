/* canteen.js — the app-specific layer of Canteen, the shared table-ordering board.
 *
 * The whole point of Canteen is one thing: order food from your table, over the
 * room's own Wi-Fi, with no accounts and no internet. Everything common comes
 * from the local kits shipped next to this file —
 *
 *   web-kit  — storage, i18n (EN/HI/GU), CSV, theme, a11y, ui
 *   lan-kit  — the LAN room transport (SSE server -> client, POST client -> server)
 *
 * — so this file keeps ONLY the one unique mechanic: the order board document
 * (the menu, the orders, the table calls, the audit log) and the message protocol
 * that keeps every device in the room in step. It is pure, zero-dependency, and
 * runs unchanged in the browser (window.Canteen) and under Node
 * (module.exports), so the whole mechanic is unit-tested headlessly.
 *
 * Money is kept in integer paise, so a running total never drifts.
 *
 * Part of the Forge system. PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Canteen = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.2.0";

  var MAX_ORDERS = 5000;
  var MAX_ITEMS_PER_ORDER = 50;
  var MAX_MENU = 200;
  var MAX_QTY = 99;
  var MAX_PRICE = 100000000;        /* paise: ₹10,00,000 */
  var MAX_CALLS = 500;
  var MAX_LOG = 500;
  var SKU = /^[a-z0-9][a-z0-9-]{0,23}$/;
  var STATUSES = { placed: 1, preparing: 1, served: 1, cancelled: 1 };
  var CALL_KINDS = { waiter: 1, bill: 1 };
  var TAGS = { veg: 1, jain: 1, spicy: 1, dairy: 1, nuts: 1, fried: 1, "gluten-free": 1 };
  var LANGS = { hi: 1, gu: 1, en: 1 };

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

  function normTags(t) {
    var out = [];
    (Array.isArray(t) ? t : String(t == null ? "" : t).split(",")).forEach(function (x) {
      var k = String(x == null ? "" : x).trim().toLowerCase().replace(/\s+/g, "-");
      if (TAGS[k] && out.indexOf(k) < 0 && out.length < 5) out.push(k);
    });
    return out;
  }

  /* A menu item can carry its own name in the room's languages. Anything that is
   * not a two-letter code we know is dropped, so a peer cannot smuggle a payload
   * through this field. */
  function normNames(n) {
    var out = {};
    if (!n || typeof n !== "object") return out;
    Object.keys(n).forEach(function (k) {
      var code = String(k).toLowerCase();
      if (!LANGS[code] || code === "en") return;
      var v = normName(n[k], 40);
      if (v) out[code] = v;
    });
    return out;
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
      { sku: "chai", name: "Masala chai", price: 1500, names: { hi: "मसाला चाय", gu: "મસાલા ચા" }, tags: ["veg", "dairy"] },
      { sku: "coffee", name: "Filter coffee", price: 2000, names: { hi: "फ़िल्टर कॉफ़ी", gu: "ફિલ્ટર કોફી" }, tags: ["veg", "dairy"] },
      { sku: "samosa", name: "Samosa (2 pcs)", price: 3000, names: { hi: "समोसा (2 नग)", gu: "સમોસા (2 નંગ)" }, tags: ["veg", "fried"] },
      { sku: "vada", name: "Medu vada (2 pcs)", price: 2500, names: { hi: "मेदु वड़ा (2 नग)", gu: "મેદુ વડા (2 નંગ)" }, tags: ["veg", "fried"] },
      { sku: "idli", name: "Idli (2 pcs)", price: 3000, names: { hi: "इडली (2 नग)", gu: "ઇડલી (2 નંગ)" }, tags: ["veg"] },
      { sku: "dosa", name: "Masala dosa", price: 6000, names: { hi: "मसाला डोसा", gu: "મસાલા ડોસા" }, tags: ["veg", "spicy"] },
      { sku: "poha", name: "Poha", price: 3500, names: { hi: "पोहा", gu: "પોહા" }, tags: ["veg"] },
      { sku: "thali", name: "Veg thali", price: 12000, names: { hi: "वेज थाली", gu: "વેજ થાળી" }, tags: ["veg", "dairy"] },
      { sku: "lime", name: "Lime soda", price: 3000, names: { hi: "नींबू सोडा", gu: "લીંબુ સોડા" }, tags: ["veg"] },
      { sku: "water", name: "Bottled water", price: 2000, names: { hi: "पानी की बोतल", gu: "પાણીની બોટલ" }, tags: [] }
    ];
  }

  function normMenuItem(m) {
    if (!m || typeof m !== "object") return null;
    var sku = normSku(m.sku);
    if (!sku) return null;
    return {
      sku: sku,
      name: normName(m.name, 40) || sku,
      price: normPrice(m.price),
      names: normNames(m.names),
      tags: normTags(m.tags),
      soldOut: m.soldOut === true || m.soldOut === 1 || m.soldOut === "true"
    };
  }

  function normMenu(items) {
    var out = [], seen = {};
    (Array.isArray(items) ? items : []).forEach(function (m) {
      var x = normMenuItem(m);
      if (x && !seen[x.sku]) { seen[x.sku] = 1; out.push(x); }
    });
    return out.slice(0, MAX_MENU);
  }

  /* The item's name in the reader's language, falling back to the room's name. */
  function menuItemName(item, lang) {
    if (!item) return "";
    var n = item.names || {};
    return (lang && n[lang]) || item.name || item.sku || "";
  }

  /* ---------- the document ---------- */

  function newDoc(menu) {
    return { v: 1, rev: 0, menu: normMenu(menu || defaultMenu()), orders: [], calls: [], log: [] };
  }

  function menuItem(doc, sku) {
    var menu = (doc && doc.menu) || [];
    sku = normSku(sku);
    for (var i = 0; i < menu.length; i++) if (menu[i].sku === sku) return menu[i];
    return null;
  }

  function setMenu(doc, items) {
    if (!doc) return doc;
    doc.menu = normMenu(items);
    doc.rev++;
    return doc;
  }

  /* ---------- editing the menu (this is how a canteen changes its board) ---------- */

  /* Add an item, or replace the one with the same sku. Returns the item, or null
   * when the item is invalid or the menu is full and the sku is new. */
  function upsertMenuItem(doc, item, by) {
    if (!doc) return null;
    var x = normMenuItem(item);
    if (!x) return null;
    var menu = doc.menu || (doc.menu = []);
    for (var i = 0; i < menu.length; i++) {
      if (menu[i].sku === x.sku) {
        menu[i] = x;
        doc.rev++;
        logAdd(doc, { kind: "menu:set", id: x.sku, status: x.name, by: by });
        return x;
      }
    }
    if (menu.length >= MAX_MENU) return null;
    menu.push(x);
    doc.rev++;
    logAdd(doc, { kind: "menu:set", id: x.sku, status: x.name, by: by });
    return x;
  }

  function removeMenuItem(doc, sku, by) {
    if (!doc) return doc;
    sku = normSku(sku);
    var before = (doc.menu || []).length;
    doc.menu = (doc.menu || []).filter(function (m) { return m.sku !== sku; });
    if (doc.menu.length !== before) {
      doc.rev++;
      logAdd(doc, { kind: "menu:del", id: sku, by: by });
    }
    return doc;
  }

  /* Sold out keeps the item on the board (and on every bill already placed) but
   * takes it off the guest's menu. */
  function setSoldOut(doc, sku, soldOut, by) {
    var m = menuItem(doc, sku);
    if (!m) return doc;
    m.soldOut = !!soldOut;
    doc.rev++;
    logAdd(doc, { kind: "menu:sold", id: m.sku, status: m.soldOut ? "sold-out" : "available", by: by });
    return doc;
  }

  function availableMenu(doc) {
    return ((doc && doc.menu) || []).filter(function (m) { return !m.soldOut; });
  }

  /* Search across the room name, every language name and the tags. */
  function searchMenu(doc, query, opts) {
    opts = opts || {};
    var q = String(query == null ? "" : query).trim().toLowerCase();
    return ((doc && doc.menu) || []).filter(function (m) {
      if (opts.hideSoldOut && m.soldOut) return false;
      if (opts.tag && (m.tags || []).indexOf(opts.tag) < 0) return false;
      if (!q) return true;
      var hay = [m.sku, m.name].concat(Object.keys(m.names || {}).map(function (k) { return m.names[k]; }))
        .concat(m.tags || []).join(" ").toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  /* Resolve the {sku, qty} lines a guest sent against the current menu, taking a
   * snapshot of the name and price so a later menu change cannot rewrite a
   * placed order. Unknown and sold-out SKUs are dropped. */
  function resolveItems(doc, items) {
    var out = [];
    (Array.isArray(items) ? items : []).forEach(function (line) {
      if (!line || typeof line !== "object") return;
      var sku = normSku(line.sku), qty = normQty(line.qty);
      if (!sku || qty < 1) return;
      var m = menuItem(doc, sku);
      if (!m || m.soldOut) return;
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

  /* Adding is idempotent on the id: a reconnected device that re-sends its
   * outbox cannot double-charge a table. */
  function addOrder(doc, order) {
    if (!doc || !order || !order.items || !order.items.length) return doc;
    if (orderById(doc, order.id)) return doc;
    if (doc.orders.length >= MAX_ORDERS) doc.orders.shift();
    doc.orders.push(order);
    doc.rev++;
    logAdd(doc, { kind: "order", id: order.id, table: order.table, by: order.by, ts: order.ts });
    return doc;
  }

  function setStatus(doc, id, status, by) {
    var o = orderById(doc, id);
    if (!o) return doc;
    var next = normStatus(status);
    if (o.status === next) return doc;
    logAdd(doc, { kind: "status", id: id, table: o.table, prev: o.status, status: next, by: by });
    o.status = next;
    doc.rev++;
    return doc;
  }

  function cancelOrder(doc, id, by) { return setStatus(doc, id, "cancelled", by); }

  /* Undo the last status move — the kitchen tapping "served" on the wrong order.
   * Only status changes are undoable; a cleared pile is not coming back. */
  function undoLast(doc) {
    if (!doc || !doc.log) return null;
    for (var i = doc.log.length - 1; i >= 0; i--) {
      var e = doc.log[i];
      if (e.kind !== "status") continue;
      var o = orderById(doc, e.id);
      doc.log.splice(i, 1);
      if (!o) return null;
      o.status = e.prev || "placed";
      doc.rev++;
      return o;
    }
    return null;
  }

  /* Drop every served or cancelled order — the "wipe the done pile" action. */
  function clearServed(doc, by) {
    if (!doc) return doc;
    var before = doc.orders.length;
    doc.orders = doc.orders.filter(function (o) { return o.status !== "served" && o.status !== "cancelled"; });
    if (doc.orders.length !== before) {
      doc.rev++;
      logAdd(doc, { kind: "clear", status: String(before - doc.orders.length), by: by });
    }
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

  /* Split a table's bill across heads, in integer paise that add up exactly:
   * the remainder is handed out one paisa at a time from the first head. */
  function splitBill(doc, table, heads) {
    heads = Math.max(1, Math.min(50, Math.floor(Number(heads) || 1)));
    var total = tableTotals(doc)[normTable(table)] || 0;
    var base = Math.floor(total / heads), rem = total - base * heads, shares = [];
    for (var i = 0; i < heads; i++) shares.push(base + (i < rem ? 1 : 0));
    return { table: normTable(table), total: total, heads: heads, shares: shares, each: base };
  }

  /* How long an order has been open, in whole minutes. Null when the order
   * carries no timestamp (a peer that did not send one). */
  function ageMinutes(order, now) {
    if (!order || !isNum(order.ts) || !order.ts) return null;
    var t = isNum(now) ? now : Date.now();
    return Math.max(0, Math.floor((t - order.ts) / 60000));
  }

  /* ---------- calls (call a waiter / ask for the bill) ---------- */

  function addCall(doc, table, kind, by) {
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
    logAdd(doc, { kind: "call", table: table, status: kind, by: by });
    return doc;
  }

  function ackCall(doc, table, kind, by) {
    if (!doc || !doc.calls) return doc;
    table = normTable(table); kind = normKind(kind);
    var before = doc.calls.length;
    doc.calls = doc.calls.filter(function (c) { return !(c.table === table && (!kind || c.kind === kind)); });
    if (doc.calls.length !== before) {
      doc.rev++;
      logAdd(doc, { kind: "ack", table: table, status: kind || "all", by: by });
    }
    return doc;
  }

  function callsForTable(doc, table) {
    table = normTable(table);
    return ((doc && doc.calls) || []).filter(function (c) { return c.table === table; });
  }

  /* ---------- the audit log ---------- */

  function logAdd(doc, entry) {
    if (!doc) return;
    var log = doc.log || (doc.log = []);
    var e = { kind: String(entry.kind || "?"), ts: isNum(entry.ts) ? entry.ts : Date.now() };
    if (entry.id) e.id = String(entry.id);
    if (entry.table) e.table = normTable(entry.table);
    if (entry.status != null) e.status = String(entry.status).slice(0, 40);
    if (entry.prev != null) e.prev = String(entry.prev).slice(0, 20);
    if (entry.by) e.by = normName(entry.by, 24);
    log.push(e);
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
  }

  function logOf(doc, n) {
    var log = (doc && doc.log) || [];
    return n ? log.slice(-n) : log.slice();
  }

  /* ---------- the one function the app calls for every inbound message ---------- */

  function apply(doc, msg) {
    if (!doc || !msg || typeof msg !== "object") return doc;
    switch (msg.t) {
      case "menu":        setMenu(doc, msg.items); break;
      case "menu:set":    upsertMenuItem(doc, msg.item, msg.by); break;
      case "menu:del":    removeMenuItem(doc, msg.sku, msg.by); break;
      case "menu:sold":   setSoldOut(doc, msg.sku, msg.soldOut, msg.by); break;
      case "order":
        addOrder(doc, newOrder({
          id: msg.id, table: msg.table, by: msg.by, note: msg.note, ts: msg.ts,
          items: resolveItems(doc, msg.items)
        }));
        break;
      case "status":      setStatus(doc, msg.id, msg.status, msg.by); break;
      case "cancel":      cancelOrder(doc, msg.id, msg.by); break;
      case "undo":        undoLast(doc); break;
      case "clear":       clearServed(doc, msg.by); break;
      case "call":        addCall(doc, msg.table, msg.kind, msg.by); break;
      case "ack":         ackCall(doc, msg.table, msg.kind, msg.by); break;
      /* "hello"/"cursor"/anything else: not part of the board. */
      default: break;
    }
    return doc;
  }

  /* A seeded board for the demo on the landing page (and for tests). It is built
   * by replaying ordinary protocol messages, so the demo can never show a state
   * the real app could not reach. Fixed ids and timestamps keep it deterministic. */
  function demoDoc(now) {
    now = isNum(now) ? now : Date.now();
    var m = 60000;
    var doc = replay([
      { t: "order", id: "d1a4e0c7k2", table: "4", by: "Aarti", note: "less spicy", ts: now - 6 * m,
        items: [{ sku: "dosa", qty: 1 }, { sku: "chai", qty: 2 }] },
      { t: "order", id: "d2b7f1d8m3", table: "7", by: "Ravi", ts: now - 4 * m,
        items: [{ sku: "thali", qty: 2 }, { sku: "lime", qty: 2 }] },
      { t: "order", id: "d3c8g2e9n4", table: "12", by: "Meera", note: "no onion", ts: now - 2 * m,
        items: [{ sku: "idli", qty: 1 }, { sku: "coffee", qty: 1 }] },
      { t: "order", id: "d4d9h3f0p5", table: "4", by: "Aarti", ts: now - 1 * m,
        items: [{ sku: "samosa", qty: 1 }] },
      { t: "status", id: "d1a4e0c7k2", status: "preparing" },
      { t: "status", id: "d4d9h3f0p5", status: "served" },
      { t: "call", table: "7", kind: "bill" },
      { t: "call", table: "12", kind: "waiter" }
    ]);
    /* the log carries wall-clock stamps; pin them so the demo is byte-identical
     * every time it is built */
    doc.log.forEach(function (e, i) { e.ts = i + 1; });
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
      calls: ((doc && doc.calls) || []).length,
      menu: ((doc && doc.menu) || []).length,
      soldOut: ((doc && doc.menu) || []).filter(function (m) { return m.soldOut; }).length
    };
  }

  /* The end-of-shift summary, computed from the board's own history. */
  function report(doc) {
    var orders = (doc && doc.orders) || [];
    var by = {}, revenue = 0, covers = 0, cancelled = 0, items = 0, tables = {};
    orders.forEach(function (o) {
      if (o.status === "cancelled") { cancelled++; return; }
      covers++;
      revenue += totalOf(o);
      tables[o.table] = 1;
      (o.items || []).forEach(function (l) {
        items += l.qty;
        var k = l.sku;
        if (!by[k]) by[k] = { sku: k, name: l.name, qty: 0, revenue: 0 };
        by[k].qty += l.qty;
        by[k].revenue += normPrice(l.price) * normQty(l.qty);
      });
    });
    var top = Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return b.qty - a.qty || b.revenue - a.revenue; }).slice(0, 8);
    return {
      orders: orders.length,
      covers: covers,
      cancelled: cancelled,
      items: items,
      revenue: revenue,
      average: covers ? Math.round(revenue / covers) : 0,
      tables: Object.keys(tables).length,
      top: top
    };
  }

  /* A validated, size-bounded snapshot for storage / a static export. */
  function toJSON(doc) {
    var out = {
      v: 1, rev: (doc && doc.rev) || 0,
      menu: normMenu(doc && doc.menu),
      orders: [], calls: [], log: []
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
    ((doc && doc.log) || []).slice(-MAX_LOG).forEach(function (e) {
      var x = { kind: String(e.kind), ts: isNum(e.ts) ? e.ts : 0 };
      if (e.id) x.id = String(e.id);
      if (e.table) x.table = normTable(e.table);
      if (e.status != null) x.status = String(e.status).slice(0, 40);
      if (e.prev != null) x.prev = String(e.prev).slice(0, 20);
      if (e.by) x.by = normName(e.by, 24);
      out.log.push(x);
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
    doc.log = [];
    (raw.log || []).forEach(function (e) { logAdd(doc, e); });
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
    MAX_MENU: MAX_MENU,
    TAGS: TAGS,
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
    normTags: normTags,
    normNames: normNames,
    normMenu: normMenu,
    normMenuItem: normMenuItem,
    setMenu: setMenu,
    menuItem: menuItem,
    menuItemName: menuItemName,
    upsertMenuItem: upsertMenuItem,
    removeMenuItem: removeMenuItem,
    setSoldOut: setSoldOut,
    availableMenu: availableMenu,
    searchMenu: searchMenu,
    resolveItems: resolveItems,
    totalOf: totalOf,
    newOrder: newOrder,
    orderById: orderById,
    addOrder: addOrder,
    setStatus: setStatus,
    cancelOrder: cancelOrder,
    undoLast: undoLast,
    clearServed: clearServed,
    ordersForTable: ordersForTable,
    tableTotals: tableTotals,
    splitBill: splitBill,
    ageMinutes: ageMinutes,
    addCall: addCall,
    ackCall: ackCall,
    callsForTable: callsForTable,
    logOf: logOf,
    apply: apply,
    replay: replay,
    demoDoc: demoDoc,
    stats: stats,
    report: report,
    toJSON: toJSON,
    fromJSON: fromJSON,
    orderToRow: orderToRow,
    money: money
  };
});
