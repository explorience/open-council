#!/usr/bin/env python3
"""
Round-7 gate item A: corpus-wide guard that NO verified entry's whatAYeaDid
(post corrections.json merge -- see lib_corrections.load_merged) opens with
a voter-STANCE verb -- a verb that describes what the VOTER FELT about a
motion (agreement/endorsement) rather than what the MOTION ITSELF did.

WHY THIS MATTERS (the actual defect, not just a style nit): whatAYeaDid is
rendered for every voter on a motion, not just its Yea voters -- both in
the main evidence table (behind a "What a yea did" column header) and, for
a same-decision-group collision, as a header-LESS ladder-exclusion bullet:
"- <Vote>: <whatAYeaDid> -- <link> (...)". A stance verb reads as a claim
about voter agreement regardless of which column/context it sits in, so on
a header-less bullet paired with a non-Yea vote it asserts the opposite of
that vote standing alone -- round-6's own exhibit was
"- Nay: Supported final enactment of the added by-laws..." (a-hopkins.md
L34, 801 Sarnia Road), which reads as Hopkins supporting exactly what his
recorded Nay opposed. The header-bearing evidence-table cells aren't exempt
either: the corpus's own established convention describes what the MOTION
DID ("Gave first reading to...", "Approved...", "Directed...", "Adopted...",
or the hedged "Would have..." construction on a Failed motion) precisely so
the same text is unambiguously true regardless of context or vote -- a
stance verb breaks that invariant by construction, everywhere it appears,
which is why this check is corpus-wide and unconditional rather than scoped
to header-less bullets only.

ENUMERATED STANCE-VERBS (the whole list, not just this round's strings --
per the gate brief's own instruction to enumerate the CLASS, not just the
instances found this round): "Supported", "Backed", "Endorsed" -- each
checked case-insensitively, anchored to the start of the label. "Endorsed"
is included even though a motion's own operative clause sometimes literally
reads "BE ENDORSED": the corpus's established action-voice vocabulary
(Approved/Adopted/Directed/Gave, etc.) already covers every real
council action, "Endorsed" included, without needing a
personal-agreement-flavored verb at all -- see round-7 item A's own fixes,
which reworded every "Endorsed ..." row to "Adopted ..." or "Approved ..."
per what each motion's own quote showed Council actually did.

This list is deliberately a literal, maintained enumeration (not a broader
heuristic like "any verb that can mean agreement") so it stays auditable and
extending it to a genuinely new observed stance-verb is a one-line change
with a self-test to prove it bites, per this repo's own established
sweep-script convention (see e.g. sweep-outcome-verb-inversion.py's
OUTCOME_VERBS list).

Usage: python3 scripts/election/verify-no-stance-verb-whataeadid.py
       python3 scripts/election/verify-no-stance-verb-whataeadid.py --self-test
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

STANCE_VERBS = ["Supported", "Backed", "Endorsed"]
STANCE_VERB_RE = re.compile(
    r"^(" + "|".join(re.escape(v) for v in STANCE_VERBS) + r")\b", re.IGNORECASE
)


def find_violations(entries: dict) -> list[tuple[str, str]]:
    violations = []
    for mid, e in entries.items():
        text = e.get("whatAYeaDid", "") or ""
        if not text:
            continue
        if STANCE_VERB_RE.match(text):
            violations.append((mid, text))
    return violations


def run_check(corrections_override=None) -> tuple[int, list[str]]:
    entries = lc.load_verified_entries()
    motions = lc.load_all_motions()
    corrections = (
        corrections_override
        if corrections_override is not None
        else lc.load_corrections()
    )
    lc.apply_corrections(entries, motions, corrections)

    violations = find_violations(entries)

    msgs = [
        f"Scanned {len(entries)} verified entries (post corrections.json merge).",
        f"whatAYeaDid rows opening with a stance verb ({', '.join(STANCE_VERBS)}): {len(violations)}",
    ]
    if violations:
        msgs.append("\nFAILED — stance-verb-prefixed whatAYeaDid rows found:")
        for mid, text in sorted(violations):
            msgs.append(f" - {mid}: {text}")
        return 1, msgs
    msgs.append("\nALL CHECKS PASSED")
    return 0, msgs


# Round-7 gate item A: negative-test one id per enumerated stance-verb,
# reverted in-memory (never touches corrections.json) to prove this check's
# own regex still bites all three, not just proven green against
# already-fixed data.
_SELF_TEST_REVERTS = {
    ("ed87fe805530", "whatAYeaDid"): "Supported final enactment of the by-law redividing the City of London's wards.",
    ("af8a22f08328", "whatAYeaDid"): "Endorsed London's Highly Supportive Housing Plan (Schedule 1) as the city's approach to its Health & Homelessness Whole of Community System Response.",
    # No real "Backed ..." row exists in the current corpus (the verb has
    # never been used) -- this negative-test entry proves the enumerated
    # regex itself still matches "Backed" even though nothing in the live
    # data currently needs it, by mutating a real row's text to that verb
    # rather than skipping the case.
    ("6d5fac41d698", "whatAYeaDid"): "Backed the finding that the 2nd Report of the Strategic Opportunities Review Working Group had already been considered by Council on July 23, 2024.",
}


def self_test() -> int:
    print("=== self-test: revert three known fixes to their stance-verb form, expect exit 1 ===")
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
        print("SELF-TEST FAILED: reverting to stance-verb text did not produce exit 1")
        return 1
    entries = lc.load_verified_entries()
    lc.apply_corrections(entries, lc.load_all_motions(), mutated)
    flagged_ids = {mid for mid, _ in find_violations(entries)}
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
