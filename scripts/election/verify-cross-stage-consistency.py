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
instance corpus-wide (all batches, not just the era of the seed finding).

RESOLUTION SCOPE (fixer round 1, 2014-2018 tranche branch): detection stays
corpus-wide (every era's pairs are found and printed -- see below), but
RESOLUTION is required only for a pair where at least one side falls in
this branch's own era batches (ERA_BATCH_RANGE, 66-95, same convention as
sweep-substitution-vs-final.py / sweep-levy-thousands-rounding.py). A pair
entirely outside this branch's own batches is that OTHER era's own gate's
business, not this branch's fixer's -- identical reasoning to those two
sibling sweeps' own era scoping, and required here too: this branch's own
task explicitly forbids changing any pre-2023 rendered row, so a 2018-2022
mismatch this guard's widened (quote-based) detection newly surfaces is not
this branch's to correct. Such pairs are printed as OUT-OF-SCOPE, not
silently dropped, so the owning era's own gate round still sees them.

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

CLASSIFY_DIR = Path(__file__).resolve().parents[2] / "data" / "election" / "classify"
# See "RESOLUTION SCOPE" in the module doc above -- same convention as
# sweep-substitution-vs-final.py / sweep-levy-thousands-rounding.py.
ERA_BATCH_RANGE = range(66, 96)  # batches 66-95, the 2014-2018 term -- this branch's remit


def stage_of(meeting_type: str) -> str:
    return "council" if meeting_type == "Council" else "committee"


def load_era_ids() -> set[str]:
    ids: set[str] = set()
    for n in ERA_BATCH_RANGE:
        f = CLASSIFY_DIR / f"batch-{n}-verified.json"
        if not f.exists():
            continue
        for e in json.loads(f.read_text()):
            ids.add(e["id"])
    return ids


def load_reviewed() -> dict[frozenset, dict]:
    if not REVIEWED_PATH.exists():
        return {}
    rows = json.loads(REVIEWED_PATH.read_text())
    out = {}
    for r in rows:
        key = frozenset({r["id_a"], r["id_b"]})
        out[key] = r
    return out


def build_groups(entries: dict, motions: dict, text_of) -> dict[str, list[tuple[str, dict, dict]]]:
    groups: dict[str, list[tuple[str, dict, dict]]] = {}
    for eid, entry in entries.items():
        m = motions.get(eid)
        if m is None:
            continue
        text = text_of(entry, m) or ""
        key = lc.norm_ws(text)
        if len(key) < MIN_TEXT_LEN:
            continue
        groups.setdefault(key, []).append((eid, entry, m))
    return groups


# Fixer round 1 (gate finding: "verify-cross-stage-consistency.py joins
# twins on motionText, but 634 of 701 committee rows here are boilerplate,
# so its 0 is vacuous"): pre-2018 committee motionText is very often a bare
# "Motion Passed"/"Motion Failed" stub (see the module ERA NOTES), with the
# real operative text living only in an adjacent Paragraph sibling --
# lib_corrections.full_motion_texts recovers that text into the classify
# pipeline's own verified-entry `quote` field, but motionText itself stays
# boilerplate forever (it is _all-motions.json's own extraction, untouched
# by this era's recovery). Grouping ONLY on motionText therefore silently
# drops every cross-stage pair where one side's motionText is boilerplate
# -- exactly the shape hiding f480de5c2bdd/8985ed0ff68b (195 Dundas Street
# T-54 zone) and 4411a0f0ddcc/66e1dd367654 (324 York Street T-71 zone)
# below. A second identity join on each entry's OWN `quote` field (same
# norm_ws normalization, same MIN_TEXT_LEN floor) catches these: `quote`
# is the pipeline's best-effort recovered real text for BOTH stages, so
# two entries sharing an identical quote are the same underlying source
# clause even when their raw motionText rows differ in boilerplate-ness.
def _motion_text_of(entry: dict, m: dict) -> str:
    return m.get("motionText") or ""


def _quote_of(entry: dict, m: dict) -> str:
    return entry.get("quote") or ""


def find_mismatched_pairs(entries: dict, motions: dict) -> list[tuple[str, str, dict, dict, dict, dict]]:
    """Every cross-stage, era-bounded, text-identical pair whose
    (axis, polarity) disagree, where "text-identical" is motionText
    identity OR verified-quote identity (see the quote-grouping note
    above -- either is sufficient to mean "same underlying clause").
    Returns (id1, id2, entry1, entry2, m1, m2), deduplicated so a pair
    caught by both groupings is reported once."""
    out = []
    seen: set[frozenset] = set()
    for text_of in (_motion_text_of, _quote_of):
        groups = build_groups(entries, motions, text_of)
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
                if v1 == v2:
                    continue
                key = frozenset({id1, id2})
                if key in seen:
                    continue
                seen.add(key)
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
    era_ids = load_era_ids()

    msgs = [f"Cross-stage, era-bounded, text-identical pairs checked with a verdict mismatch: {len(mismatches)}"]

    unresolved = []
    out_of_scope = []
    quote_problems = []
    for id1, id2, e1, e2, m1, m2 in mismatches:
        key = frozenset({id1, id2})
        row = reviewed.get(key)
        if row is None:
            if id1 in era_ids or id2 in era_ids:
                unresolved.append((id1, id2, e1, e2, m1, m2))
            else:
                out_of_scope.append((id1, id2, e1, e2, m1, m2))
            continue
        problems = _verify_reviewed_quotes(row, entries)
        if problems:
            quote_problems.append((id1, id2, problems))
            continue
        msgs.append(f"  REVIEWED (genuine difference): {id1} <-> {id2} -- {row.get('reason', '')[:100]}")

    msgs.append(f"\nUnresolved, this branch's era (batches 66-95) -- no reviewed-cross-stage-pairs.json entry: {len(unresolved)}")
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

    msgs.append(
        f"\nOUT-OF-SCOPE (neither side in this branch's era batches 66-95 -- "
        f"that era's own gate's business, not this branch's; see RESOLUTION SCOPE above): {len(out_of_scope)}"
    )
    for id1, id2, e1, e2, m1, m2 in out_of_scope:
        msgs.append(
            f"  -> {id1} ({m1['date']} {m1['meetingType']}) axis/polarity={(e1.get('axis'), e1.get('polarity'))}"
            f"  <->  {id2} ({m2['date']} {m2['meetingType']}) axis/polarity={(e2.get('axis'), e2.get('polarity'))}"
        )

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

    # Direction 1: revert THIS BRANCH's own quote-grouping fix
    # (4411a0f0ddcc, 2014-2018 era, batch 86) in-memory and confirm the
    # guard fails on it -- era_ids includes it, so it must land in
    # "unresolved", not "out_of_scope".
    print("=== self-test (1): revert 4411a0f0ddcc's axis/polarity in-memory, expect exit 1 ===")
    if "4411a0f0ddcc" not in entries or "66e1dd367654" not in entries:
        print("SELF-TEST FAILED: 4411a0f0ddcc/66e1dd367654 missing from the merged corpus")
        return 1
    reverted = {k: dict(v) for k, v in entries.items()}
    reverted["4411a0f0ddcc"]["axis"] = None
    reverted["4411a0f0ddcc"]["polarity"] = None
    code, msgs = run_check(reverted, motions)
    if code != 1:
        print("\n".join(msgs))
        print("SELF-TEST FAILED: reverting 4411a0f0ddcc's correction did not fail the guard")
        return 1
    joined = "\n".join(msgs)
    if not ("4411a0f0ddcc" in joined and "66e1dd367654" in joined):
        print(joined)
        print("SELF-TEST FAILED: guard failed, but not on the expected 4411a0f0ddcc/66e1dd367654 pair")
        return 1
    print(" - reverted pair correctly detected as unresolved (exit 1)")

    # Direction 2: the era-scoping boundary itself -- f90513408920/
    # 1de168466ef0 (batch 54, 2018-2022 era, out of this branch's
    # ERA_BATCH_RANGE) must still be DETECTED when reverted (corpus-wide
    # detection is unaffected), but must land in out_of_scope, not
    # unresolved -- i.e. reverting it must NOT fail this branch's guard.
    print("\n=== self-test (2): revert f90513408920 (out-of-era) in-memory, expect exit 0 + OUT-OF-SCOPE ===")
    if "f90513408920" not in entries or "1de168466ef0" not in entries:
        print("SELF-TEST FAILED: f90513408920/1de168466ef0 missing from the merged corpus")
        return 1
    reverted2 = {k: dict(v) for k, v in entries.items()}
    reverted2["f90513408920"]["axis"] = "application-approval"
    reverted2["f90513408920"]["polarity"] = "expansive"
    code2, msgs2 = run_check(reverted2, motions)
    joined2 = "\n".join(msgs2)
    if code2 != 0:
        print(joined2)
        print("SELF-TEST FAILED: reverting the out-of-era pair failed this branch's guard (should be out-of-scope)")
        return 1
    if "f90513408920" not in joined2 or "OUT-OF-SCOPE" not in joined2:
        print(joined2)
        print("SELF-TEST FAILED: out-of-era reverted pair not reported under OUT-OF-SCOPE")
        return 1
    print(" - out-of-era reverted pair detected but correctly out-of-scope (exit 0)")

    print("\n=== self-test (3): restore (real, corrected data), expect exit 0 ===")
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
