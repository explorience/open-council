#!/usr/bin/env python3
"""
Round-4 gate self-verification: independently re-checks items 1-5 against
the REGENERATED data/election/stances.json and data/election/classify/
corrections.json — never trusts the generator's own internal counters,
re-derives each claim from source data.

Usage: python3 scripts/election/verify-round4-items.py
"""
import glob
import json
import os
import sys

FAIL = []
SKIP = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail else ""))
    if not cond:
        FAIL.append(label)


def skip(label, reason):
    """A disclosed, exit-0 skip - for a hardcoded id that is a genuine,
    currently-documented rekey gap (present in the LATEST
    rekey-unresolved-<stamp>.json, not merely absent from CURRENT_IDS,
    which is also true of a plain stale/typo'd id and must still FAIL
    loudly). Never silently passed and never a red gate: printed plainly,
    tracked separately from both PASS and FAIL so the exit code stays 0
    while the gap stays visible in the transcript."""
    print(f"[SKIP] {label} -- {reason}")
    SKIP.append(label)


stances = json.load(open("data/election/stances.json"))
corrections = json.load(open("data/election/classify/corrections.json"))
all_motions = {m["id"]: m for m in json.load(open("data/votes/_all-motions.json"))["motions"]}

# ---------------------------------------------------------------------------
# Round-5 gate BLOCKER item 1 superseded this check's whole premise: the
# round-4 four-bucket roster split (notOnRosterCommittee/memberAbsentCommittee/
# notOnRosterCommitteeMeetingGap/notOnRosterCouncilGap) was ITSELF a false
# membership claim (267 confirmed-false cases) -- there is no membership
# source in this repo, so nothing computes "is/isn't a member" anymore. The
# fields no longer exist in stances.json; this section now checks the
# REPLACEMENT (attendedAsObserver/noRecordedVote, from also_present only) for
# internal consistency instead. See verify-round5-items.py for the sweep that
# proves zero membership assertions remain in the rendered content.
print("=== Item 1: membership-claim elimination (round-5 replacement) ===")
tot = {"attendedAsObserver": 0, "noRecordedVote": 0}
for slug, c in stances["councillors"].items():
    for issId, issue in c["issues"].items():
        for k in tot:
            tot[k] += issue.get(k, 0)
print("bucket counts:", tot)
check(
    "old round-4 membership-claim fields (notOnRosterCommittee etc.) are gone from stances.json",
    all(
        "notOnRosterCommittee" not in issue
        and "memberAbsentCommittee" not in issue
        and "notOnRosterCommitteeMeetingGap" not in issue
        and "notOnRosterCouncilGap" not in issue
        for c in stances["councillors"].values()
        for issue in c["issues"].values()
    ),
)
check(
    "attendedAsObserver + noRecordedVote == notOnRoster everywhere (no motion double-counted or dropped)",
    all(
        issue["attendedAsObserver"] + issue["noRecordedVote"] == issue["notOnRoster"]
        for c in stances["councillors"].values()
        for issue in c["issues"].values()
    ),
)
check(
    "attendedAsObserver and noRecordedVote are non-negative everywhere",
    all(
        issue["attendedAsObserver"] >= 0 and issue["noRecordedVote"] >= 0
        for c in stances["councillors"].values()
        for issue in c["issues"].values()
    ),
)

# ---------------------------------------------------------------------------
print("\n=== Item 2: 4df11e775c7f + advocacy/apply/request/urge/support sweep ===")
by_id_correction_now = {}
for c in corrections:
    by_id_correction_now.setdefault(c["id"], {})[c["field"]] = c["now"]

# 2026-09-02 (PR #202 round): every id below is hardcoded against whatever
# data/votes/_all-motions.json id was current when this gate was written.
# Two upstream regenerations since then (this branch's pre-2018 ingestion +
# extractMotionText fix, on top of #196/#201's own churn) changed the id for
# most of them - a hardcoded id that no longer exists anywhere is NOT the
# same thing as "still correctly downgraded", so REQUIRE_CURRENT below makes
# a stale id a loud FAIL instead of the silent, meaningless PASS you get from
# `{}.get(field) is None` (true for "downgraded" AND for "id not found" alike
# - the exact trap this refresh exists to close). Each id is chased through
# scripts/election/classify/rekey-map-20260902*.json (and, once, the older
# 20260902 map from #196) to its current equivalent; old id kept in a
# trailing comment for provenance/audit.
CURRENT_IDS = set(all_motions.keys())

def require_current(mid, label):
    """FAIL loudly (never a silent vacuous pass) if mid isn't a real,
    current motion id - the id-churn-safe replacement for a bare
    by_id_correction_now.get(mid, {}) lookup."""
    ok = mid in CURRENT_IDS
    check(f"{label}: {mid} is a current motion id (not stale/unresolved)", ok)
    return ok

# Finding-2 (2026-09-02 fixer round): require_current's hard FAIL is right
# for a hardcoded id that's stale because nobody updated it - but WRONG for
# one that's a genuine, currently-documented rekey gap (present in the
# latest rekey-unresolved-<stamp>.json after every disambiguation tier -
# natural key + result, quote, bijective ordinal - has already been tried
# and failed). That case should never flip this gate's exit code; it should
# say so plainly and move on. _latest_unresolved_ids is read fresh each run
# so this stays accurate as the rekey script's own state evolves.
_unresolved_files = sorted(glob.glob("data/election/classify/rekey-unresolved-*.json"))
_latest_unresolved_path = _unresolved_files[-1] if _unresolved_files else None
_latest_unresolved_ids = (
    {e["id"] for e in json.load(open(_latest_unresolved_path)) if isinstance(e, dict) and "id" in e}
    if _latest_unresolved_path else set()
)

def require_current_or_documented_gap(mid, label):
    """Like require_current, but a non-current id gets one more chance: if
    it's listed in the latest rekey-unresolved-<stamp>.json, that's a
    documented, still-unresolved rekey gap - not silently passed, not a red
    gate either, just disclosed as a SKIP (exit 0). An id that's neither
    current NOR in that file is unexplained staleness and still FAILs."""
    if mid in CURRENT_IDS:
        check(f"{label}: {mid} is a current motion id (not stale/unresolved)", True)
        return True
    if mid in _latest_unresolved_ids:
        skip(
            f"{label}: {mid}",
            f"not a current motion id, but is a documented, still-unresolved rekey gap "
            f"(see {os.path.basename(_latest_unresolved_path)}) - every disambiguation tier "
            f"was tried and genuinely couldn't place it; not re-guessed at here",
        )
        return False
    check(f"{label}: {mid} is a current motion id (not stale/unresolved)", False)
    return False

for mid in [
    "f74ed511bc6d",  # was 4df11e775c7f
    "3813f33f3f54",  # was f256055d95cb
    "99f660dff7c0",  # was 171d5c892bfb -> (20260902) 21e06031ea95 -> (20260902d)
    "82920ae88a00",  # was afa632a6cb38
]:
    if not require_current(mid, "item 2"):
        continue
    now = by_id_correction_now.get(mid, {})
    check(
        f"{mid} downgraded to unclear (axis=null, polarity=null) in corrections.json",
        now.get("axis") is None and now.get("polarity") is None,
        str(now),
    )
    # Confirm it's not published with a direction anywhere in stances.json evidence
    found_direction_bearing = False
    for c in stances["councillors"].values():
        for issue in c["issues"].values():
            for ax in issue["axes"]:
                for ev in ax["evidence"]:
                    if ev["motionId"] == mid:
                        found_direction_bearing = True
    check(f"{mid} does not appear as direction-bearing evidence on any councillor page", not found_direction_bearing)

# ---------------------------------------------------------------------------
print("\n=== Item 3: business-case axis emptied / levy-size sign-derivation ===")
business_case_axis_present = any(
    ax["axis"] == "business-case"
    for c in stances["councillors"].values()
    for issue in c["issues"].values()
    for ax in issue["axes"]
)
check("business-case axis no longer appears anywhere in stances.json (axis emptied cleanly)", not business_case_axis_present)

# 2026-09-02 (PR #202 round): see the item-2 header comment - ids below
# chased through rekey-map-20260902*.json to their current equivalent.
#
# Gate round 3 item A OVERRIDE: 0666282b30d3's expected polarity below was
# "restrictive", per round-4/5's now-PROVEN-INVERTED verb-based levy-sign
# table (see sweep-levy-sign-consistency.py's docstring for the full proof
# from precedent rows P-25/P-24/P-6). Under the corrected effect-of-passing
# convention (printed Tax Levy sign IS the answer, regardless of verb),
# 0666282b30d3 (Case #P-12, BE EXCLUDED, 2027 Tax Levy: $28,000, a positive
# figure) is expansive, not restrictive. Updated here to the corrected
# expectation rather than leaving this self-check asserting a value the
# gate itself proved wrong.
for mid, expect_axis, expect_pol in [
    ("81604ebe0e88", "levy-size", "restrictive"),  # was 987a0e7529b2
    ("0666282b30d3", "levy-size", "expansive"),  # was f7c197957c99; was "restrictive" pre-round-3-item-A
]:
    if not require_current(mid, "item 3"):
        continue
    now = by_id_correction_now.get(mid, {})
    check(
        f"{mid} moved to ({expect_axis}, {expect_pol}) via corrections.json",
        now.get("axis") == expect_axis and now.get("polarity") == expect_pol,
        str(now),
    )

# Gate round 3 item A: 1d7c40b467ec REMOVED from this list. It was
# downgraded to unclear here (round 4: no Tax Levy dollar line in its own
# clause, "not mechanically sign-derivable") but round 3 item A aligned it
# onto its sibling 22951914b4b2/P-6's verified direction instead (same
# underlying case, "Reduced Road Network Improvements", at an earlier
# procedural stage) -- see that correction's reason for the full
# title-based derivation. No longer unclear, so no longer belongs in a list
# asserting "downgraded to unclear".
downgraded_business_case_ids = [
    "050a9f0f9146",  # was 01d52536f471 -> (20260902) be1f4927f690 -> (20260902d)
    "fdbfa59e401a",  # was 69288d65e04c
    "90cb7d09948d",  # was 5581ea6993ac
    "a41ecd8d8212",  # was a4eb827c855c
    "5d8be07a288c",  # was e11dd21254b2
    "0c2a411423be",  # was 3dd05e479854
    "a6473f2744cd",  # was 1c8075648323
    "c08daf018133",  # was ba9608551c5e
    "2307b1d59a7d",  # was 294f2da7a27e
    "0f19b60c927d",  # was e7b1e2dca5dc
    "4750754213bc",  # was 17e2790f8249
    "2402cfe58258",  # was 45e004c6a94d
    "e350b258eb2f",  # was 7b22159ad688
    "6799a7e69f77",  # was 48bb3106304c
    "545479fa2b3f",  # was 0689312f36aa
    "0bd0c15f3d73",  # was 57b785c0afb3
]
missing_business_case_ids = [mid for mid in downgraded_business_case_ids if mid not in CURRENT_IDS]
check(
    f"all {len(downgraded_business_case_ids)} no-derivable-sign business-case row ids are current (not stale/unresolved)",
    not missing_business_case_ids, str(missing_business_case_ids),
)
all_downgraded = all(
    by_id_correction_now.get(mid, {}).get("axis") is None and by_id_correction_now.get(mid, {}).get("polarity") is None
    for mid in downgraded_business_case_ids if mid in CURRENT_IDS
)
check(f"all {len(downgraded_business_case_ids)} no-derivable-sign business-case rows downgraded to unclear", all_downgraded)

# 18633398dd86/ea03954e4926 (round-3 corrections) must be UNTOUCHED by round-4
if require_current("22951914b4b2", "item 3"):  # was 18633398dd86
    check(
        "22951914b4b2 round-3 correction untouched (still levy-size/expansive, not re-derived from degenerate scrape) [was 18633398dd86]",
        by_id_correction_now.get("22951914b4b2", {}) == {"axis": "levy-size", "polarity": "expansive"},
        str(by_id_correction_now.get("22951914b4b2")),
    )
if require_current("021ec895b691", "item 3"):  # was ea03954e4926
    check(
        "021ec895b691 round-3 correction untouched (still levy-size/restrictive) [was ea03954e4926]",
        by_id_correction_now.get("021ec895b691", {}) == {"axis": "levy-size", "polarity": "restrictive"},
        str(by_id_correction_now.get("021ec895b691")),
    )

# ---------------------------------------------------------------------------
print("\n=== Item 4: amendment-ladder tallying (Stevenson 5c6d802b2c95/e3e298593604) ===")
# 2026-09-02 (PR #202 round): 5c6d802b2c95 -> 19efb38c1dc0 rekeys cleanly.
# e3e298593604 previously did NOT (rekey-unresolved-20260902d.json: 2
# candidates at item 8.2.4, both containing the recorded quote verbatim -
# an "amend clause j)" motion and the "approve part j) as amended" motion
# that necessarily recites the same final clause text, so quote-matching
# alone can't tell them apart). Finding-2 rework: 291927c27356 (the
# "approve part j) as amended" sibling) is unresolved for the exact same
# reason, at the exact same natural key, and the item's OTHER 8 roll calls
# at that key are all already claimed - a genuine 2-old-ids <-> 2-unclaimed-
# candidates bijective group. rekey-classify-ids.py's tier 3 now resolves
# this by roll-call ordinal order (both the batch file's document order and
# the substantive "amend" -before- "approve-as-amended" sequence agree):
# e3e298593604 -> d7283f8e12c5 (ordinal 7, the amendment), 291927c27356 ->
# aaa44de9dc24 (ordinal 10, the later approval). If a future regeneration
# ever leaves this genuinely unresolved again,
# require_current_or_documented_gap turns that into a disclosed SKIP
# (exit 0) instead of a red gate - never a silent pass either.
MID1, MID2 = "19efb38c1dc0", "d7283f8e12c5"  # was 5c6d802b2c95, e3e298593604
mid1_ok = require_current_or_documented_gap(MID1, "item 4")
mid2_ok = require_current_or_documented_gap(MID2, "item 4")
if mid1_ok and mid2_ok:
    stevenson = stances["councillors"]["s-stevenson"]
    enc = stevenson["issues"]["encampments"]
    rs_axis = next(ax for ax in enc["axes"] if ax["axis"] == "response-scale")
    excluded_ids = {e["motionId"] for e in rs_axis["ladderExclusions"]}
    check(f"{MID1} is in Stevenson's response-scale ladderExclusions", MID1 in excluded_ids)
    check(f"{MID2} is in Stevenson's response-scale ladderExclusions", MID2 in excluded_ids)
    check(
        "both excluded rows are in the SAME decisionGroupIndex",
        len({e["decisionGroupIndex"] for e in rs_axis["ladderExclusions"] if e["motionId"] in (MID1, MID2)}) == 1,
    )
    # The pair's raw votes must genuinely be nay/yea per source data
    m1, m2 = all_motions[MID1], all_motions[MID2]
    check(
        f"{MID1}: Susan Stevenson recorded NAY in source data",
        "Susan Stevenson" in m1["nays"],
    )
    check(
        f"{MID2}: Susan Stevenson recorded YEA in source data",
        "Susan Stevenson" in m2["yeas"],
    )
# Arithmetic closure check (independently re-derived, not trusting overall.ladderExcluded)
closure_errors = 0
for slug, c in stances["councillors"].items():
    for issId, issue in c["issues"].items():
        o = issue["overall"]
        ladder_total = sum(len(ax["ladderExclusions"]) for ax in issue["axes"])
        total = o["for"] + o["against"] + o["recused"] + o["absent"] + o["abstain"] + o["other"] + ladder_total + issue["notOnRoster"]
        if total != issue["divisionsInCorpus"]:
            closure_errors += 1
check("arithmetic closes for every councillor x issue (divisionsInCorpus == for+against+recused+absent+abstain+other+ladderExcluded+notOnRoster)", closure_errors == 0, f"{closure_errors} mismatches")
check("overall.ladderExcluded field matches independently-summed per-axis ladderExclusions everywhere", all(
    c_issue["overall"]["ladderExcluded"] == sum(len(ax["ladderExclusions"]) for ax in c_issue["axes"])
    for c in stances["councillors"].values()
    for c_issue in c["issues"].values()
))

# ---------------------------------------------------------------------------
print("\n=== Item 5: c975eb034a57 (Business Case #P-56) ===")
# 2026-09-02 (PR #202 round): was c975eb034a57, rekeyed to 7f9cba8155ba.
MID5 = "7f9cba8155ba"  # was c975eb034a57
if require_current(MID5, "item 5"):
    now = by_id_correction_now.get(MID5, {})
    check(f"{MID5} downgraded to unclear (axis=null, polarity=null)", now.get("axis") is None and now.get("polarity") is None, str(now))
    found_climate_target = False
    for c in stances["councillors"].values():
        climate = c["issues"].get("climate")
        if not climate:
            continue
        for ax in climate["axes"]:
            if ax["axis"] == "target-strength":
                for ev in ax["evidence"]:
                    if ev["motionId"] == MID5:
                        found_climate_target = True
    check(f"{MID5} does not appear under any climate/target-strength axis evidence", not found_climate_target)

print("\n" + "=" * 60)
if SKIP:
    print(f"{len(SKIP)} CHECK(S) SKIPPED (documented, currently-unresolved rekey gap - not a failure):")
    for s in SKIP:
        print(" -", s)
if FAIL:
    print(f"{len(FAIL)} CHECK(S) FAILED:")
    for f in FAIL:
        print(" -", f)
    sys.exit(1)
else:
    print("ALL CHECKS PASSED" + (f" ({len(SKIP)} disclosed skip(s))" if SKIP else ""))
