#!/usr/bin/env python3
"""
Gate round 3 item F2 (minor, excerpt renderer) sweep: confirms zero
motionText in the corpus still carries the "glued attendance aside" defect
that generate-stances.ts's motionSnippet() strips before rendering the
"Motion (excerpt)" cell — e.g. f96ee1b77651: "That Introduction and First
Reading of Bill No. 312 BE APPROVED It being noted that Councillor S.
Trosow leaves the meeting at 5:11 PM", where the source has NO period
between the operative clause and the trailing "It being noted..." aside, so
STAGE_DIRECTION_RE (which requires the aside to START with "At H:MM" and
END with a period) never matches it and the excerpt renders as one glued,
confusing run-on sentence.

DETECTION RULE (mirrors generate-stances.ts's TRAILING_ATTENDANCE_ASIDE_RE
exactly — see that regex's own doc comment for why it's anchored to the end
of the string rather than requiring a leading "At H:MM", and why it never
touches a legitimate MID-motion "it being noted that ..." clause that is
followed by more operative text elsewhere in the same string):

  1. Universe: every motion in data/votes/_all-motions.json (not just
     verified/classified rows — the excerpt renderer runs on EVERY row a
     councillor's evidence table shows, classified or not).

  2. FAIL a motion whose own `motionText` ends with (after generate-
     stances.ts's existing STAGE_DIRECTION_RE strip, applied here too, so
     a MOTION where that strip alone already clears the aside is not
     double-counted): "It being/was noted that ... leaves/enters/
     re-enters/assumes/vacates ... H:MM AM/PM" with nothing following it —
     the exact residue TRAILING_ATTENDANCE_ASIDE_RE is meant to remove.

  3. PASS requires zero such motions remaining.

Usage: python3 scripts/election/sweep-excerpt-attendance-residue.py
"""
import json
import re
import sys

ALL_MOTIONS_PATH = "data/votes/_all-motions.json"

# Mirrors generate-stances.ts's STAGE_DIRECTION_RE exactly.
STAGE_DIRECTION_RE = re.compile(
    r"\bAt\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b(?:[^.]|(?<=\b[A-Z])\.)*\.\s*", re.IGNORECASE
)
# Mirrors generate-stances.ts's TRAILING_ATTENDANCE_ASIDE_RE exactly.
TRAILING_ATTENDANCE_ASIDE_RE = re.compile(
    r"\s+It (?:being|was) noted that\b.*?\b(?:leaves|enters|re-enters|assumes|vacates)\b.*?\d{1,2}:\d{2}\s*(?:AM|PM)\.?\s*$",
    re.IGNORECASE,
)


def snippet(motion_text: str) -> str:
    s = STAGE_DIRECTION_RE.sub(" ", motion_text)
    s = TRAILING_ATTENDANCE_ASIDE_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def main() -> int:
    motions = json.load(open(ALL_MOTIONS_PATH))["motions"]

    residue = []
    for m in motions:
        mt = m.get("motionText") or ""
        snip = snippet(mt)
        # After both strips, no trailing attendance-departure/arrival aside
        # should remain -- check the FIXED snippet, not the raw text, so
        # this sweep verifies motionSnippet()'s actual output, not just
        # whether the raw source happens to contain the phrase somewhere
        # (a legitimate mid-motion "it being noted" is fine and expected).
        if re.search(r"\b(leaves|enters|re-enters|assumes|vacates)\b.*?\d{1,2}:\d{2}\s*(?:AM|PM)\s*$", snip, re.IGNORECASE):
            residue.append((m["id"], snip[-140:]))

    print(f"Motions checked: {len(motions)}")
    print(f"Residual glued attendance-aside excerpts after motionSnippet(): {len(residue)}\n")
    for mid, tail in residue:
        print(f"  {mid}: ...{tail!r}")

    if residue:
        print("\nFAIL — extend generate-stances.ts's TRAILING_ATTENDANCE_ASIDE_RE to cover this shape.")
        return 1
    print("Zero residue corpus-wide. PASS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
