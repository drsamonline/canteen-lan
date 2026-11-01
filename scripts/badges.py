#!/usr/bin/env python3
"""Draw this repository's badges as local SVGs — no image service, no network.

An offline-first app should not need the internet to describe itself, so the
README and the landing page reference these files by relative path. They render
on Pages, in the README, and straight from `file://`.

Keep every claim true: the test count is what `node test-node.js` prints, the
licence is what LICENSE says, and "0 runtime" means the app ships no dependency.

  python3 scripts/badges.py
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

INK = "#14120f"
PAPER = "#fffdf7"
AMBER = "#a85c00"
GREEN = "#2f6b4a"
SLATE = "#3d4650"

BADGES = [
    ("live", "live", "online", GREEN),
    ("tests", "tests", "211 passing", GREEN),
    ("deps", "deps", "0 runtime", SLATE),
    ("offline", "offline", "no network", INK),
    ("licence", "licence", "PolyForm NC 1.0.0", AMBER),
    ("protocol", "protocol", "12 messages", SLATE),
]

CH = 6.55  # rough advance width of an 11px sans character


def badge(label, value, colour):
    lw = int(len(label) * CH) + 16
    vw = int(len(value) * CH) + 16
    total = lw + vw
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="22" role="img" '
        'aria-label="%s: %s"><title>%s: %s</title>'
        '<linearGradient id="s" x2="0" y2="100%%">'
        '<stop offset="0" stop-color="#fff" stop-opacity=".10"/>'
        '<stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>'
        '<clipPath id="r"><rect width="%d" height="22" rx="3" fill="#fff"/></clipPath>'
        '<g clip-path="url(#r)">'
        '<rect width="%d" height="22" fill="%s"/>'
        '<rect x="%d" width="%d" height="22" fill="%s"/>'
        '<rect width="%d" height="22" fill="url(#s)"/>'
        "</g>"
        '<g fill="%s" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" '
        'font-size="11" text-anchor="middle">'
        '<text x="%d" y="15">%s</text><text x="%d" y="15">%s</text>'
        "</g></svg>"
    ) % (total, label, value, label, value, total, lw, INK, lw, vw, colour, total,
         PAPER, lw // 2, label, lw + vw // 2, value)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, label, value, colour in BADGES:
        path = os.path.join(OUT, "badge-%s.svg" % name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(badge(label, value, colour))
        print("wrote", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
