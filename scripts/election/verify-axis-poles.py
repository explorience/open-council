#!/usr/bin/env python3
"""
Gate round 3 item D CLASS guard: every (issue, axis) pair actually PUBLISHED
on a direction-bearing row must be LIVE in direction-rules.ts's
axisLabelsFor AND resolve to two genuinely DISTINCT pole labels. This is the
defect class f5d2c8a7250b exposed: axis="service-expansion" was retired by
the 2026-08-31 transit-service/road-capacity split, so axisLabelsFor(issue,
axis) returns null for it, and generate-stances.ts's directionFromVerified
falls back to "{expansive: entry.whatAYeaDid, restrictive: entry.whatAYeaDid}"
-- both poles becoming the SAME text, rendering a degenerate "X vs. X"
heading (and, downstream, a garbled "would have Gave final approval..."
sentence) on every profile that row touches. A future retirement or typo in
some other axis string would produce the exact same symptom; this guard
targets the CLASS, not this round's id.

DETECTION RULE (the whole rule, not a summary):

  1. Universe: every (issue, axis) pair appearing on a CURRENT (post-
     corrections.json) direction-bearing entry (verdict confirmed/corrected,
     axis AND polarity both non-null) across every batch-*-verified.json.

  2. Ground truth: axisLabelsFor(issue, axis) is called from the REAL
     TypeScript source (scripts/election/direction-rules.ts), via a tiny
     `npx tsx` bridge (axis-poles-dump.ts) -- never a Python
     re-implementation of that function's logic, which would silently drift
     from the source of truth the moment either file changed without the
     other being updated to match.

  3. FAIL a pair if axisLabelsFor returns null (axis not live for this
     issue -- retired, mistyped, or never existed) OR if it returns
     {expansive, restrictive} with expansive == restrictive (a live axis
     that degenerates to one label, e.g. a copy-paste bug in
     direction-rules.ts itself).

  4. PASS requires zero failing pairs.

Usage: python3 scripts/election/verify-axis-poles.py
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_corrections import load_merged  # noqa: E402

SCRIPT_DIR = Path(__file__).resolve().parent
BRIDGE = SCRIPT_DIR / "axis-poles-dump.ts"


def main() -> int:
    entries, _motions = load_merged()

    pairs = sorted(
        {
            (e["issue"], e["axis"])
            for e in entries.values()
            if e["verdict"] in ("confirmed", "corrected") and e["axis"] is not None and e["polarity"] is not None
        }
    )

    print(f"Published (issue, axis) pairs on direction-bearing rows: {len(pairs)}\n")

    payload = json.dumps([{"issue": issue, "axis": axis} for issue, axis in pairs])
    result = subprocess.run(
        ["npx", "tsx", str(BRIDGE)],
        input=payload,
        capture_output=True,
        text=True,
        cwd=str(SCRIPT_DIR.parent.parent),
    )
    if result.returncode != 0:
        print("FAIL: axis-poles-dump.ts bridge errored:")
        print(result.stderr)
        return 1

    dumped = json.loads(result.stdout)

    failures = []
    for row in dumped:
        issue, axis, labels = row["issue"], row["axis"], row["labels"]
        if labels is None:
            print(f"FAIL: ({issue}, {axis}) -- axisLabelsFor returns null (not live)")
            failures.append((issue, axis, "not live"))
            continue
        if labels["expansive"] == labels["restrictive"]:
            print(f"FAIL: ({issue}, {axis}) -- both poles are the SAME text: {labels['expansive']!r}")
            failures.append((issue, axis, "degenerate poles"))
            continue
        print(f"OK: ({issue}, {axis}) -- {labels['expansive']!r} / {labels['restrictive']!r}")

    print(f"\n{'=' * 60}")
    print(f"Failing pairs: {len(failures)}")
    if failures:
        print("\nEach failing pair needs a corrections.json row moving its rows off the")
        print("bad axis (a live axis with an unambiguous operative basis, or null).")
        return 1

    print("\nZero failing (issue, axis) pairs. PASS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
