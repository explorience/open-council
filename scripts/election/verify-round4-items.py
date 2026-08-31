#!/usr/bin/env python3
"""
Round-4 gate self-verification: independently re-checks items 1-5 against
the REGENERATED data/election/stances.json and data/election/classify/
corrections.json — never trusts the generator's own internal counters,
re-derives each claim from source data.

Usage: python3 scripts/election/verify-round4-items.py
"""
import json
import sys

FAIL = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}" + (f" -- {detail}" if detail else ""))
    if not cond:
        FAIL.append(label)


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

for mid in ["4df11e775c7f", "f256055d95cb", "171d5c892bfb", "afa632a6cb38"]:
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

for mid, expect_axis, expect_pol in [("987a0e7529b2", "levy-size", "restrictive"), ("f7c197957c99", "levy-size", "restrictive")]:
    now = by_id_correction_now.get(mid, {})
    check(
        f"{mid} moved to ({expect_axis}, {expect_pol}) via corrections.json",
        now.get("axis") == expect_axis and now.get("polarity") == expect_pol,
        str(now),
    )

downgraded_business_case_ids = [
    "01d52536f471", "69288d65e04c", "5581ea6993ac", "a4eb827c855c",
    "e11dd21254b2", "d167a282544f", "3dd05e479854", "1c8075648323",
    "ba9608551c5e", "294f2da7a27e", "e7b1e2dca5dc", "17e2790f8249",
    "45e004c6a94d", "7b22159ad688", "48bb3106304c", "0689312f36aa",
    "57b785c0afb3",
]
all_downgraded = all(
    by_id_correction_now.get(mid, {}).get("axis") is None and by_id_correction_now.get(mid, {}).get("polarity") is None
    for mid in downgraded_business_case_ids
)
check(f"all {len(downgraded_business_case_ids)} no-derivable-sign business-case rows downgraded to unclear", all_downgraded)

# 18633398dd86/ea03954e4926 (round-3 corrections) must be UNTOUCHED by round-4
check(
    "18633398dd86 round-3 correction untouched (still levy-size/expansive, not re-derived from degenerate scrape)",
    by_id_correction_now.get("18633398dd86", {}) == {"axis": "levy-size", "polarity": "expansive"},
    str(by_id_correction_now.get("18633398dd86")),
)
check(
    "ea03954e4926 round-3 correction untouched (still levy-size/restrictive)",
    by_id_correction_now.get("ea03954e4926", {}) == {"axis": "levy-size", "polarity": "restrictive"},
    str(by_id_correction_now.get("ea03954e4926")),
)

# ---------------------------------------------------------------------------
print("\n=== Item 4: amendment-ladder tallying (Stevenson 5c6d802b2c95/e3e298593604) ===")
stevenson = stances["councillors"]["s-stevenson"]
enc = stevenson["issues"]["encampments"]
rs_axis = next(ax for ax in enc["axes"] if ax["axis"] == "response-scale")
excluded_ids = {e["motionId"] for e in rs_axis["ladderExclusions"]}
check("5c6d802b2c95 is in Stevenson's response-scale ladderExclusions", "5c6d802b2c95" in excluded_ids)
check("e3e298593604 is in Stevenson's response-scale ladderExclusions", "e3e298593604" in excluded_ids)
check(
    "both excluded rows are in the SAME decisionGroupIndex",
    len({e["decisionGroupIndex"] for e in rs_axis["ladderExclusions"] if e["motionId"] in ("5c6d802b2c95", "e3e298593604")}) == 1,
)
# The pair's raw votes must genuinely be nay/yea per source data
m1, m2 = all_motions["5c6d802b2c95"], all_motions["e3e298593604"]
check(
    "5c6d802b2c95: Susan Stevenson recorded NAY in source data",
    "Susan Stevenson" in m1["nays"],
)
check(
    "e3e298593604: Susan Stevenson recorded YEA in source data",
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
now = by_id_correction_now.get("c975eb034a57", {})
check("c975eb034a57 downgraded to unclear (axis=null, polarity=null)", now.get("axis") is None and now.get("polarity") is None, str(now))
found_climate_target = False
for c in stances["councillors"].values():
    climate = c["issues"].get("climate")
    if not climate:
        continue
    for ax in climate["axes"]:
        if ax["axis"] == "target-strength":
            for ev in ax["evidence"]:
                if ev["motionId"] == "c975eb034a57":
                    found_climate_target = True
check("c975eb034a57 does not appear under any climate/target-strength axis evidence", not found_climate_target)

print("\n" + "=" * 60)
if FAIL:
    print(f"{len(FAIL)} CHECK(S) FAILED:")
    for f in FAIL:
        print(" -", f)
    sys.exit(1)
else:
    print("ALL CHECKS PASSED")
