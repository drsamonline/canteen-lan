# Canteen LAN

[![live](docs/assets/badge-live.svg)](https://drsamonline.github.io/canteen-lan/)
[![tests](docs/assets/badge-tests.svg)](test-node.js)
[![deps](docs/assets/badge-deps.svg)](docs/play/)
[![offline](docs/assets/badge-offline.svg)](#what-it-refuses-to-do)
[![licence](docs/assets/badge-licence.svg)](LICENSE)
[![protocol](docs/assets/badge-protocol.svg)](docs/play/canteen.js)

**Order from your table over the room's own Wi-Fi.** One laptop hosts the canteen;
every phone on the network joins it, orders from its seat, and the kitchen watches
each table move from *placed* to *served*. No internet, no accounts, no telemetry —
the orders cross your own LAN and go nowhere else.

**[Open the board](https://drsamonline.github.io/canteen-lan/play/)** ·
**[The landing page](https://drsamonline.github.io/canteen-lan/)** ·
**[Run a room](#run-a-room)** ·
**[Licence](LICENSE)**

<!-- shot:start -->

![Screenshot](docs/shot.png)

<!-- shot:end -->

![The kitchen board, orders grouped by table](docs/assets/app-desktop.png)

## What it does

A guest picks a table and a name, adds items from the menu to a cart, and places the
order. The kitchen view lists every open order grouped by table, shows the running
bill for each table, and can mark an order *preparing*, *served* or *cancelled* — or
wipe the served pile at the end of a shift. A guest can **call the waiter** or **ask
for the bill**, and the kitchen acknowledges it. A late joiner is caught up from the
host's history automatically, and the day exports as CSV.

The landing page embeds the real board in a frame (`play/?demo=1`) seeded with a
shift's worth of orders, so you can move an order along and answer a call before you
install anything. The demo runs on the same code as the app, from a pure engine
function (`Canteen.demoDoc()`) that the tests cover — there is no second demo build.

## Run a room

One machine — a laptop, a Pi, anything with Node:

```
node host/room.js                 # room "canteen", port 8080
```

It prints the address to use on the LAN, for example `http://192.168.1.20:8080`, and
seeds the room with the menu so every device sees the same prices. Override the menu
with `--menu my-menu.json` (a JSON array of `{ "sku", "name", "price" }`, price in
paise). Guests then open **http://192.168.1.20:8080** on their phone — or the
published board, and paste that address into *Join room*.

The app also opens straight from `file://` (`docs/play/index.html`): it loads nothing
it does not ship.

```
node test-node.js      # 97 passed, 0 failed
```

## How it is built

The app is thin on purpose, and the parts it stands on are **in the repository**:

- `docs/play/canteen.js` — the engine: the order board (menu, orders, table calls) and
  the seven-message protocol that keeps every device in step (`menu`, `order`,
  `status`, `cancel`, `clear`, `call`, `ack`). Pure, zero-dependency, and identical in
  the browser and under Node, so the whole mechanic is tested headlessly.
- `docs/play/web-kit.js` — the slice of the shared web-kit the app uses (storage, i18n
  EN/HI/GU, CSV, theme, seo, ui), shipped locally. It used to be *assumed* rather than
  shipped, which meant the page threw before it painted: 78 green engine tests and a
  dead screen. A test now reads `docs/play/index.html` and fails if any script it
  references is missing or remote.
- `docs/play/lan-kit.js` — the room transport: SSE for server→client, plain POST for
  client→server.
- `docs/play/index.html` — the menu, the cart, the join panel and the kitchen view.
- `host/room.js` + `host/lan-host.js` — the tiny zero-dependency room host.

Every message is sanitised on arrival (SKUs, quantities, tables, statuses and calls are
validated and clamped) and **prices are taken from the room's menu, never from the
message**, so a buggy or hostile peer on the LAN cannot mis-price an order or break the
board. Money is integer paise, so a running bill never drifts.

The landing page at `docs/index.html` is its own object — a kitchen pass of thermal
tickets and hairline rules on butcher paper, deliberately unlike the app's rounded,
warm interface. Its badges are generated locally by `scripts/badges.py`; nothing on
either surface is fetched from an image service or a CDN.

## What it refuses to do

No cloud, no accounts, no internet, no telemetry, no CDN or external font, no app
store, no runtime dependency — and no price that came off the wire.

## Build the EXE and APK

This repo calls the shared build workflow. On every push, GitHub Actions builds a
portable Windows EXE and a signed Android APK from `docs/play` and attaches them to the
`app-latest` release, alongside the Linux binary.

## Licence

PolyForm Noncommercial 1.0.0 — see [LICENSE](LICENSE).
Required Notice: Copyright 2026 Dr Sohil Momin. Part of the Forge system — apps open,
orchestrator licensed.
