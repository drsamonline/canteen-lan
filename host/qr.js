/* qr.js — a small QR encoder, byte mode, versions 1–4, ECC level L. Zero dependencies.
 *
 * The room host prints a join address, and typing `http://192.168.1.20:8080` on a
 * phone is exactly the friction that makes people give up. The host serves this
 * as an SVG at /qr.svg, so a guest scans instead.
 *
 * Why it is safe to hand-roll: at ECC level L, versions 1–4 are a single Reed–
 * Solomon block each (19/34/55/80 data codewords), which removes the whole
 * interleaving table, and no version/format-B tables are needed below version 7.
 * It is still a real encoder — bit stream, RS parity, function patterns, mask
 * selection by penalty score, format bits — and `scripts/qr-verify.py` checks the
 * finished matrix against the reference `qrcode` library before release.
 *
 *   const qr = require("./qr.js");
 *   qr.toSVG("http://192.168.1.20:8080", { scale: 6, border: 4 });
 *
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
"use strict";

/* ---------- GF(256) arithmetic, primitive polynomial 0x11D ---------- */

var EXP = new Array(512), LOG = new Array(256);
(function () {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
})();

function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/* The generator polynomial for `degree` ECC codewords, highest power first. */
function rsDivisor(degree) {
  var result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  var root = 1;
  for (var i = 0; i < degree; i++) {
    for (var j = 0; j < degree; j++) {
      result[j] = mul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = mul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  var result = divisor.map(function () { return 0; });
  data.forEach(function (b) {
    var factor = b ^ result.shift();
    result.push(0);
    for (var i = 0; i < divisor.length; i++) result[i] ^= mul(divisor[i], factor);
  });
  return result;
}

/* ---------- version tables (ECC L only) ---------- */

var DATA_CODEWORDS = { 1: 19, 2: 34, 3: 55, 4: 80 };
var ECC_CODEWORDS = { 1: 7, 2: 10, 3: 15, 4: 20 };
var REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7 };
var ECL_L = 1;   /* the two format bits for level L */

function bitLen(n) { var s = 0; while (n) { s++; n >>>= 1; } return s; }
function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

/* ---------- the encoder ---------- */

function encode(text) {
  var bytes = Array.from(Buffer.from(String(text), "utf8"));
  var version = 0;
  for (var v = 1; v <= 4; v++) {
    /* 4 bits of mode + 8 bits of length + the payload */
    if (bytes.length + 2 <= DATA_CODEWORDS[v]) { version = v; break; }
  }
  if (!version) throw new Error("qr: payload too long for versions 1–4 (" + bytes.length + " bytes)");

  var size = version * 4 + 17;
  var dataCw = DATA_CODEWORDS[version], eccCw = ECC_CODEWORDS[version];

  /* bit stream: mode 0100, length (8 bits), payload, terminator, pad */
  var bits = [];
  function push(value, len) { for (var i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); }
  push(0x4, 4);
  push(bytes.length, 8);
  bytes.forEach(function (b) { push(b, 8); });
  var capacity = dataCw * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  var data = [];
  for (var i = 0; i < bits.length; i += 8) {
    var byte = 0;
    for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  for (var pad = 0; data.length < dataCw; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);

  var ecc = rsRemainder(data, rsDivisor(eccCw));
  var codewords = data.concat(ecc);

  /* ---------- function patterns ---------- */

  var modules = [], isFunction = [];
  for (var y = 0; y < size; y++) {
    modules.push(new Array(size).fill(false));
    isFunction.push(new Array(size).fill(false));
  }
  function setFn(x, y, dark) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = !!dark;
    isFunction[y][x] = true;
  }

  /* timing */
  for (var t = 0; t < size; t++) { setFn(6, t, t % 2 === 0); setFn(t, 6, t % 2 === 0); }

  /* finders + separators */
  [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(c[0] + dx, c[1] + dy, dist !== 2 && dist !== 4);
      }
    }
  });

  /* alignment patterns */
  var alignPos = alignmentPositions(version, size);
  alignPos.forEach(function (ax) {
    alignPos.forEach(function (ay) {
      var onFinder = (ax === 6 && ay === 6) ||
        (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6);
      if (onFinder) return;
      for (var dy2 = -2; dy2 <= 2; dy2++) {
        for (var dx2 = -2; dx2 <= 2; dx2++) {
          setFn(ax + dx2, ay + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
        }
      }
    });
  });

  /* reserve the format areas (the real bits are written after masking) */
  drawFormat(setFn, size, 0, 0);

  /* ---------- data placement ---------- */

  var bitIndex = 0;
  for (var right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (var vert = 0; vert < size; vert++) {
      for (var k = 0; k < 2; k++) {
        var x = right - k;
        var upward = ((right + 1) & 2) === 0;
        var yy = upward ? size - 1 - vert : vert;
        if (!isFunction[yy][x] && bitIndex < codewords.length * 8) {
          modules[yy][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex++;
        }
      }
    }
  }

  /* ---------- mask: pick the lowest penalty ---------- */

  var bestMask = 0, bestScore = Infinity, bestModules = null;
  for (var m = 0; m < 8; m++) {
    var trial = modules.map(function (row) { return row.slice(); });
    applyMask(trial, isFunction, m, size);
    /* the format modules are function modules, so they are written straight in
       (they were only reserved, with placeholder bits, during the build) */
    var bitsM = formatBits(ECL_L, m);
    placeFormat(function (x, y, dark) { trial[y][x] = !!dark; }, size, bitsM);
    var score = penalty(trial, size);
    if (score < bestScore) { bestScore = score; bestMask = m; bestModules = trial; }
  }

  return {
    version: version,
    size: size,
    mask: bestMask,
    modules: bestModules,
    text: String(text)
  };
}

function alignmentPositions(version, size) {
  if (version === 1) return [];
  var num = Math.floor(version / 7) + 2;
  var step = Math.ceil((version * 4 + 4) / (num * 2 - 2)) * 2;
  var result = [6];
  for (var pos = size - 7; result.length < num; pos -= step) result.splice(1, 0, pos);
  return result;
}

function applyMask(modules, isFunction, mask, size) {
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      if (isFunction[y][x]) continue;
      var invert;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) modules[y][x] = !modules[y][x];
    }
  }
}

function formatBits(ecl, mask) {
  var data = (ecl << 3) | mask;
  var rem = data;
  for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/* The 15 format bits, in the two copies the spec asks for. */
function placeFormat(set, size, bits) {
  for (var i = 0; i <= 5; i++) set(8, i, getBit(bits, i));
  set(8, 7, getBit(bits, 6));
  set(8, 8, getBit(bits, 7));
  set(7, 8, getBit(bits, 8));
  for (var j = 9; j < 15; j++) set(14 - j, 8, getBit(bits, j));

  for (var k = 0; k < 8; k++) set(size - 1 - k, 8, getBit(bits, k));
  for (var l = 8; l < 15; l++) set(8, size - 15 + l, getBit(bits, l));
  set(8, size - 8, true);
}

/* Reserve the format modules during the build so data placement skips them. */
function drawFormat(setFn, size, ecl, mask) {
  var bits = formatBits(ecl, mask);
  for (var i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i));
  setFn(8, 7, getBit(bits, 6));
  setFn(8, 8, getBit(bits, 7));
  setFn(7, 8, getBit(bits, 8));
  for (var j = 9; j < 15; j++) setFn(14 - j, 8, getBit(bits, j));
  for (var k = 0; k < 8; k++) setFn(size - 1 - k, 8, getBit(bits, k));
  for (var l = 8; l < 15; l++) setFn(8, size - 15 + l, getBit(bits, l));
  setFn(8, size - 8, true);
}

/* ---------- penalty score (the spec's four rules) ---------- */

function penalty(modules, size) {
  var score = 0, x, y, run, dark;

  /* rule 1: runs of five or more in a row or column */
  for (y = 0; y < size; y++) {
    run = 1;
    for (x = 1; x < size; x++) {
      if (modules[y][x] === modules[y][x - 1]) { run++; }
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    if (run >= 5) score += run - 2;
  }
  for (x = 0; x < size; x++) {
    run = 1;
    for (y = 1; y < size; y++) {
      if (modules[y][x] === modules[y - 1][x]) { run++; }
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    if (run >= 5) score += run - 2;
  }

  /* rule 2: 2x2 blocks of one colour */
  for (y = 0; y < size - 1; y++) {
    for (x = 0; x < size - 1; x++) {
      var c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
  }

  /* rule 3: finder-like 1:1:3:1:1 runs with four light modules beside them */
  var P1 = [true, false, true, true, true, false, true, false, false, false, false];
  var P2 = [false, false, false, false, true, false, true, true, true, false, true];
  function matches(get, i) {
    var a = true, b = true;
    for (var k = 0; k < 11; k++) {
      if (get(i + k) !== P1[k]) a = false;
      if (get(i + k) !== P2[k]) b = false;
      if (!a && !b) return false;
    }
    return a || b;
  }
  for (y = 0; y < size; y++) {
    (function (yy) {
      var get = function (i) { return modules[yy][i]; };
      for (var i = 0; i + 11 <= size; i++) if (matches(get, i)) score += 40;
    })(y);
  }
  for (x = 0; x < size; x++) {
    (function (xx) {
      var get = function (i) { return modules[i][xx]; };
      for (var i = 0; i + 11 <= size; i++) if (matches(get, i)) score += 40;
    })(x);
  }

  /* rule 4: deviation from 50% dark */
  dark = 0;
  for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (modules[y][x]) dark++;
  var total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/* ---------- output ---------- */

function toSVG(text, opts) {
  opts = opts || {};
  var qr = encode(text);
  var scale = opts.scale || 6;
  var border = opts.border === undefined ? 4 : opts.border;
  var dark = opts.dark || "#14120f";
  var light = opts.light || "#ffffff";
  var dim = (qr.size + border * 2) * scale;
  var path = [];
  for (var y = 0; y < qr.size; y++) {
    for (var x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      path.push("M" + ((x + border) * scale) + " " + ((y + border) * scale) + "h" + scale + "v" + scale + "h-" + scale + "z");
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
    '" viewBox="0 0 ' + dim + ' ' + dim + '" role="img" aria-label="QR code: ' + escapeXml(text) + '">' +
    '<title>' + escapeXml(text) + "</title>" +
    '<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>' +
    '<path d="' + path.join("") + '" fill="' + dark + '"/></svg>';
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* A plain text block, for a terminal that has no browser. */
function toText(text, opts) {
  opts = opts || {};
  var qr = encode(text);
  var border = opts.border === undefined ? 2 : opts.border;
  var rows = [];
  for (var y = -border; y < qr.size + border; y++) {
    var line = "";
    for (var x = -border; x < qr.size + border; x++) {
      var on = y >= 0 && x >= 0 && y < qr.size && x < qr.size && qr.modules[y][x];
      line += on ? "██" : "  ";
    }
    rows.push(line);
  }
  return rows.join("\n");
}

module.exports = { encode: encode, toSVG: toSVG, toText: toText, penalty: penalty, formatBits: formatBits };
