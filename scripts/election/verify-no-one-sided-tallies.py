#!/usr/bin/env python3
"""
Round-10 gate item 2 verification: proves data/election/stances.json
publishes ZERO evidence rows whose underlying motion has a one-sided
tally -- yeas empty, or nays empty.

BACKGROUND: motion 192cc16c866a (2023-01-26, "8th Meeting of the Strategic
Priorities and Policy Committee - BUDGET", item 4.3, result "Motion Failed
(0 to 14)", yeas=[], nays=[14 names]) was published as a "divided" vote on
14 councillor profiles, inside "divided votes" pattern sentences, even
though it has literally zero yeas -- because generate-stances.ts's old
isNotDivided guard only excluded a motion when the classify pipeline's
manual verification pass happened to have set a "not_divided" flag on it by
hand, and nobody had set one on this motion. Fixed by generalizing that
guard (see isOneSidedTally in generate-stances.ts): a motion is now
excluded from the divided-vote universe, unconditionally, whenever its OWN
yeas or nays array is empty -- derived from the vote arrays every run,
never a flag a person has to remember to set on this specific motion. This
script is the permanent, structural proof that the generalized guard is
doing its job: it doesn't know which motion ids were ever a problem, it
just parses every published evidence row's own "tally" field and demands
both sides be non-zero.

WHAT COUNTS AS "PUBLISHED": every axis's evidence[] row and every issue's
unclearEvidence[] row, for every issue, for every councillor, in
data/election/stances.json -- i.e. every row that can appear in an evidence
table on a councillor profile page, regardless of whether that specific
row's own theirVote is a yea/nay or a recusal/absence/other. A row's
"tally" field is the underlying MOTION's own recorded tally (same value on
every row that motion produced, regardless of which councillor cast which
position), stored as the literal string "{yeas}-{nays}" (see evidenceEntry
in generate-stances.ts) -- parsed back into two integers here and checked
directly, not re-derived from _all-motions.json a second time.

Also checks the same shape on data/election/issues.json's per-issue votes[]
array (renderIssueVoteRow's source) as a second, independent walk over the
same underlying divided-vote universe -- belt and suspenders, since both
files are built from the same generate-stances.ts `divided` list and a
defect here would mean the guard fix didn't reach one of the two writers.

Usage: python3 scripts/election/verify-no-one-sided-tallies.py
"""
import json
import re
import sys

STANCES_PATH = "data/election/stances.json"
ISSUES_PATH = "data/election/issues.json"

TALLY_STRING_RE = re.compile(r"^(\d+)-(\d+)$")


def check_stances_evidence_rows(stances: dict) -> list[str]:
    """Walk every axis evidence[] row and every issue unclearEvidence[] row
    for every councillor x issue. Returns a list of failure descriptions."""
    fails = []
    rows_checked = 0
    for councillor_slug, c in stances["councillors"].items():
        for issue_slug, issue in c["issues"].items():
            row_groups = [("unclearEvidence", issue.get("unclearEvidence", []))]
            for axis in issue.get("axes", []):
                row_groups.append((f"axis:{axis['axis']}", axis.get("evidence", [])))
            for source, rows in row_groups:
                for row in rows:
                    m = TALLY_STRING_RE.match(row.get("tally", ""))
                    if not m:
                        fails.append(
                            f"{councillor_slug}/{issue_slug}/{source}: motion "
                            f"{row.get('motionId')} has unparseable tally "
                            f"{row.get('tally')!r}"
                        )
                        continue
                    yea, nay = int(m.group(1)), int(m.group(2))
                    rows_checked += 1
                    if yea == 0 or nay == 0:
                        fails.append(
                            f"{councillor_slug}/{issue_slug}/{source}: motion "
                            f"{row.get('motionId')} ({row.get('date')}, "
                            f"{row.get('itemTitle')!r}) has a one-sided tally "
                            f"{yea}-{nay} -- should have been excluded by "
                            f"isOneSidedTally/isNotDivided, not published as "
                            f"evidence"
                        )
    print(f"Checked {rows_checked} stances.json evidence row(s) across every councillor x issue.")
    return fails


def check_issues_votes(issues: dict) -> list[str]:
    """Walk every issue's votes[] array (the independent second writer over
    the same divided-vote universe). Returns a list of failure descriptions."""
    fails = []
    votes_checked = 0
    for issue_slug, entry in issues["issues"].items():
        for v in entry.get("votes", []):
            tally = v.get("tally", {})
            yea = tally.get("yea")
            nay = tally.get("nay")
            if yea is None or nay is None:
                fails.append(
                    f"issues.json/{issue_slug}: motion {v.get('id')} has no "
                    f"usable tally object {tally!r}"
                )
                continue
            votes_checked += 1
            if yea == 0 or nay == 0:
                fails.append(
                    f"issues.json/{issue_slug}: motion {v.get('id')} "
                    f"({v.get('date')}, {v.get('itemTitle')!r}) has a "
                    f"one-sided tally {yea}-{nay} -- should have been "
                    f"excluded by isOneSidedTally/isNotDivided"
                )
    print(f"Checked {votes_checked} issues.json vote row(s) across every issue.")
    return fails


def main():
    stances = json.load(open(STANCES_PATH, encoding="utf-8"))
    issues = json.load(open(ISSUES_PATH, encoding="utf-8"))

    fails = check_stances_evidence_rows(stances) + check_issues_votes(issues)

    if fails:
        print(f"\nFAIL: {len(fails)} one-sided-tally row(s) still published:")
        for f in fails:
            print(f"  {f}")
        sys.exit(1)

    print(
        "PASS: zero one-sided-tally motions published as evidence, across "
        "every councillor x issue in stances.json and every vote row in "
        "issues.json."
    )


if __name__ == "__main__":
    main()
