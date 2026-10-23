# Changelog

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
