#!/usr/bin/env python3
"""
Gate round 5 nit (3), WIDENED to corpus-wide by gate round 6 item B (was
scoped to batch-26's reading-stage whatAYeaDid rows only — see the
docstring history below). The established corpus voice is "Gave
{first|second} reading to the by-law ..." / "Gave third reading and
enacted the by-law ..." (capital-G lead verb, or "Gave third reading to
..." for the one row whose own motion text is "Third Reading" without
"Enactment" — see round-6 item B's fix to 845f95f04614). This is a
DIFFERENT defect class than scripts/election/sweep-reading-stage-labels.py
(which checks whether the STAGE WORD itself is correct — enact-before-
third-reading, doubled "Reading", stage-less prose, etc.) — this script
checks only the lead-in verb/capitalization voice.

TWO recognized outlier shapes, both checked corpus-wide (every verified
entry with a whatAYeaDid, post corrections.json merge — see
lib_corrections.load_merged):

  1. "supported/Supported the {second|third} reading (and enactment) of
     Bill No. N" (any capitalization) — the shape round-5 found scoped to
     batch-26 (6 rows, fixed that round) and left un-widened for a 19-row
     population in batch-27/batch-31 (the omnibus multi-bill-reading
     convention) as "found, not fixed... flagged for a future round's
     disposition". Round-6 item B fixed all 19 and widened this check's
     POPULATION from batch-26-only to every verified entry, so a future
     regression anywhere in the corpus is caught, not just in one batch.

  2. "supported introducing ..." on a row whose OWN motion text is a
     genuine "Introduction and First Reading of (Added) Bill No. ..."
     motion (checked against data/votes/_all-motions.json's motionText,
     not just the whatAYeaDid string, so this never flags the textually
     similar but substantively different "the proposed by-law ... BE
     INTRODUCED at the Municipal Council meeting to be held on <date>"
     committee-recommendation motions — a different motion type entirely,
     recommending a FUTURE introduction rather than being the Council
     floor reading vote itself, correctly left in its own "supported
     introducing" convention). Round-6 item B found 3 such rows by
     corpus-wide script enumeration (2 named in the gate brief —
     bea3acfae330, 903db8a9f294 — plus 522fd6b0b246, found by this
     script's own enumeration, not previously named) whose ladders mixed
     voices with their already-"Gave ... reading to..." second/third-
     reading siblings on the same by-law.

Usage: python3 scripts/election/verify-reading-voice-consistency.py
       python3 scripts/election/verify-reading-voice-consistency.py --self-test
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

OUTLIER_RE = re.compile(r"^supported the (second|third) reading\b", re.IGNORECASE)
FIRST_READING_OUTLIER_RE = re.compile(r"^supported introducing\b", re.IGNORECASE)
ESTABLISHED_RE = re.compile(
    r"^Gave (first|second) reading to\b|^Gave third reading (?:and enacted|to)\b"
)
# Matches a genuine Council-floor "Introduction and First Reading" motion —
# see this module's own docstring, case (2), for why this is checked
# against motionText rather than trusting the whatAYeaDid string alone.
READING_MOTION_RE = re.compile(
    r"Introduction and First Reading of (?:Added )?Bill No", re.IGNORECASE
)


def find_outliers(
    entries: dict, motions: dict
) -> tuple[list[tuple[str, str, str]], int]:
    outliers: list[tuple[str, str, str]] = []
    established = 0
    for mid, e in entries.items():
        text = e.get("whatAYeaDid", "") or ""
        if not text:
            continue
        if OUTLIER_RE.search(text):
            outliers.append((mid, text, "third-reading omnibus voice"))
            continue
        if FIRST_READING_OUTLIER_RE.search(text):
            m = motions.get(mid)
            mt = (m or {}).get("motionText", "") or ""
            if READING_MOTION_RE.search(mt):
                outliers.append(
                    (mid, text, "first-reading 'supported introducing' voice")
                )
                continue
        if ESTABLISHED_RE.search(text):
            established += 1
    return outliers, established


def run_check(corrections_override=None) -> tuple[int, list[str]]:
    entries = lc.load_verified_entries()
    motions = lc.load_all_motions()
    corrections = (
        corrections_override
        if corrections_override is not None
        else lc.load_corrections()
    )
    lc.apply_corrections(entries, motions, corrections)

    outliers, established = find_outliers(entries, motions)

    msgs = [
        f"corpus-wide rows in the established 'Gave ... reading' voice: {established}",
        f"corpus-wide rows in an outlier reading voice: {len(outliers)}",
    ]
    if outliers:
        msgs.append("\nFAILED — outlier voice rows found:")
        for mid, text, kind in outliers:
            msgs.append(f" - {mid} ({kind}): {text}")
        return 1, msgs
    msgs.append("\nALL CHECKS PASSED")
    return 0, msgs


# Round-6 gate item B: negative-test ids, one per recognized outlier shape,
# each reverted in-memory (never touches corrections.json) to its
# pre-round-6 outlier text so this check's own two regexes are proven to
# still bite, not just proven green against already-fixed data.
_SELF_TEST_REVERTS = {
    ("ef5ba3d2a570", "whatAYeaDid"): "Supported the third reading and enactment of Bill No. 343.",
    ("bea3acfae330", "whatAYeaDid"): "supported introducing by-laws authorizing land expropriation applications for the Rapid Transit East London Link Project and the Wellington Gateway Project.",
}


def self_test() -> int:
    print("=== self-test: revert round-6 item B's fixes, expect exit 1 ===")
    base = lc.load_corrections()
    mutated = []
    reverted = set()
    for c in base:
        key = (c["id"], c["field"])
        if key in _SELF_TEST_REVERTS and c["now"] != _SELF_TEST_REVERTS[key]:
            c = dict(c)
            c["now"] = _SELF_TEST_REVERTS[key]
            reverted.add(key)
        mutated.append(c)
    if reverted != set(_SELF_TEST_REVERTS):
        print(f"SELF-TEST FAILED: expected to revert {set(_SELF_TEST_REVERTS)}, actually reverted {reverted}")
        return 1
    code, msgs = run_check(corrections_override=mutated)
    print("\n".join(msgs))
    if code != 1:
        print("SELF-TEST FAILED: reverting the two outlier shapes did not produce exit 1")
        return 1
    flagged_ids = {mid for mid, _, _ in find_outliers(*_mutated_merge(mutated))[0]}
    if not {"ef5ba3d2a570", "bea3acfae330"} <= flagged_ids:
        print(f"SELF-TEST FAILED: expected both reverted ids flagged, got {flagged_ids}")
        return 1
    print("\n=== self-test: restore, expect exit 0 ===")
    code2, msgs2 = run_check()
    print("\n".join(msgs2))
    if code2 != 0:
        print("SELF-TEST FAILED: normal (unmutated) run did not exit 0")
        return 1
    print("\nSELF-TEST PASSED")
    return 0


def _mutated_merge(mutated):
    entries = lc.load_verified_entries()
    motions = lc.load_all_motions()
    lc.apply_corrections(entries, motions, mutated)
    return entries, motions


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    code, msgs = run_check()
    print("\n".join(msgs))
    return code


if __name__ == "__main__":
    sys.exit(main())
