# Changelog

## 1.2.0 — 2026-11-01

Everything on the "what it could become" list, plus the one thing a canteen asks first:
how do I add a dish?

- **The menu is editable.** Kitchen → Menu → add, edit, price, tag, sold-out, delete.
  Three ways in (`menu:set` / `menu:del` / `menu:sold` by message, `--menu file` at
  startup, or the board itself), all ending in one message every device applies. A placed
  order keeps the name and price it was ordered at; a sold-out item leaves the guest menu
  and stays on open bills. Items carry Hindi and Gujarati names, and tags (veg, jain,
  spicy, dairy, nuts, fried, gluten-free) drive the guest's filters.
- **Offline is structural.** `docs/play/sw.js` — HTML network-first, assets cache-first,
  cache name bumped per release — plus an outbox: a message sent while the room is
  unreachable is queued and re-sent on reconnect, and order ids are idempotent so a
  re-send cannot double-charge a table. `manifest.webmanifest` and two PNG icons let the
  board install to a home screen with no app store.
- **One device, no host.** `?solo=1` runs the whole canteen with the board persisted in
  the browser.
- **The host does more, and needs nothing installed.** It serves the board itself at `/`,
  journals every message to `.canteen/room-<room>.jsonl` (a restart replays the shift),
  enforces an optional `--pin`, prints a QR in the terminal and serves `/join`,
  `/qr.svg`, `/state`, `/report` and `/print`. A static path cannot escape `docs/play/`.
- **A real QR encoder** (`host/qr.js`): byte mode, versions 1–4, ECC L, Reed–Solomon
  parity, mask chosen by penalty score. `scripts/qr-verify.py` checks the matrix
  module-for-module against the reference `qrcode` library — 4/4 exact.
- **Thermal printing** (`host/print.js`): ESC/POS over TCP 9100, 32 columns, no driver and
  no CUPS. `--print host:port` sends a KOT on every order; the app also prints a docket
  through the browser, which works with nothing configured.
- **Kitchen workflow**: order timers, undo of the last status move, an audit log of who
  moved what, split a table's bill across heads in exact paise, and a shift report —
  covers, revenue, average ticket, cancellations, top sellers — printable and exportable.
- **Guest**: menu search and tag filters, a cart that survives a reload, localised item
  names, and a 34 px minimum tap target with `aria-live` announcements in the kitchen.
- **The pipeline tests before it builds.** A `test` job runs `node test-node.js` and the
  build waits on it; a separate `icon` job attaches `docs/icon.png` to the rolling release,
  because a release page of three bare filenames is a release nobody recognises.
- Tests: 97 → 175.

## 1.1.0 — 2026-11-01

## 1.1.0 — 2026-11-01

- **The app boots again.** `docs/play/` never shipped the web-kit it was built on, so
  `Loom` was undefined and the page threw on the first line of boot: 78 engine tests
  green, dead screen. `docs/play/web-kit.js` is now the local, zero-dependency slice the
  app calls (storage, i18n, CSV, theme, seo, ui). A test reads `docs/play/index.html`
  and fails if any script it references is missing, or is remote.
- **A landing page of its own.** `docs/index.html` was the app with a different heading;
  it is now a kitchen pass — thermal tickets, hairline rules, a display serif against
  monospace, light and dark, its own remembered theme key — and the app is untouched at
  `docs/play/`.
- **The demo is the app.** The landing page frames the real board, seeded by
  `Canteen.demoDoc()` through the ordinary protocol, and three buttons move it between
  the kitchen, the guest menu and the calls tab. `?demo=1` needs no server and posts
  nothing; every button still works because the message is applied to the local board.
- **Badges drawn locally.** `scripts/badges.py` writes `docs/assets/badge-*.svg`; the
  README and the page reference them by relative path. No shields.io, no image service —
  an offline-first app should not need the network to describe itself.
- **Screenshots and icons.** `docs/assets/app-desktop.png`, `app-mobile.png`,
  `landing-desktop.png`, `landing-mobile.png` are real Chromium captures of the shipped
  pages; the download buttons carry platform icons and the release carries the app icon.
- Tests: 78 → 97 (demo board, and the page-ships-what-it-loads check).
- The README's licence line said MIT while `LICENSE` has been PolyForm Noncommercial
  1.0.0 since 1.0.0; the two now agree.

## 1.0.0 — 2026-10-25

- **Licence: PolyForm Noncommercial 1.0.0.** Every repository now carries the canonical text
  from polyformproject.org with the Required Notice line, and the four places a repo states
  its licence agree: LICENSE, the SPDX headers, the README and package.json.
- **The public demo is the app.** A build now fails if `docs/play/index.html` is not the app,
  because a demo running older code is two code paths for one program.


## 0.1.0 — 2026-10-23

- First pass. The shared table-ordering board: guests order from their seat and the
  kitchen sees every table live, over the room's own Wi-Fi.
- Engine (`docs/play/canteen.js`): the order board document (menu, orders, table
  calls) and a seven-message protocol (`menu`, `order`, `status`, `cancel`, `clear`,
  `call`, `ack`), pure and zero-dependency, with SKU/quantity/table/status
  sanitisation, per-table bills, and a size-bounded snapshot (`toJSON`/`fromJSON`).
  Prices are taken from the room menu, never from the message; money is integer
  paise.
- Single-page app (`docs/play/index.html`) thin on **web-kit** (storage, EN/HI/GU,
  CSV export, theme, a11y, ui) and **lan-kit** (the LAN room transport), plus a
  zero-dependency room host (`host/room.js`) that seeds the menu and replays history
  to late joiners.
- Headless tests for the engine plus a live-stream integration check:
  78 passed, 0 failed.
- Build workflow for the portable EXE and Android APK.
