#!/usr/bin/env python3
"""
Round-2 gate item 6 verification: proves zero ladder-exclusion bullets are
byte-identical within any single "N votes excluded from the pattern above"
box, anywhere in the rendered Election Hub content.

BACKGROUND: motions 1c0f60d005b5 and d2ed469d2746 (2025-04-01 Council, two
SEPARATE recorded votes on literally the same part c) text -- Ark Aid's day
drop-in funding, one 9-5, one 11-3) shared the same whatAYeaDid, date, item,
and axis direction, and rendered as two byte-identical bullets in the same
box on e-peloza.md (and c-rahman.md) -- a reader had no way to tell they
were even two different motions. Fixed by appending each bullet's own
result tally (see renderLadderExclusions in generate-hub-pages.ts), which
is guaranteed to differ whenever the motionIds differ (a distinct recorded
vote has its own tally even when every other visible field matches).

WHAT COUNTS AS A BOX: every "**N vote(s) excluded from the pattern
above:**" block through to its first blank-line-terminated run of "- "
bullet lines, in every content/election/councillors/*.md file. This is the
actual rendered output, not stances.json re-parsed -- proving the markdown
a reader sees, not just the generator's internal state.

Usage: python3 scripts/election/verify-ladder-bullets-distinct.py
"""
import glob
import re
import sys

FAIL = []

BOX_RE = re.compile(
    r"\*\*\d+ votes? excluded from the pattern above:\*\*.*?\n\n"
    r"(?P<bullets>(?:^- .*(?:\n|$))+)",
    re.MULTILINE,
)

total_boxes = 0
total_bullets = 0

for path in sorted(glob.glob("content/election/councillors/*.md")):
    text = open(path, encoding="utf-8").read()
    for m in BOX_RE.finditer(text):
        bullets = [
            line for line in m.group("bullets").splitlines() if line.strip()
        ]
        if not bullets:
            continue
        total_boxes += 1
        total_bullets += len(bullets)
        seen = {}
        for b in bullets:
            seen.setdefault(b, 0)
            seen[b] += 1
        dupes = {b: n for b, n in seen.items() if n > 1}
        if dupes:
            for b, n in dupes.items():
                FAIL.append(
                    f"{path}: bullet repeated {n}x byte-identical -- {b[:140]}..."
                )

print(f"scanned {total_boxes} ladder-exclusion box(es), {total_bullets} bullet(s) total")

print()
if FAIL:
    print(f"{len(FAIL)} CHECK(S) FAILED:")
    for f in FAIL:
        print(" -", f)
    sys.exit(1)
else:
    print("ALL CHECKS PASSED -- zero byte-identical bullets in any ladder-exclusion box")
