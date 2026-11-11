# Canteen LAN — running a room

**Version 1.5.0 · PolyForm Noncommercial 1.0.0**

Order from your table over the room's own Wi-Fi. One machine hosts the canteen and serves
the board; every phone on the network joins it, orders from its seat, and the kitchen
watches each table move from *placed* to *served*. No internet, no accounts, no app store.

Try it without installing anything: the landing page embeds the real board
(`play/?demo=1`), seeded with a shift's worth of orders. The demo runs the same code as the
app — there is no second demo build.

## Start a room

One machine — a laptop, a Pi, anything with Node:

```bash
node host/room.js                            # room "canteen", port 8080
node host/room.js --pin 4821                 # a stranger on the Wi-Fi is refused
node host/room.js --print 192.168.1.50:9100  # every order prints a KOT
node host/room.js --menu my-menu.json        # seed the menu
node host/room.js --data .canteen            # where the journal lives
node host/room.js --mirror 192.168.1.21:8080 # keep a second host in step
```

**The PIN matters.** On a shared Wi-Fi a room without one is a room anyone can order in.

**Mirroring** forwards every broadcast to a peer host, so the counter keeps running if the
laptop dies. Forwarded messages are marked and never re-forwarded, so two hosts cannot loop
at each other; `--mirror-pin` is for a peer that does not share the room's PIN.

## What the guest does

Picks a table and a name, searches or filters the menu, chooses priced modifiers
(*Elaichi +₹5*), builds a cart that survives a reload, and places the order with a note.
*Show my bill* gives an itemised slip with a QR the counter can read.

## What the kitchen does

Every open order grouped by table with the running bill and the minutes each has waited —
or as a **floor** of tiles to tap. From there: mark an order *preparing*, *served* or
*cancelled*, **undo** a wrong tap, **split a table's bill** across heads in exact paise,
print a KOT or a bill, edit the menu with **stock counts**, **modifiers** and **serving
windows**, print the **menu board for the wall** on A3, read the **shift report** as a
screen or an A4 sheet, and export the day as CSV.

The shift downloads as a file and can be put back from the board, so a backup needs no
shell.

## When the Wi-Fi drops

A service worker holds the shell, and anything sent while the room is unreachable waits in
an outbox and is re-sent on reconnect. Order ids are idempotent, so a re-send can never
double-charge a table. That is the failure this app was built around: a canteen's Wi-Fi is
the least reliable part of a canteen.

## What it refuses to do

No cloud, no accounts, no internet, no telemetry, no CDN or external font, no app store, no
runtime dependency, no database or migrations, no printer driver — and no price that came
off the wire.

## Licence

PolyForm Noncommercial 1.0.0. See [LICENSE](../LICENSE).
