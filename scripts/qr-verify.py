#!/usr/bin/env python3
"""Verify host/qr.js against the reference `qrcode` library.

A hand-rolled QR encoder is exactly the kind of code that looks right and scans
wrong, so it is checked module-for-module against a reference implementation
before it is trusted: same version, same mask, same 8-bit payload, same matrix.
Run it after touching host/qr.js.

  pip install qrcode
  python3 scripts/qr-verify.py
"""
import json
import subprocess
import sys

import qrcode
from qrcode.constants import ERROR_CORRECT_L
from qrcode.util import QRData, MODE_8BIT_BYTE

CASES = [
    "http://192.168.1.20:8080",
    "http://canteen.local:8080/play/",
    "http://10.0.0.7:8080",
    "http://192.168.100.244:3000/play/?room=canteen",
]


def ours(text):
    out = subprocess.run(
        ["node", "-e",
         'const qr=require("./host/qr.js");const r=qr.encode(process.argv[1]);'
         'console.log(JSON.stringify({version:r.version,mask:r.mask,size:r.size,'
         'modules:r.modules.map(row=>row.map(b=>b?1:0))}))', text],
        capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def reference(text, mask):
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_L,
                       mask_pattern=mask, border=0)
    qr.add_data(QRData(text.encode(), mode=MODE_8BIT_BYTE), optimize=0)
    qr.make(fit=True)
    return qr.version, [[1 if c else 0 for c in row] for row in qr.get_matrix()]


def main():
    bad = 0
    for text in CASES:
        mine = ours(text)
        version, ref = reference(text, mine["mask"])
        same = mine["modules"] == ref
        print("%-46s v%-2d mask %d  %s" % (text, mine["version"], mine["mask"],
                                           "MATCH" if same else "MISMATCH"))
        if not same:
            bad += 1
            if version != mine["version"]:
                print("   version differs: ours %d, reference %d" % (mine["version"], version))
            else:
                diffs = sum(1 for y in range(len(ref)) for x in range(len(ref))
                            if ref[y][x] != mine["modules"][y][x])
                print("   %d modules differ" % diffs)
    print("\n%d/%d exact" % (len(CASES) - bad, len(CASES)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
