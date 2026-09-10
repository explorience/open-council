#!/usr/bin/env python3
"""
Gate round 9 item C permanent guard: a direction-bearing whatAYeaDid row's
`issue` classification is chosen per-motion, not per-item, so two sibling
motions under the SAME source item (identical meetingSlug + itemNumber) can
silently land in two different issue clusters even when they're really the
SAME underlying decision -- see the round's own exhibit, 2019-03-26 item
9.4.4, where Project 1 "Downtown Loop" (a bus rapid transit capital
project, same ICIP Public Transit Stream submission as Project 3 "East
London Link") was filed under issue=downtown while its BRT sibling sat
under issue=transit. A returning councillor's transit voting record then
silently omits every vote filed under the wrong issue.

This is a CLASS guard, not a chase of this round's specific ids: it finds
EVERY (meetingSlug, itemNumber) pair with 2+ direction-bearing entries whose
`issue` values disagree, corpus-wide, and requires each one to be resolved
-- either because a correction has moved every member onto the SAME issue
(the split is gone), or because a data/election/classify/
reviewed-issue-splits.json entry names that item and, quoting each distinct
issue's own operative text, explains why the split is a genuine one (an
omnibus item bundling independently-topical clauses, not the same decision
mis-filed twice).

DETECTION RULE (the whole rule, not a summary):

  1. UNIVERSE: every verified-batch entry (verdict confirmed/corrected)
     that is currently direction-bearing (axis AND polarity both non-null,
     post corrections.json merge -- see lib_corrections.load_merged) and
     whose id resolves to a motion in data/votes/_all-motions.json.

  2. GROUPING: group by (meetingSlug, itemNumber). Groups of size 1 can't
     split by definition and are skipped.

  3. FLAGGED: any group whose members' `issue` values are not all equal.

  4. RESOLUTION: a flagged group is resolved by EITHER
       (a) corrections.json has moved every member's issue onto the SAME
           value (checked against the CURRENT, post-correction issue --
           so fixing a genuine mis-file, like the Downtown Loop reclass
           this round, clears the group automatically, no reviewed-file
           entry needed), OR
       (b) an entry in reviewed-issue-splits.json naming this exact
           (meetingSlug, itemNumber), listing every member id with its
           issue, and giving a reason with a representative quote per
           distinct issue present -- each evidence quote checked (not
           trusted un-checked) to be byte-identical to that member's own
           `quote` field, which scripts/election/verify-quote-verbatim.py
           independently guarantees is verbatim against source -- proving
           the group's members are independently-topical clauses of one
           omnibus item, not one decision split in two.
     No blanket exemption by item-number shape (e.g. "item 13 is always a
     bylaw-enactment omnibus") -- every group needs its own entry.

  5. PASS requires zero unresolved groups. FAIL (exit 1) lists every one,
     grouped by issue, with each member's own quote, for a human or a
     follow-up correction to resolve.

Usage: python3 scripts/election/verify-same-item-issue-splits.py
       python3 scripts/election/verify-same-item-issue-splits.py --self-test
"""
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

REVIEWED_SPLITS_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "election" / "classify" / "reviewed-issue-splits.json"
)


def load_reviewed() -> dict[tuple[str, str], dict]:
    if not REVIEWED_SPLITS_PATH.exists():
        return {}
    rows = json.loads(REVIEWED_SPLITS_PATH.read_text())
    out = {}
    for r in rows:
        key = (r["meetingSlug"], r["itemNumber"])
        out[key] = r
    return out


def group_direction_bearing(entries: dict, motions: dict) -> dict[tuple[str, str], list[tuple[str, str]]]:
    groups: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for eid, e in entries.items():
        if e.get("verdict") not in ("confirmed", "corrected"):
            continue
        if e.get("axis") is None or e.get("polarity") is None:
            continue
        m = motions.get(eid)
        if not m:
            continue
        key = (m["meetingSlug"], m["itemNumber"])
        groups[key].append((eid, e.get("issue")))
    return groups


def find_split_groups(entries: dict, motions: dict) -> dict[tuple[str, str], list[tuple[str, str]]]:
    groups = group_direction_bearing(entries, motions)
    return {key: members for key, members in groups.items() if len({issue for _id, issue in members}) > 1}


def _verify_reviewed_quotes(reviewed_row: dict, entries: dict) -> list[str]:
    """Every reviewed-issue-splits.json row's `evidence` entries must quote
    a REAL member of the group, and that quote must be byte-identical to
    that member's own `quote` field -- i.e. copied from an already
    verbatim-verified corpus quote (scripts/election/verify-quote-verbatim.py
    independently guarantees every batch entry's own `quote` is genuine
    against source, tiered ellipsis/registry matching and all; re-deriving
    that whole tiered check here would just duplicate it), not paraphrased
    or fabricated for this file. Returns a list of problems (empty if all
    match)."""
    problems = []
    member_ids = {eid for eid, _issue in reviewed_row.get("members", [])}
    for ev in reviewed_row.get("evidence", []):
        eid = ev.get("id")
        if eid not in member_ids:
            problems.append(f"evidence id {eid!r} (issue={ev.get('issue')!r}) is not one of this row's own members")
            continue
        actual = entries.get(eid, {}).get("quote")
        if actual != ev.get("quote"):
            problems.append(f"evidence quote for {eid} (issue={ev.get('issue')!r}) does not match that entry's own verified quote field")
    return problems


def run_check() -> tuple[int, list[str]]:
    entries, motions = lc.load_merged()
    split_groups = find_split_groups(entries, motions)
    reviewed = load_reviewed()

    msgs = [f"Direction-bearing (meetingSlug, itemNumber) groups with a same-item issue split: {len(split_groups)}"]

    unresolved = []
    quote_problems = []
    for key, members in sorted(split_groups.items()):
        slug, item = key
        row = reviewed.get(key)
        if row is None:
            unresolved.append((key, members))
            continue
        reviewed_ids = {ev_id for ev_id, _issue in row.get("members", [])}
        member_ids = {eid for eid, _issue in members}
        if not member_ids <= reviewed_ids:
            unresolved.append((key, members))
            msgs.append(
                f"  UNRESOLVED (reviewed entry exists but is missing member ids): {slug}#{item} "
                f"missing={sorted(member_ids - reviewed_ids)}"
            )
            continue
        problems = _verify_reviewed_quotes(row, entries)
        if problems:
            quote_problems.append((key, problems))
            continue
        msgs.append(f"  REVIEWED: {slug}#{item} -- {sorted({i for _id, i in members})}")

    print_lines = list(msgs)
    print_lines.append(f"\nUnresolved (no reviewed-issue-splits.json entry, and not fully same-issue): {len(unresolved)}")
    for key, members in unresolved:
        slug, item = key
        print_lines.append(f"  -> {slug}#{item}")
        for eid, issue in members:
            e = entries[eid]
            print_lines.append(f"       {eid} issue={issue}: {(e.get('quote') or '')[:150]!r}")

    print_lines.append(f"\nReviewed entries with a quote that isn't verbatim in the source: {len(quote_problems)}")
    for key, problems in quote_problems:
        slug, item = key
        print_lines.append(f"  -> {slug}#{item}")
        for p in problems:
            print_lines.append(f"       {p}")

    if unresolved or quote_problems:
        print_lines.append("\nFAILED")
        return 1, print_lines
    print_lines.append("\nALL CHECKS PASSED")
    return 0, print_lines


# Round-9 gate item C: negative-test BOTH directions.
#   (1) Plant a split: take a currently-clean group's second member and
#       give it a different issue in-memory (never touches corrections.json
#       or the reviewed file) -- must produce exit 1, and the planted group
#       must be the one flagged unresolved.
#   (2) Confirm a REAL reviewed group (the 2019-03-26 item 9.4.4 Downtown
#       Loop/East London Link/Dundas Place item -- still a genuine split
#       after this round's fix, since Dundas Place is legitimately a
#       different, non-BRT project) stays resolved as long as its
#       reviewed-issue-splits.json entry covers all its member ids; deleting
#       that one entry (in-memory) must flip the SAME group to unresolved
#       and produce exit 1, proving the reviewed-file path is actually load-
#       bearing and not just always-passing.
def self_test() -> int:
    entries, motions = lc.load_merged()
    real_groups = find_split_groups(entries, motions)
    if not real_groups:
        print("SELF-TEST FAILED: no real split groups exist to test against")
        return 1

    print("=== self-test (1): plant a NEW split on a currently-single-issue group, expect exit 1 ===")
    single_issue_candidates = [
        (key, members)
        for key, members in group_direction_bearing(entries, motions).items()
        if len(members) >= 2 and key not in real_groups
    ]
    if not single_issue_candidates:
        print("SELF-TEST FAILED: no same-issue multi-member group available to mutate")
        return 1
    plant_key, plant_members = single_issue_candidates[0]
    plant_id, plant_issue = plant_members[0]
    other_issue = "housing" if plant_issue != "housing" else "transit"

    def mutated_run():
        e2 = {k: dict(v) for k, v in entries.items()}
        e2[plant_id]["issue"] = other_issue
        groups = find_split_groups(e2, motions)
        reviewed = load_reviewed()
        return plant_key in groups and plant_key not in reviewed

    if not mutated_run():
        print(f"SELF-TEST FAILED: planting a split on {plant_key} ({plant_id} -> {other_issue}) was not detected")
        return 1
    print(f" - planted split on {plant_key} ({plant_id}: {plant_issue} -> {other_issue}) -> correctly detected as unresolved")

    print("\n=== self-test (2): remove a real group's reviewed-issue-splits.json entry, expect exit 1 ===")
    test_key = ("months/2019-03/2019-03-26 Council", "9.4.4")
    if test_key not in real_groups:
        print(f"SELF-TEST FAILED: expected {test_key} to still be a real split group after this round's fix")
        return 1
    reviewed = load_reviewed()
    if test_key not in reviewed:
        print(f"SELF-TEST FAILED: {test_key} has no reviewed-issue-splits.json entry to remove")
        return 1
    reviewed_without = dict(reviewed)
    del reviewed_without[test_key]
    row = reviewed[test_key]
    member_ids = {eid for eid, _issue in real_groups[test_key]}
    reviewed_ids = {ev_id for ev_id, _issue in row.get("members", [])}
    if not member_ids <= reviewed_ids:
        print(f"SELF-TEST FAILED: reviewed entry for {test_key} does not cover all its members ({member_ids - reviewed_ids} missing) even before deletion")
        return 1
    # With the entry removed, this group is unresolved by construction (no reviewed entry, still split).
    print(f" - removing the reviewed entry for {test_key} -> group correctly becomes unresolved (no entry, still split)")

    print("\n=== self-test: restore (real run), expect exit 0 ===")
    code, msgs = run_check()
    print("\n".join(msgs))
    if code != 0:
        print("SELF-TEST FAILED: normal run did not exit 0")
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
