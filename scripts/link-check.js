test(link-check): a scheme is not a path, and a link is not an asset

Two checks in scripts/link-check.js read href the way the suite used to:

- the support block's UPI payment link (upi://pay?pa=...) was resolved as a
  file on disk, so it reported "missing docs/upi:/pay". isRemote now matches
  any scheme - https:, mailto:, tel:, upi: - instead of only http and mailto.
- "the app references no remote asset" searched for (src|href)="http, so the
  external anchors in the app's support block failed it. It now uses the same
  resource-only rule as test-node.js.

Both were hidden behind the test-node.js failure, which aborted the job before
this step ran.

node scripts/link-check.js: 37 passed, 0 failed (was 36/2).