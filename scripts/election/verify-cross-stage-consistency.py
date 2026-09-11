#!/usr/bin/env python3
"""
Gate round 5 (2018-2022 tranche) PERMANENT guard: a motion that travels
through TWO stages -- a committee recommendation, then Council ratifying
(or rejecting) that same recommendation -- is very often extracted TWICE
into data/votes/_all-motions.json, once per stage, as two DIFFERENT motion
ids with the SAME operative text (a committee recommendation is frequently
carried forward into the Council agenda verbatim). The classify pipeline
independently classifies each stage's motion, so nothing stops the two
stages of the SAME decision from silently landing on two different
axis/polarity verdicts -- which is exactly what happened at
f90513408920/1de168466ef0 (see corrections.json): the Council ratification
(2021-01-12, item 8.5.6.6.7, PASS 14-1, sole nay Stephen Turner) kept
housing/application-approval/expansive for a byte-identical motion whose
committee twin (2020-12-16 SPPC, item 4.1) had already been corrected to
axis=null/polarity=null two rounds earlier ("should not tally Helmer,
Turner or Kayabaga as opponents of housing" -- a corporate-restructuring/
HDC-dissolution vote, not a housing-supply one) -- publishing Turner as
having opposed housing on a vote that was never about housing supply at
all. This is a DEFECT CLASS, not a one-off: this script finds every
instance corpus-wide (all batches, not just the era of the seed finding)
and requires each one resolved.

DETECTION RULE (the whole rule, not a summary):

  1. UNIVERSE: every verified-batch entry (any verdict -- axis/polarity
     drive the published claim regardless of verdict string; see
     lib_corrections) whose id resolves to a motion in
     data/votes/_all-motions.json with a non-blank motionText, loaded
     POST-corrections.json (lib_corrections.load_merged: both the
     VerifiedEntry fields -- axis/polarity/issue/etc -- and
     _all-motions.json's own motionText patches are applied first, so a
     correction already on file is picked up, never re-flagged).

  2. IDENTITY: group entries by their motion's OWN motionText,
     whitespace/quote-normalized (lib_corrections.norm_ws -- collapses
     runs of whitespace including NBSP, folds curly quotes to straight,
     same normalization verify-quote-verbatim.py's verbatim check uses).
     A LENGTH FLOOR (MIN_TEXT_LEN, see constant below) excludes bare
     procedural wrapper text -- "That the motion, as amended, BE
     APPROVED." (and its lowercase variant) is a 41-character ratification
     stub that recurs, unrelated, across dozens of totally different
     substantive motions corpus-wide (a spot-check while building this
     guard found it pairing a Ward Boundary Review report with an
     unrelated LDBA graffiti-removal grant, a Fireworks By-law options
     report, and eight more equally unrelated items, purely because the
     bare wrapper phrase is identical text -- 9 of the first 15 raw hits
     were this single false-positive shape); every GENUINE duplicate found
     in this corpus (the HDC dissolution clause, the Westdell referral,
     four more found building this guard) is 400+ characters of real
     operative text, so a floor well above the wrapper's 41 and well below
     the shortest genuine duplicate's 433 cleanly separates the two
     without needing to enumerate every wrapper phrasing by hand.

  3. PAIRING: within a text-identity group, pair entries whose motions are
     at DIFFERENT stages (Council vs any committee meetingType) and whose
     dates are within WINDOW_DAYS of each other (an era-bounded window --
     two unrelated motions from different decades that happen to reuse
     identical boilerplate text are not the same decision travelling
     through two stages of ONE process).

  4. FLAGGED: any such pair whose (axis, polarity) tuples -- read
     POST-corrections -- disagree.

  5. RESOLUTION: a flagged pair is resolved by EITHER
       (a) corrections.json has moved both sides onto the SAME
           (axis, polarity) tuple (checked post-correction, so a fix
           lands here automatically, no registry entry needed), OR
       (b) an entry in reviewed-cross-stage-pairs.json names this exact
           pair, quoting each side's own (already source-verbatim-checked
           -- see verify-quote-verbatim.py) `quote` field and giving a
           reason grounded in the motions' own text for why the stages
           genuinely differ (e.g. an amendment that changed the substance
           between committee and Council) -- each evidence quote is
           checked against that entry's actual `quote` field, not trusted
           un-checked.
     No blanket exemption by item shape -- every pair needs its own
     resolution.

  6. PASS requires zero unresolved pairs. FAIL (exit 1) lists every one.

Usage: python3 scripts/election/verify-cross-stage-consistency.py
       python3 scripts/election/verify-cross-stage-consistency.py --self-test
"""
import json
import sys
from datetime import date
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

REVIEWED_PATH = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "election"
    / "classify"
    / "reviewed-cross-stage-pairs.json"
)

# See "IDENTITY" in the module doc above for the calibration evidence.
MIN_TEXT_LEN = 100
WINDOW_DAYS = 60


def stage_of(meeting_type: str) -> str:
    return "council" if meeting_type == "Council" else "committee"


def load_reviewed() -> dict[frozenset, dict]:
    if not REVIEWED_PATH.exists():
        return {}
    rows = json.loads(REVIEWED_PATH.read_text())
    out = {}
    for r in rows:
        key = frozenset({r["id_a"], r["id_b"]})
        out[key] = r
    return out


def build_groups(entries: dict, motions: dict) -> dict[str, list[tuple[str, dict, dict]]]:
    groups: dict[str, list[tuple[str, dict, dict]]] = {}
    for eid, entry in entries.items():
        m = motions.get(eid)
        if m is None:
            continue
        text = m.get("motionText") or ""
        key = lc.norm_ws(text)
        if len(key) < MIN_TEXT_LEN:
            continue
        groups.setdefault(key, []).append((eid, entry, m))
    return groups


def find_mismatched_pairs(entries: dict, motions: dict) -> list[tuple[str, str, dict, dict, dict, dict]]:
    """Every cross-stage, era-bounded, text-identical pair whose
    (axis, polarity) disagree. Returns (id1, id2, entry1, entry2, m1, m2)."""
    groups = build_groups(entries, motions)
    out = []
    for rows in groups.values():
        if len(rows) < 2:
            continue
        for (id1, e1, m1), (id2, e2, m2) in combinations(rows, 2):
            if stage_of(m1["meetingType"]) == stage_of(m2["meetingType"]):
                continue
            d1 = date.fromisoformat(m1["date"])
            d2 = date.fromisoformat(m2["date"])
            if abs((d1 - d2).days) > WINDOW_DAYS:
                continue
            v1 = (e1.get("axis"), e1.get("polarity"))
            v2 = (e2.get("axis"), e2.get("polarity"))
            if v1 != v2:
                out.append((id1, id2, e1, e2, m1, m2))
    return out


def _verify_reviewed_quotes(row: dict, entries: dict) -> list[str]:
    problems = []
    for side in ("a", "b"):
        eid = row[f"id_{side}"]
        expected = entries.get(eid, {}).get("quote")
        actual = row.get(f"quote_{side}")
        if actual != expected:
            problems.append(
                f"reviewed-cross-stage-pairs.json quote_{side} for {eid} does not match that entry's own verified quote field"
            )
    return problems


def run_check(entries: dict, motions: dict) -> tuple[int, list[str]]:
    mismatches = find_mismatched_pairs(entries, motions)
    reviewed = load_reviewed()

    msgs = [f"Cross-stage, era-bounded, text-identical pairs checked with a verdict mismatch: {len(mismatches)}"]

    unresolved = []
    quote_problems = []
    for id1, id2, e1, e2, m1, m2 in mismatches:
        key = frozenset({id1, id2})
        row = reviewed.get(key)
        if row is None:
            unresolved.append((id1, id2, e1, e2, m1, m2))
            continue
        problems = _verify_reviewed_quotes(row, entries)
        if problems:
            quote_problems.append((id1, id2, problems))
            continue
        msgs.append(f"  REVIEWED (genuine difference): {id1} <-> {id2} -- {row.get('reason', '')[:100]}")

    msgs.append(f"\nUnresolved (no reviewed-cross-stage-pairs.json entry): {len(unresolved)}")
    for id1, id2, e1, e2, m1, m2 in unresolved:
        msgs.append(
            f"  -> {id1} ({m1['date']} {m1['meetingType']}) axis/polarity="
            f"{(e1.get('axis'), e1.get('polarity'))}"
        )
        msgs.append(
            f"     {id2} ({m2['date']} {m2['meetingType']}) axis/polarity="
            f"{(e2.get('axis'), e2.get('polarity'))}"
        )
        msgs.append(f"     motion text (first 120 chars): {(m1.get('motionText') or '')[:120]!r}")

    msgs.append(f"\nReviewed entries with a quote that doesn't match the entry's own verified quote: {len(quote_problems)}")
    for id1, id2, problems in quote_problems:
        msgs.append(f"  -> {id1} <-> {id2}")
        for p in problems:
            msgs.append(f"       {p}")

    if unresolved or quote_problems:
        msgs.append("\nFAILED")
        return 1, msgs
    msgs.append("\nALL CHECKS PASSED")
    return 0, msgs


# Negative test, both directions (gate round 5 requirement): the f90513408920
# correction (axis/polarity -> null, matching its committee twin
# 1de168466ef0) is the seed finding this guard exists to catch. Reverting it
# in-memory only (never touching corrections.json) must make run_check()
# fail; the real, corrected data must pass.
def self_test() -> int:
    entries, motions = lc.load_merged()

    print("=== self-test (1): revert the f90513408920 correction in-memory, expect exit 1 ===")
    if "f90513408920" not in entries or "1de168466ef0" not in entries:
        print("SELF-TEST FAILED: f90513408920/1de168466ef0 missing from the merged corpus")
        return 1
    reverted = {k: dict(v) for k, v in entries.items()}
    reverted["f90513408920"]["axis"] = "application-approval"
    reverted["f90513408920"]["polarity"] = "expansive"
    code, msgs = run_check(reverted, motions)
    if code != 1:
        print("\n".join(msgs))
        print("SELF-TEST FAILED: reverting f90513408920's correction did not fail the guard")
        return 1
    flagged = any(
        "f90513408920" in line and "1de168466ef0" in "\n".join(msgs)
        for line in msgs
    )
    if not flagged:
        print("\n".join(msgs))
        print("SELF-TEST FAILED: guard failed, but not on the expected f90513408920/1de168466ef0 pair")
        return 1
    print(" - reverted pair correctly detected as unresolved (exit 1)")

    print("\n=== self-test (2): restore (real, corrected data), expect exit 0 ===")
    code, msgs = run_check(entries, motions)
    print("\n".join(msgs))
    if code != 0:
        print("SELF-TEST FAILED: normal run on the real corrected corpus did not exit 0")
        return 1
    print("\nSELF-TEST PASSED")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    entries, motions = lc.load_merged()
    code, msgs = run_check(entries, motions)
    print("\n".join(msgs))
    return code


if __name__ == "__main__":
    sys.exit(main())
