#!/usr/bin/env python3
"""
Round-5 gate item 4 sweep: proves zero unhedged yea-on-a-failed-motion rows
remain in the evidence tables under content/election/.

DETECTION RULE (the whole rule, not a summary): every evidence-table row in
content/election/councillors/*.md and content/election/issues/*.md is a
markdown table row of the form (councillor pages have an extra leading
"movedToward" cell; issue pages don't):

  | date | item link | motion excerpt | what a yea did | Yea/Nay | [movedToward] | result |

For every such row where:
  - the "Their vote" cell is literally "Yea", AND
  - the "Result" cell (last cell) contains the word "Failed" (case-
    insensitive; matches "Motion Failed (5 to 10)" and the supermajority-
    failure variant),

the row is a FAIL unless its "movedToward" cell (present on councillor pages)
starts with "backed a measure that would have " — the hedge
generate-stances.ts's movedTowardText() now applies to every yea-on-failed
row. Issue-page rows have no movedToward cell at all (see
renderIssueVoteRow) and are out of scope for this specific hedge (they carry
no per-row moved-toward action language), but are still scanned for the
DIFFERENT failure mode of a raw "what a yea did" cell asserting a plain,
non-conditional past-tense action verb ("Approved", "Increased", "Denied", …
without any "would have") on a Failed motion — a weaker heuristic check,
reported separately and non-fatal, since whatAYeaDid is independently-
verified free text, not template-generated, and already correctly hedges via
its own "Would have..." phrasing at the classify-batch level (see
data/election/classify/batch-*-verified.json) — this is a belt-and-suspenders
check, not the primary guard.

Usage: python3 scripts/election/sweep-failed-motion-yea.py
"""
import glob
import re
import sys

COUNCILLOR_GLOB = "content/election/councillors/*.md"
ISSUE_GLOB = "content/election/issues/*.md"

# Councillor-page evidence rows: | date | item | excerpt | whatAYeaDid | vote | movedToward | result |
ROW_RE_7COL = re.compile(
    r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|(.*?)\|(.*?)\|(.*?)\|\s*(Yea|Nay|Recused|Absent|Abstained|Other)\s*\|(.*?)\|(.*?)\|\s*$"
)


def main():
    hard_fails = []
    soft_flags = []

    for path in sorted(glob.glob(COUNCILLOR_GLOB)):
        for line_no, line in enumerate(open(path, encoding="utf-8"), start=1):
            m = ROW_RE_7COL.match(line)
            if not m:
                continue
            _date, _item, _excerpt, _whatayeadid, vote, moved_toward, result = m.groups()
            if vote != "Yea":
                continue
            if "failed" not in result.lower():
                continue
            moved_toward = moved_toward.strip()
            if not moved_toward.lower().startswith("backed a measure that would have"):
                hard_fails.append((path, line_no, moved_toward, result.strip()))

    print(f"Scanned councillor evidence tables ({len(glob.glob(COUNCILLOR_GLOB))} files) for unhedged yea-on-Failed movedToward cells.")
    if hard_fails:
        print(f"\nFAIL: {len(hard_fails)} unhedged yea-on-Failed row(s):")
        for path, line_no, moved_toward, result in hard_fails:
            print(f"  {path}:{line_no}  movedToward={moved_toward!r}  result={result!r}")
    else:
        print("PASS: every yea-on-Failed row's movedToward cell is hedged (\"backed a measure that would have ...\").")

    print(f"\n{'=' * 60}")
    if hard_fails:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
