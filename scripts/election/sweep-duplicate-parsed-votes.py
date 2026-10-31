#!/usr/bin/env python3
"""
Fixer round 1 (gate finding, 2014-2018 tranche): PERMANENT SWEEP for the
DUPLICATE-PARSED-VOTE defect class -- the SAME underlying roll call
extracted more than once into data/votes/_all-motions.json as separate
ids, each independently classified and each still axis-bearing, so a
single councillor's single vote gets counted multiple times toward their
published tally. The seed instance is 2015-01-29 Strategic Priorities and
Policy Committee item 2, roll-call ordinals 37/39/40 (2ce9b0c30e4f,
8472d08a14e3, 5d09f101f7c3): identical item, identical 4-9 FAILED tally,
identical verified `quote` ("Motion to approve the Financial Management
Budget in the amount of $94,736,000.") and identical whatAYeaDid, all
three still carrying axis=levy-size/polarity=expansive -- so Josh Morgan's
yea and Anna Hopkins's nay on this ONE actual vote were each counted THREE
times in any tally/aggregate. Corpus-wide enumeration (see DETECTION
below) finds 8 such clusters total; 6 of the other 7 are ALREADY correctly
resolved (every member's axis/polarity nulled) -- that is the corpus's own
established convention for this class, not a one-off judgment call. This
sweep makes that convention a permanent, scripted guard instead of
something only ever checked by hand.

DETECTION RULE (the whole rule, not a summary):

  1. UNIVERSE: every id in data/votes/_all-motions.json with a verified
     entry (lib_corrections.load_merged, POST-corrections.json), corpus-wide
     (all eras -- a duplicate-parse artifact is a pipeline/extraction
     defect, not an era-specific judgment call, so detection is not
     era-scoped; see RESOLUTION SCOPE below for what IS era-scoped).

  2. IDENTITY: group by (meetingSlug, itemNumber, passed, frozenset(yeas),
     frozenset(nays), quote, whatAYeaDid) -- same item, same tally, same
     roster, AND both the verified entry's own `quote` AND `whatAYeaDid`
     byte-identical. Requiring whatAYeaDid too (not just quote+tally) is
     what separates this from a legitimate same-item, same-roster reading
     sequence (first/second/third reading of one by-law very often shares
     both tally AND the recovered substantive `quote`, since the quote is
     the underlying by-law's own description reused per stage -- but each
     stage's whatAYeaDid differs, "Gave first reading..." vs "Gave second
     reading..." vs "Gave third reading and enacted..."). A genuine
     duplicate parse has IDENTICAL whatAYeaDid across every member, because
     it is the same event described the same way each time it was
     (wrongly) extracted. MIN_QUOTE_LEN excludes short/boilerplate quotes
     that could coincidentally recur across unrelated items.

  3. FLAGGED: any cluster (size >= 2) where MORE THAN ONE member's axis
     (post-corrections.json) is non-null -- i.e. the same vote is still
     counted more than once.

  4. RESOLUTION: a flagged cluster is resolved when corrections.json has
     brought it down to AT MOST ONE non-null-axis member (matching the
     corpus's own established convention seen in 6 of the 7 already-correct
     clusters, which null EVERY member rather than arbitrarily picking one
     duplicate as canonical), OR the cluster is named in
     reviewed-duplicate-votes.json with a reason grounded in the motions'
     own text for why the apparent duplicates are not actually a parse
     artifact.

RESOLUTION SCOPE (this branch, 2014-2018 tranche, batches 66-95): detection
stays corpus-wide (every cluster is found and printed), but RESOLUTION is
required only for a cluster where at least one member is in this branch's
own era batches (ERA_BATCH_RANGE, same convention as
sweep-substitution-vs-final.py / sweep-levy-thousands-rounding.py /
verify-cross-stage-consistency.py). A cluster entirely outside this
branch's own batches is printed as OUT-OF-SCOPE, not silently dropped, so
the owning era's own gate round still sees it -- this branch's own task
explicitly forbids changing any pre-2023 rendered row, and a 2018-2022 or
2023+ cluster this guard's corpus-wide detection surfaces is not this
branch's to correct.

Usage: python3 scripts/election/sweep-duplicate-parsed-votes.py
       python3 scripts/election/sweep-duplicate-parsed-votes.py --self-test
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
CLASSIFY_DIR = REPO_ROOT / "data" / "election" / "classify"
REVIEWED_PATH = CLASSIFY_DIR / "reviewed-duplicate-votes.json"

ERA_BATCH_RANGE = range(66, 96)  # batches 66-95, the 2014-2018 term -- this branch's remit

MIN_QUOTE_LEN = 40


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
    out = {}
    for r in json.loads(REVIEWED_PATH.read_text()):
        out[frozenset(r["ids"])] = r
    return out


def find_clusters(entries: dict, motions: dict) -> list[list[str]]:
    groups: dict[tuple, list[str]] = defaultdict(list)
    for eid, m in motions.items():
        e = entries.get(eid)
        if e is None:
            continue
        quote = (e.get("quote") or "").strip()
        wayd = (e.get("whatAYeaDid") or "").strip()
        if len(quote) < MIN_QUOTE_LEN or not wayd:
            continue
        key = (
            m["meetingSlug"],
            m["itemNumber"],
            m.get("passed"),
            frozenset(m.get("yeas") or []),
            frozenset(m.get("nays") or []),
            quote,
            wayd,
        )
        groups[key].append(eid)
    return [ids for ids in groups.values() if len(ids) >= 2]


def run_sweep(entries: dict, motions: dict) -> tuple[int, list[str]]:
    clusters = find_clusters(entries, motions)
    reviewed = load_reviewed()
    era_ids = load_era_ids()

    msgs = [f"Duplicate-parsed-vote clusters found corpus-wide (identical item/tally/quote/whatAYeaDid): {len(clusters)}"]

    flagged = []
    for ids in clusters:
        bearing = [i for i in ids if entries[i].get("axis") is not None]
        if len(bearing) > 1:
            flagged.append((ids, bearing))

    msgs.append(f"Flagged (more than one member still axis-bearing, i.e. double/triple-counted): {len(flagged)}")

    unresolved = []
    out_of_scope = []
    for ids, bearing in flagged:
        key = frozenset(ids)
        if key in reviewed:
            msgs.append(f"  REVIEWED (genuine, not a parse artifact): {sorted(ids)} -- {reviewed[key].get('reason', '')[:100]}")
            continue
        if any(i in era_ids for i in ids):
            unresolved.append((ids, bearing))
        else:
            out_of_scope.append((ids, bearing))

    msgs.append(f"\nUnresolved, this branch's era (batches 66-95): {len(unresolved)}")
    for ids, bearing in unresolved:
        m0 = motions[ids[0]]
        msgs.append(f"  -> {sorted(ids)}  {m0['meetingSlug']}#{m0['itemNumber']}  {len(bearing)} still axis-bearing: {sorted(bearing)}")
        msgs.append(f"     quote: {(entries[ids[0]].get('quote') or '')[:150]!r}")
        msgs.append(f"     whatAYeaDid: {(entries[ids[0]].get('whatAYeaDid') or '')[:150]!r}")

    msgs.append(
        f"\nOUT-OF-SCOPE (no member in this branch's era batches 66-95 -- "
        f"that era's own gate's business, not this branch's): {len(out_of_scope)}"
    )
    for ids, bearing in out_of_scope:
        m0 = motions[ids[0]]
        msgs.append(f"  -> {sorted(ids)}  {m0['meetingSlug']}#{m0['itemNumber']} ({m0['date']})  {len(bearing)} still axis-bearing: {sorted(bearing)}")

    if unresolved:
        msgs.append("\nFAILED")
        return 1, msgs
    msgs.append("\nPASS")
    return 0, msgs


# Negative test, both directions: revert this round's own fix (the
# 2ce9b0c30e4f/8472d08a14e3/5d09f101f7c3 cluster, batch 67, this branch's
# own era) to its pre-fix state (all three axis-bearing) in-memory and
# confirm the sweep catches it; restore and confirm pass. A second
# direction confirms the era-scoping boundary itself: an out-of-era cluster
# (32b3a392fe5e/cf6233c1dc64, 2025-04-22, both still axis-bearing in the
# REAL data -- an out-of-scope live instance of this class, left for that
# era's own gate) must be DETECTED and FLAGGED but not fail this branch's
# guard.
_SELF_TEST_CLUSTER = ["2ce9b0c30e4f", "8472d08a14e3", "5d09f101f7c3"]
_OUT_OF_ERA_CLUSTER = ["32b3a392fe5e", "cf6233c1dc64"]


def self_test() -> int:
    entries, motions = lc.load_merged()

    print("=== self-test (1): revert this branch's own fix (2015-01-29 SPPC cluster) in-memory, expect exit 1 ===")
    for i in _SELF_TEST_CLUSTER:
        if i not in entries:
            print(f"SELF-TEST FAILED: {i} missing from the merged corpus")
            return 1
        if entries[i].get("axis") is not None:
            print(f"SELF-TEST FAILED: {i} already axis-bearing in the real corpus -- proves nothing")
            return 1
    reverted = {k: dict(v) for k, v in entries.items()}
    for i in _SELF_TEST_CLUSTER:
        reverted[i]["axis"] = "levy-size"
        reverted[i]["polarity"] = "expansive"
    code, msgs = run_sweep(reverted, motions)
    joined = "\n".join(msgs)
    if code != 1:
        print(joined)
        print("SELF-TEST FAILED: reverting the SPPC cluster did not fail the guard")
        return 1
    if not all(i in joined for i in _SELF_TEST_CLUSTER):
        print(joined)
        print("SELF-TEST FAILED: guard failed, but not on the expected SPPC cluster")
        return 1
    print(" - reverted cluster correctly detected as unresolved (exit 1)")

    print("\n=== self-test (2): out-of-era live cluster must be FLAGGED but not fail this branch's guard, expect exit 0 ===")
    for i in _OUT_OF_ERA_CLUSTER:
        if i not in entries or entries[i].get("axis") is None:
            print(f"SELF-TEST FAILED: {i} missing or not axis-bearing in the real corpus -- proves nothing")
            return 1
    code2, msgs2 = run_sweep(entries, motions)
    joined2 = "\n".join(msgs2)
    if code2 != 0:
        print(joined2)
        print("SELF-TEST FAILED: normal run on the real corpus did not exit 0")
        return 1
    if not all(i in joined2 for i in _OUT_OF_ERA_CLUSTER) or "OUT-OF-SCOPE" not in joined2:
        print(joined2)
        print("SELF-TEST FAILED: out-of-era cluster not detected/reported under OUT-OF-SCOPE")
        return 1
    print(" - out-of-era cluster detected but correctly out-of-scope (exit 0)")

    print("\n=== self-test (3): restore (real, corrected data), expect exit 0 ===")
    code3, msgs3 = run_sweep(entries, motions)
    print("\n".join(msgs3))
    if code3 != 0:
        print("SELF-TEST FAILED: normal run on the real corrected corpus did not exit 0")
        return 1
    print("\nSELF-TEST PASSED")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    entries, motions = lc.load_merged()
    code, msgs = run_sweep(entries, motions)
    print("\n".join(msgs))
    return code


if __name__ == "__main__":
    sys.exit(main())
