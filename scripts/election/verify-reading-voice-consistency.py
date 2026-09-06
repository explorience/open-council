#!/usr/bin/env python3
"""
Gate round 5 nit (3), WIDENED to corpus-wide by gate round 6 item B (was
scoped to batch-26's reading-stage whatAYeaDid rows only), and WIDENED AGAIN
by gate round 7 item B from "two known outlier SHAPES" to "any reading- or
enactment-related whatAYeaDid, whatever its shape, that isn't the one
established voice" -- a structural rather than enumerated check, so a THIRD
outlier shape shipping the same way the round-6 two did is caught without
needing its own named regex first. The established corpus voice is "Gave
{first|second} reading to the by-law ..." / "Gave third reading and enacted
the by-law ..." (capital-G lead verb, lowercase ordinal, or "Gave third
reading to ..." for a row whose own motion text is "Third Reading" without
"Enactment" -- see round-6 item B's fix to 845f95f04614 and round-7 item A's
fix to abf12a805b05/cedd96e5b61f). This is a DIFFERENT defect class than
scripts/election/sweep-reading-stage-labels.py (which checks whether the
STAGE WORD itself is correct -- enact-before-third-reading, doubled
"Reading", stage-less prose, etc.) -- this script checks only the lead-in
verb/casing VOICE.

DETECTION RULE (the whole rule, not a summary), corpus-wide over every
verified entry with a whatAYeaDid, post corrections.json merge (see
lib_corrections.load_merged):

  1. IS THIS ROW READING/ENACTMENT-RELATED AT ALL? A row is in-scope for
     this check iff its whatAYeaDid contains the whole word "reading"
     (case-insensitive), OR a NON-NEGATED "enact"/"enacted"/"enacting"/
     "enactment" (case-insensitive) -- "negated" meaning immediately preceded
     by "without"/"not"/"never", the same hedge convention
     sweep-reading-stage-labels.py's own RE_D_NEGATED already established
     for "this row correctly disclaims taking that action, it isn't
     describing a reading/enactment vote" (see f303ed387f89: "...without
     enacting any restriction itself" -- a Sound By-law report-back
     direction, not a by-law reading). A whatAYeaDid containing the phrase
     "to read" ("Amended ... to read: '...'", "Amended ... to read with
     ...") is excluded from this whole check regardless of the above: that
     phrase is the corpus's own convention for quoting a motion that edits a
     document's TEXT to read a certain way, not a legislative reading vote
     (see d597de71c11e, 5836ca6ba10c) -- checked BEFORE the reading/enact
     tests above, not after, so it can't ever be pulled in as a false
     positive by an incidental "enact" substring.

     ALSO in-scope, carried forward unchanged from the pre-round-7 version
     of this check (case (2) below): a whatAYeaDid opening "Introduced " (or
     any "introduc-" form) whose OWN MOTION's motionText in
     data/votes/_all-motions.json is a genuine Council-floor "Introduction
     and First Reading of (Added) Bill No. ..." motion -- checked against
     motionText, not just the whatAYeaDid string, so this never flags the
     textually similar but substantively different "the proposed by-law ...
     BE INTRODUCED at the Municipal Council meeting to be held on <date>"
     committee-recommendation motions (a different motion type entirely,
     recommending a FUTURE introduction rather than being the Council floor
     reading vote itself, correctly rendered "Introduced ..." and NOT
     in scope here -- see 82436acb664e/7cc504955dbf/91bfab0188be/
     20bd87838867/d7df3dccd45a, round-7 item A's own "supported
     introducing"->"Introduced" fixes, all confirmed by their own `quote`
     field to be this future-meeting shape, not the floor vote).

  2. IF IN-SCOPE, DOES IT MATCH THE ESTABLISHED VOICE? A single regex,
     ESTABLISHED_RE, both defines the target voice AND (being a plain,
     non-IGNORECASE pattern) enforces exact casing in the same test: "^Gave
     (first|second) reading to\\b" or "^Gave third reading (?:and
     enacted|to)\\b". Any in-scope row that does not match this is an
     outlier -- whatever shape it takes, not just the two shapes named by
     name in earlier rounds' fixes.

Corpus-wide + single-target-voice together are also what makes "no page
shows two voices for the same meeting" (round-7 gate item B's other named
requirement, after s-hillier.md L943 vs L947 shipped two) structurally
impossible to violate: if every in-scope row in the ENTIRE corpus must match
one voice, no subset of rows (a single meeting's, or any other grouping)
can ever show two.

Usage: python3 scripts/election/verify-reading-voice-consistency.py
       python3 scripts/election/verify-reading-voice-consistency.py --self-test
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

ESTABLISHED_RE = re.compile(
    r"^Gave (first|second) reading to\b|^Gave third reading (?:and enacted|to)\b"
)

TO_READ_RE = re.compile(r"\bto read\b", re.IGNORECASE)
READING_WORD_RE = re.compile(r"\breading\b", re.IGNORECASE)
ENACT_WORD_RE = re.compile(r"\benact\w*\b", re.IGNORECASE)
# Same negation convention as sweep-reading-stage-labels.py's RE_D_NEGATED:
# an "enact" immediately preceded by without/not/never is a correctly-hedged
# disclaimer, not an enactment claim.
NEGATED_BEFORE_RE = re.compile(r"\b(without|not|never)\s+$", re.IGNORECASE)

INTRODUC_RE = re.compile(r"^introduc", re.IGNORECASE)
READING_MOTION_RE = re.compile(
    r"Introduction and First Reading of (?:Added )?Bill No", re.IGNORECASE
)


def is_reading_related(text: str, motion: dict | None) -> bool:
    if TO_READ_RE.search(text):
        return False
    if READING_WORD_RE.search(text):
        return True
    for m in ENACT_WORD_RE.finditer(text):
        preceding = text[max(0, m.start() - 15) : m.start()]
        if not NEGATED_BEFORE_RE.search(preceding):
            return True
    if INTRODUC_RE.match(text):
        mt = (motion or {}).get("motionText", "") or ""
        if READING_MOTION_RE.search(mt):
            return True
    return False


def find_outliers(entries: dict, motions: dict) -> tuple[list[tuple[str, str]], int]:
    outliers: list[tuple[str, str]] = []
    established = 0
    for mid, e in entries.items():
        text = e.get("whatAYeaDid", "") or ""
        if not text:
            continue
        if not is_reading_related(text, motions.get(mid)):
            continue
        if ESTABLISHED_RE.match(text):
            established += 1
        else:
            outliers.append((mid, text))
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
        f"corpus-wide rows in an outlier reading/enactment voice: {len(outliers)}",
    ]
    if outliers:
        msgs.append("\nFAILED — outlier voice rows found:")
        for mid, text in outliers:
            msgs.append(f" - {mid}: {text}")
        return 1, msgs
    msgs.append("\nALL CHECKS PASSED")
    return 0, msgs


# Round-7 gate item B: negative-test ids, one per distinct outlier SHAPE this
# widened check now catches structurally rather than by name (the
# stance-verb "Supported ..." shape round-7 item A eliminated, the
# non-stance "Approved <ordinal> reading of ..." second-voice shape round-7
# item B separately eliminated, and a wrong-casing regression of the
# established voice itself) -- each reverted in-memory (never touches
# corrections.json) to prove this check's single ESTABLISHED_RE-based rule
# still bites all three, not just proven green against already-fixed data.
_SELF_TEST_REVERTS = {
    # Round-6-era stance-verb shape (round-7 item A's fix target).
    ("ef5ba3d2a570", "whatAYeaDid"): "Supported the third reading and enactment of Bill No. 343.",
    # Case-2 shape (motionText cross-check): "Introduced ..." with no stance
    # verb at all -- would otherwise look like the legitimate future-meeting
    # "Introduced" convention (see this module's own doc comment), but this
    # id's OWN motionText is a genuine Council-floor "Introduction and First
    # Reading" motion, so it must be "Gave first reading to ...", not
    # "Introduced ...". (The combined "supported introducing" shape from
    # pre-round-7 rounds is no longer a distinct case to test here: round-7
    # item A's stance-verb sweep now forbids ANY "Supported"/"supported"
    # opening corpus-wide regardless of what follows, so that half of the
    # old regression is covered there, not here.)
    ("bea3acfae330", "whatAYeaDid"): "Introduced by-laws authorizing land expropriation applications for the Rapid Transit East London Link Project and the Wellington Gateway Project.",
    # Non-stance second-voice shape round-7 item B eliminated (93 rows).
    ("b54f6548c3da", "whatAYeaDid"): "Approved introduction and first reading of Bill No. 251, one of eighteen individual by-law reading motions in the omnibus By-laws item that formalize decisions already made elsewhere on the agenda.",
    # Wrong-casing regression of the established voice itself (title-cased
    # ordinal) -- proves the casing half of the rule, not just the voice half.
    ("7cb01adc17ee", "whatAYeaDid"): "Gave Second Reading to Bill No. 251, one of eighteen individual by-law reading motions in the omnibus By-laws item that formalize decisions already made elsewhere on the agenda.",
}


def self_test() -> int:
    print("=== self-test: revert round-7 item A/B's fixes, expect exit 1 ===")
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
        print("SELF-TEST FAILED: reverting the three outlier shapes did not produce exit 1")
        return 1
    entries = lc.load_verified_entries()
    motions = lc.load_all_motions()
    lc.apply_corrections(entries, motions, mutated)
    flagged_ids = {mid for mid, _ in find_outliers(entries, motions)[0]}
    expected_ids = {mid for mid, _ in _SELF_TEST_REVERTS}
    if not expected_ids <= flagged_ids:
        print(f"SELF-TEST FAILED: expected all of {expected_ids} flagged, got {flagged_ids}")
        return 1
    print("\n=== self-test: restore, expect exit 0 ===")
    code2, msgs2 = run_check()
    print("\n".join(msgs2))
    if code2 != 0:
        print("SELF-TEST FAILED: normal (unmutated) run did not exit 0")
        return 1
    print("\nSELF-TEST PASSED")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    code, msgs = run_check()
    print("\n".join(msgs))
    return code


if __name__ == "__main__":
    sys.exit(main())
