#!/usr/bin/env python3
"""
Round-9 gate item 1 sweep: proves the whole corpus's whatAYeaDid field obeys
the rule "whatAYeaDid always describes what a yea SUPPORTED/would have done,
never the outcome" -- for EVERY motion in data/election/issues.json (the
built, single-source-of-truth vote list; every motion in the divided
universe with a determined issue appears exactly once here, per this hub's
own methodology -- see scripts/election/methodology.ts), regardless of
whether that motion is direction-bearing on a tracked axis.

DETECTION RULE (the whole rule, not a summary):

  1. FAILED motions: the label must NOT begin with a verb that describes the
     vote's OUTCOME rather than what a yea supported -- "Rejected",
     "Declined", "Refused", "Denied", "Defeated", "Dismissed", "Blocked",
     "Voted down", "Turned down" (case-insensitive, anchored to the start of
     the label) -- and the label MUST carry the "would have" hedge
     somewhere, so it reads as the hypothetical it is. Both conditions are
     hard failures.

  2. PASSED motions (the symmetric check for reverse-shape errors): the
     label must NOT begin with the "Would have" hedge -- that phrasing is
     only correct for a motion that did NOT happen; a motion that passed
     happened, and describing it as hypothetical is the mirror-image defect.
     (A label beginning with an outcome verb like "Refused" is NOT flagged
     on a Passed motion: when the motion's own operative clause is itself to
     refuse/deny something, and that motion passed, "Refused the
     application" correctly describes what the yea supported -- this is not
     an inversion. See the module's own corpus check: as of this sweep's
     writing, zero Passed motions begin with the hedge, confirming this
     defect shape doesn't currently occur, but the check stays live.)

A label of "" or the literal "unclear" (the fallback used when a motion has
no verified whatAYeaDid text at all) is not prose and is skipped by both
checks.

Usage: python3 scripts/election/sweep-outcome-verb-inversion.py
"""
import json
import re
import sys

ISSUES_PATH = "data/election/issues.json"

OUTCOME_VERBS = [
    "Rejected",
    "Declined",
    "Refused",
    "Denied",
    "Defeated",
    "Dismissed",
    "Blocked",
    "Voted down",
    "Turned down",
]
OUTCOME_VERB_RE = re.compile(
    r"^(" + "|".join(re.escape(v) for v in OUTCOME_VERBS) + r")\b", re.IGNORECASE
)
HEDGE_RE = re.compile(r"^would have\b", re.IGNORECASE)


def main():
    data = json.load(open(ISSUES_PATH, encoding="utf-8"))

    failed_outcome_verb = []
    failed_no_hedge = []
    passed_reverse_hedge = []
    scanned = 0

    for issue_id, issue in data["issues"].items():
        for v in issue["votes"]:
            label = ((v.get("direction") or {}).get("label") or "").strip()
            if not label or label.lower() == "unclear":
                continue
            scanned += 1
            passed = v["passed"]
            row = (issue_id, v["id"], v["date"], v["itemTitle"], label, v["result"])

            if not passed:
                if OUTCOME_VERB_RE.match(label):
                    failed_outcome_verb.append(row)
                if "would have" not in label.lower():
                    failed_no_hedge.append(row)
            else:
                if HEDGE_RE.match(label):
                    passed_reverse_hedge.append(row)

    print(f"Scanned {scanned} whatAYeaDid labels across {len(data['issues'])} issues in {ISSUES_PATH}.")

    ok = True

    print(f"\nFAILED motions whose label begins with an outcome verb ({len(OUTCOME_VERBS)}-word list):")
    if failed_outcome_verb:
        ok = False
        print(f"  FAIL: {len(failed_outcome_verb)} row(s):")
        for issue_id, motion_id, date, title, label, result in failed_outcome_verb:
            print(f"    [{issue_id}] {motion_id} {date} {title!r} result={result!r}")
            print(f"      label={label!r}")
    else:
        print("  PASS: none.")

    print("\nFAILED motions whose label lacks the \"would have\" hedge:")
    if failed_no_hedge:
        ok = False
        print(f"  FAIL: {len(failed_no_hedge)} row(s):")
        for issue_id, motion_id, date, title, label, result in failed_no_hedge:
            print(f"    [{issue_id}] {motion_id} {date} {title!r} result={result!r}")
            print(f"      label={label!r}")
    else:
        print("  PASS: none.")

    print("\nPASSED motions whose label wrongly opens with the \"would have\" hedge (reverse-shape check):")
    if passed_reverse_hedge:
        ok = False
        print(f"  FAIL: {len(passed_reverse_hedge)} row(s):")
        for issue_id, motion_id, date, title, label, result in passed_reverse_hedge:
            print(f"    [{issue_id}] {motion_id} {date} {title!r} result={result!r}")
            print(f"      label={label!r}")
    else:
        print("  PASS: none.")

    print(f"\n{'=' * 60}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
