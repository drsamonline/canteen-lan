# Changelog

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
