# Canteen

[![live](https://img.shields.io/badge/live-online-22c55e)](https://drsamonline.github.io/canteen-lan/)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![tests](https://img.shields.io/badge/tests-78%20passed-22c55e)](test-node.js)
[![release](https://img.shields.io/github/v/release/drsamonline/canteen-lan)](https://github.com/drsamonline/canteen-lan/releases)

**Order from your table over the room's own Wi-Fi.** Guests tap a menu and send an
order from their seat; the kitchen sees every table's orders live and moves each one
along. No accounts, no internet, no telemetry — the orders travel across your own
network and nowhere else.

Built with **Forge**, thin on two shared kits: **web-kit** (storage, i18n
EN/HI/GU, CSV, theme, a11y, ui) and **lan-kit** (the LAN room transport).

## What it does

One person starts a room on a laptop in the canteen; everyone else opens the board
and joins it. A guest picks a table and a name, adds items from the menu to a cart,
and places the order. The kitchen view lists every open order grouped by table,
shows the running bill for each table, and can mark an order *preparing*, *served*
or *cancelled* — or wipe the served pile at the end of a shift. A guest can also
**call the waiter** or **ask for the bill**, and the kitchen acknowledges it. A late
joiner is caught up from the host's history automatically.

## Run it

**Start the room** (on one machine — a laptop, a Pi, anything with Node):

```
node host/room.js                 # room "canteen", port 8080
```

It prints the address to use on the LAN, for example `http://192.168.1.20:8080`. It
also seeds the room with the menu, so every device sees the same prices. Override
the menu with `--menu my-menu.json` (a JSON array of `{ "sku", "name", "price" }`,
price in paise).

**Join the board** — open the published page on any device on the same Wi-Fi:

- **https://drsamonline.github.io/canteen-lan/** → *Open the board*, then paste the
  host address and tap **Join room**;

or run it locally: open `docs/play/index.html` in a browser (the engine
`docs/play/canteen.js`, the transport `docs/play/lan-kit.js` and the shared runtime
`docs/play/web-kit.js` sit next to it, so it works from `file://` too).

```
node test-node.js      # 78 passed, 0 failed
```

## How it is built

The app is **thin**: storage, languages, theming, accessibility and the CSV export
come from **web-kit**; the room — SSE for server→client, plain POST for
client→server, a room code and a LAN URL — comes from **lan-kit**. The only
app-specific code is

- `docs/play/canteen.js` — a small, pure, zero-dependency engine holding the order
  board (the menu, the orders, the table calls) and the message protocol that keeps
  every device in step (`menu`, `order`, `status`, `cancel`, `clear`, `call`,
  `ack`). It runs unchanged in the browser and under Node, so the whole mechanic is
  unit-tested headlessly;
- `docs/play/index.html` — the menu, the cart, the join panel and the kitchen view,
  wired to web-kit and lan-kit;
- `host/room.js` + `host/lan-host.js` — the tiny zero-dependency room host.

Every message is sanitised on arrival (SKUs, quantities, tables, statuses and calls
are validated and clamped) and **prices are taken from the room's menu, never from
the message**, so a buggy or hostile peer on the LAN cannot mis-price an order or
break the board. Money is kept in integer paise, so a running bill never drifts.

## Build the EXE and APK

This repo calls the shared build workflow. On every push, GitHub Actions builds a
portable Windows EXE and a signed Android APK from `docs/play` and attaches them to
the `app-latest` release.

## Licence

MIT. (c) 2026 Dr Sohil Momin. Part of the Forge system — apps open, orchestrator licensed.
