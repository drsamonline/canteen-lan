#!/usr/bin/env node
/* link-check.js — every local link and image on the two public surfaces must resolve.
 *
 *   node scripts/link-check.js
 *
 * Checks docs/index.html and README.md: relative hrefs and srcs resolve on disk, and
 * in-page anchors (#demo, #run-a-room) point at an id that exists. Remote URLs cannot be
 * fetched from an offline-first repo's CI, so they are listed rather than requested — the
 * pipeline checks the release asset names separately.
 *
 * Exit code 1 if anything local is broken.
 *
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  (" + extra + ")" : "")); }
}

/* any scheme — https:, mailto:, tel:, upi: — is a link to somewhere else, not a
 * path on disk. upi: is how the support block takes a payment; it is not a file. */
function isRemote(u) { return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u); }
function isAnchor(u) { return u.charAt(0) === "#"; }

/* An external *resource* is something the page loads. A plain <a href> is a link
 * the reader may follow: the support block is deliberately external anchors, and
 * the app still has to run with the network off, so the rule is about loads only. */
function externalResource(html) {
  const loaded = /<(?:script|img|iframe|source|video|audio|embed|link)\b[^>]*?\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i;
  const inCss = /url\(\s*["']?\s*(?:https?:)?\/\//i;
  return loaded.test(html) || inCss.test(html);
}

/* every id="..." in a document, so anchors can be checked */
function idsIn(html) {
  const ids = {};
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids[m[1]] = true;
  return ids;
}

function checkHtml(rel) {
  const file = path.join(ROOT, rel);
  const html = fs.readFileSync(file, "utf8");
  const ids = idsIn(html);
  const dir = path.dirname(file);
  const seen = {};
  const remote = [];
  const re = /\s(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1].trim();
    if (seen[url]) continue;
    seen[url] = true;
    if (isRemote(url)) { remote.push(url); continue; }
    if (isAnchor(url)) {
      ok(rel + " → " + url, !!ids[url.slice(1)]);
      continue;
    }
    const clean = url.split("#")[0].split("?")[0];
    if (!clean) continue;
    const target = path.join(dir, clean);
    ok(rel + " → " + url, fs.existsSync(target), "missing " + path.relative(ROOT, target));
  }
  return remote;
}

function checkMarkdown(rel) {
  const file = path.join(ROOT, rel);
  const md = fs.readFileSync(file, "utf8");
  const dir = path.dirname(file);
  const ids = {};
  (md.match(/^#{1,6}\s+(.*)$/gm) || []).forEach(function (h) {
    ids[h.replace(/^#{1,6}\s+/, "").toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, "-")] = true;
  });
  const seen = {};
  const remote = [];
  const re = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(md))) {
    const url = m[1].trim();
    if (seen[url]) continue;
    seen[url] = true;
    if (isRemote(url)) { remote.push(url); continue; }
    if (isAnchor(url)) {
      ok(rel + " → " + url, !!ids[url.slice(1)], "no such heading");
      continue;
    }
    const clean = url.split("#")[0].split("?")[0];
    if (!clean) continue;
    ok(rel + " → " + url, fs.existsSync(path.join(dir, clean)));
  }
  return remote;
}

console.log("Canteen — link check");
const remote = checkHtml("docs/index.html").concat(checkMarkdown("README.md"));

/* the app page's own relative loads, and the sheets it references */
const play = path.join(ROOT, "docs", "play", "index.html");
ok("the app page exists", fs.existsSync(play));
const app = fs.readFileSync(play, "utf8");
["qr.js", "canteen.js", "lan-kit.js", "web-kit.js", "sw.js", "manifest.webmanifest"].forEach(function (f) {
  ok("docs/play/ ships " + f, fs.existsSync(path.join(ROOT, "docs", "play", f)));
});
ok("the app references no remote asset", !externalResource(app));

/* remote URLs: listed, not fetched — this repo has no network in CI by design */
const uniq = Array.from(new Set(remote)).sort();
console.log("\n  remote links (checked by hand, not fetched):");
uniq.forEach(function (u) { console.log("    " + u); });

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
