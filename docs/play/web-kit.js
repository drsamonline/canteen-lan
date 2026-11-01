/* web-kit.js — the slice of the shared web-kit that Canteen actually uses.
 *
 * The app is built thin on web-kit (storage, i18n, CSV, theme, seo, ui). That kit
 * used to be assumed rather than shipped, so `Loom` was undefined and the whole
 * UI died on the first line of boot — 78 green engine tests, a dead page. This
 * file is the local, zero-dependency implementation of exactly the surface the
 * app calls, so `docs/play/` is self-contained: no CDN, no network, works from
 * file:// as well as from Pages.
 *
 * Keys are app-specific ("canteen:*") so the board and the landing page never
 * overwrite each other's theme choice.
 *
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
(function (root) {
  "use strict";

  var Loom = { version: "1.0.0" };

  /* ---------- storage: localStorage when it works, memory when it does not ---------- */

  var mem = {};
  function store() {
    try {
      var k = "__wk_probe__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return localStorage;
    } catch (e) { return null; }
  }
  var LS = store();

  Loom.storage = {
    get: function (key, fallback) {
      try {
        var raw = LS ? LS.getItem(key) : mem[key];
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      var raw = JSON.stringify(value);
      try { if (LS) LS.setItem(key, raw); else mem[key] = raw; } catch (e) { mem[key] = raw; }
      return value;
    },
    del: function (key) {
      try { if (LS) LS.removeItem(key); } catch (e) {}
      delete mem[key];
    }
  };

  /* ---------- theme: system preference first, a toggle after that ---------- */

  var THEME_KEY = "canteen:theme";
  function systemTheme() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) { return "light"; }
  }
  function applyTheme(name) {
    var t = name === "dark" || name === "light" ? name : systemTheme();
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#150c0a" : "#fef7f4");
    return t;
  }
  Loom.theme = {
    current: function () {
      return document.documentElement.getAttribute("data-theme") || systemTheme();
    },
    apply: function () { return applyTheme(Loom.storage.get(THEME_KEY, null)); },
    set: function (name) { Loom.storage.set(THEME_KEY, name); return applyTheme(name); },
    toggle: function () {
      var next = Loom.theme.current() === "dark" ? "light" : "dark";
      return Loom.theme.set(next);
    }
  };

  /* ---------- seo: the two document fields a one-page app sets ---------- */

  Loom.seo = {
    title: function (s) { if (s) document.title = s; return document.title; },
    description: function (s) {
      var m = document.querySelector('meta[name="description"]');
      if (s && m) m.setAttribute("content", s);
      return m ? m.getAttribute("content") : "";
    }
  };

  /* ---------- i18n: EN / HI / GU, English as the fallback ---------- */

  var LANG_KEY = "canteen:lang";
  var dicts = { en: {} }, order = ["en"];
  var current = Loom.storage.get(LANG_KEY, "en");
  if (order.indexOf(current) < 0) current = "en";

  Loom.i18n = {
    langs: function () { return order.slice(); },
    extend: function (lang, table) {
      if (!dicts[lang]) { dicts[lang] = {}; if (order.indexOf(lang) < 0) order.push(lang); }
      Object.keys(table || {}).forEach(function (k) { dicts[lang][k] = table[k]; });
      return Loom.i18n;
    },
    setLang: function (lang) {
      current = dicts[lang] ? lang : "en";
      Loom.storage.set(LANG_KEY, current);
      document.documentElement.setAttribute("lang", current);
      return current;
    },
    t: function (key) {
      var d = dicts[current] || {};
      if (d[key] != null) return d[key];
      if (dicts.en[key] != null) return dicts.en[key];
      return String(key);
    }
  };
  Object.defineProperty(Loom.i18n, "lang", { get: function () { return current; } });

  /* ---------- csv: a kitchen export that opens in any spreadsheet ---------- */

  function cell(v) {
    var s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  Loom.csv = {
    toCSV: function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) return "";
      var head = Object.keys(rows[0]);
      var out = [head.map(cell).join(",")];
      rows.forEach(function (r) { out.push(head.map(function (h) { return cell(r[h]); }).join(",")); });
      return out.join("\r\n") + "\r\n";
    },
    download: function (name, text, mime) {
      var blob = new Blob(["\ufeff" + text], { type: (mime || "text/csv") + ";charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return name;
    }
  };

  /* ---------- ui: the one DOM helper the app uses ---------- */

  Loom.ui = {
    el: function (tag, props) {
      var n = document.createElement(tag);
      Object.keys(props || {}).forEach(function (k) {
        if (k === "text") n.textContent = props[k];
        else if (k === "html") n.innerHTML = props[k];
        else if (k === "class") n.className = props[k];
        else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2).toLowerCase(), props[k]);
        else if (props[k] != null) n.setAttribute(k, props[k]);
      });
      return n;
    }
  };

  root.Loom = Loom;
})(typeof globalThis !== "undefined" ? globalThis : this);
