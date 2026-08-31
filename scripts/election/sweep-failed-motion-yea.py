#!/usr/bin/env python3
"""
Round-5 gate item 4 sweep, unified in round-9 gate item 2: proves zero
unhedged yea-on-a-failed-motion rows remain in the evidence tables under
content/election/ — for BOTH fields that assert what a yea did (movedToward
AND whatAYeaDid) and on ALL THREE table shapes that carry either field,
across both page types. Before round-9, this sweep checked movedToward as a
hard failure but ONLY on councillor pages, and whatAYeaDid as a soft,
non-fatal warning and ONLY on issue pages — leaving the councillor-page
"no clear direction" table (renderUnclearSection in generate-hub-pages.ts,
which also carries a whatAYeaDid cell, on every issue, for every councillor
who voted on an unclear motion) completely unscanned. That table is exactly
where a Failed motion's unhedged or outcome-verb-inverted whatAYeaDid text
is actually visible to a reader, since a non-direction-bearing motion's
whatAYeaDid never appears in the axis-evidence table at all (only
direction-bearing motions do).

DETECTION RULE (the whole rule, not a summary): content/election/
councillors/*.md and content/election/issues/*.md carry THREE distinct
markdown table row shapes that can carry a whatAYeaDid or movedToward cell.
Shapes A and B's column order changed in round-10 gate item 4 (mobile
column order — "Their vote" moved to the second column, right after Date,
so a phone reader sees it without swiping); this sweep's row regexes moved
with them:

  A. Councillor axis-evidence rows (renderAxisSection — direction-bearing
     motions only):
       | date | Yea/Nay/... | what a yea did | item link | motion excerpt | moved toward | result |

  B. Councillor "no clear direction" rows (renderUnclearSection — motions
     with no axis, listed for transparency, one row per councillor who
     voted/recused/was absent on it):
       | date | Yea/Nay/... | what a yea did | item link | motion excerpt | result |

  C. Issue-page vote rows (renderIssueVoteRow — every divided motion on that
     issue, direction-bearing or not, no per-councillor vote column, never
     touched by the item-4 reorder since it has no "Their vote" column to
     move):
       | date | item link | what a yea did | tally | result |

For every row on shape A or B where the "Their vote" cell is literally
"Yea", and for every row on shape C, where the "Result" cell (last cell)
contains the word "Failed" (case-insensitive; matches "Motion Failed (5 to
10)" and the supermajority-failure variant): the row is a HARD FAILURE
unless its whatAYeaDid cell either starts with the placeholder text "Not
classified" (shape C only — an issue page shows this instead of prose when a
motion has no axis; nothing to hedge-check there) or contains the phrase
"would have" (case-insensitive) somewhere in it. Shape A's movedToward cell
is checked the same way it always was: it must start with "backed a measure
that would have ".

whatAYeaDid and movedToward both ultimately trace back to the SAME
classification-layer field (see generate-stances.ts's directionFromVerified
and movedTowardText) — a fix to one below the render layer (i.e., in
data/election/classify/corrections.json) heals every cell on every page type
that field feeds, which is why this sweep hard-fails all of them identically
instead of treating any cell as a weaker, informational check.

Usage: python3 scripts/election/sweep-failed-motion-yea.py
"""
import glob
import re
import sys

COUNCILLOR_GLOB = "content/election/councillors/*.md"
ISSUE_GLOB = "content/election/issues/*.md"

# Shape A — councillor axis-evidence rows: 7 cells, includes movedToward.
# Round-10 gate item 4: vote cell is now the SECOND cell (right after date),
# not the fifth.
ROW_RE_7COL = re.compile(
    r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(Yea|Nay|Recused|Absent|Abstained|Other)\s*\|(.*?)\|(.*?)\|(.*?)\|(.*?)\|(.*?)\|\s*$"
)

# Shape B — councillor "no clear direction" rows (renderUnclearSection): 6
# cells, no movedToward column at all (these motions have no axis). Same
# round-10 gate item 4 reorder as shape A.
ROW_RE_6COL = re.compile(
    r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(Yea|Nay|Recused|Absent|Abstained|Other)\s*\|(.*?)\|(.*?)\|(.*?)\|(.*?)\|\s*$"
)

# Shape C — issue-page vote rows (renderIssueVoteRow): 5 cells, no vote
# column (this table isn't per-councillor).
ROW_RE_5COL = re.compile(
    r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|(.*?)\|(.*?)\|(.*?)\|(.*?)\|\s*$"
)

NOT_CLASSIFIED_PLACEHOLDER = "not classified"
MOVED_TOWARD_HEDGE = "backed a measure that would have"


def is_hedged(cell: str) -> bool:
    """True when a whatAYeaDid cell either isn't prose at all (empty, or the
    issue-page "Not classified" placeholder) or carries the "would have"
    hedge somewhere in it."""
    cell = cell.strip()
    if not cell:
        return True
    if cell.lower().startswith(NOT_CLASSIFIED_PLACEHOLDER):
        return True
    return "would have" in cell.lower()


def main():
    fails = []

    for path in sorted(glob.glob(COUNCILLOR_GLOB)):
        for line_no, line in enumerate(open(path, encoding="utf-8"), start=1):
            m7 = ROW_RE_7COL.match(line)
            if m7:
                _date, vote, whatayeadid, _item, _excerpt, moved_toward, result = m7.groups()
                if vote != "Yea" or "failed" not in result.lower():
                    continue
                moved_toward = moved_toward.strip()
                if not moved_toward.lower().startswith(MOVED_TOWARD_HEDGE):
                    fails.append((path, line_no, "A/movedToward", moved_toward, result.strip()))
                if not is_hedged(whatayeadid):
                    fails.append((path, line_no, "A/whatAYeaDid", whatayeadid.strip(), result.strip()))
                continue

            m6 = ROW_RE_6COL.match(line)
            if m6:
                _date, vote, whatayeadid, _item, _excerpt, result = m6.groups()
                if vote != "Yea" or "failed" not in result.lower():
                    continue
                if not is_hedged(whatayeadid):
                    fails.append((path, line_no, "B/whatAYeaDid", whatayeadid.strip(), result.strip()))

    for path in sorted(glob.glob(ISSUE_GLOB)):
        for line_no, line in enumerate(open(path, encoding="utf-8"), start=1):
            m = ROW_RE_5COL.match(line)
            if not m:
                continue
            _date, _item, whatayeadid, _tally, result = m.groups()
            if "failed" not in result.lower():
                continue
            if not is_hedged(whatayeadid):
                fails.append((path, line_no, "C/whatAYeaDid", whatayeadid.strip(), result.strip()))

    councillor_count = len(glob.glob(COUNCILLOR_GLOB))
    issue_count = len(glob.glob(ISSUE_GLOB))
    print(
        f"Scanned {councillor_count} councillor page(s) (shapes A + B) and "
        f"{issue_count} issue page(s) (shape C) for unhedged yea-on-Failed "
        f"movedToward/whatAYeaDid cells."
    )

    if fails:
        print(f"\nFAIL: {len(fails)} unhedged row(s):")
        for path, line_no, cell, text, result in fails:
            print(f"  {path}:{line_no}  [{cell}]  text={text!r}  result={result!r}")
    else:
        print(
            "PASS: every yea-on-Failed row's movedToward and whatAYeaDid cells "
            "are hedged, on every table shape, on every page."
        )

    print(f"\n{'=' * 60}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
