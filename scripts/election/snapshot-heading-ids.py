#!/usr/bin/env python3
"""Snapshot every AUTO-GENERATED heading id on every built meeting page.

Used by the non-disruption diff in verify-evidence-anchor-precision.py: the
per-motion anchor change must be purely additive, so the set and ORDER of
heading ids emitted by rehype-slug has to be byte-identical before and after.
github-slugger's "-1/-2" duplicate suffixes depend on document order, so a
change that perturbed the heading stream would silently re-point every
already-published heading link on that page.

Usage:
  python3 scripts/election/snapshot-heading-ids.py <out.json> [public-dir]
"""
import json
import os
import re
import sys

HEADING_RE = re.compile(rb'<(h[1-6])\b[^>]*\bid="([^"]*)"', re.IGNORECASE)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: snapshot-heading-ids.py <out.json> [public-dir]")
        return 2
    out_path = sys.argv[1]
    public_dir = sys.argv[2] if len(sys.argv) > 2 else "public"
    months = os.path.join(public_dir, "months")
    if not os.path.isdir(months):
        print(f"FAIL: no built meeting pages under {months} — run npm run build first")
        return 1

    snapshot = {}
    for root, _dirs, files in os.walk(months):
        for name in sorted(files):
            if not name.endswith(".html"):
                continue
            path = os.path.join(root, name)
            with open(path, "rb") as fh:
                html = fh.read()
            rel = os.path.relpath(path, public_dir)
            snapshot[rel] = [m.group(2).decode("utf-8") for m in HEADING_RE.finditer(html)]

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(snapshot, fh, indent=1, sort_keys=True)
    total = sum(len(v) for v in snapshot.values())
    print(f"snapshot: {len(snapshot)} pages, {total} auto-generated heading ids -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
