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

# Issue-page vote rows: | date | item | what a yea did | tally | result |
# (see renderIssueVoteRow in generate-hub-pages.ts — 5 columns, no vote/
# movedToward cells at all, since this table isn't per-councillor).
ROW_RE_5COL = re.compile(
    r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|(.*?)\|(.*?)\|(.*?)\|(.*?)\|\s*$"
)

NOT_CLASSIFIED_PLACEHOLDER = "not classified"

# A plain, regular past-tense verb ("Approved", "Increased", "Denied", ...).
REGULAR_PAST_TENSE_RE = re.compile(r"^[A-Z][a-zA-Z]*ed$")

# Common irregular past-tense verbs that don't end in "ed", seen in this
# corpus's whatAYeaDid text (council motions: cut, set, built, rezoned via
# "ed" already, spent, sent, held, kept, chose, gave, made, put, grew, sold,
# told, rose, fell, drew, threw, broke, spoke, froze, woke, bore, wore, hid,
# hit, shut, bet, cost, met, ran, withdrew, sought, fought, bought, brought,
# understood, wrote).
IRREGULAR_PAST_TENSE_FIRST_WORDS = {
    "cut", "set", "built", "spent", "sent", "held", "kept", "chose", "gave",
    "made", "put", "grew", "sold", "told", "rose", "fell", "drew", "threw",
    "broke", "spoke", "froze", "woke", "bore", "wore", "hid", "hit", "shut",
    "bet", "cost", "met", "ran", "withdrew", "sought", "fought", "bought",
    "brought", "understood", "wrote", "rewrote", "took", "left", "sat",
    "stood", "ate", "swore", "tore",
}


def is_unhedged_past_tense_action(cell: str) -> bool:
    """Round-7 gate item 3: the docstring's belt-and-suspenders check on
    issue-page 'what a yea did' cells, implemented. True when a cell asserts
    a plain, non-conditional past-tense action ("Approved", "Increased",
    "Denied", ...) with no "would have" hedge anywhere in it — the same
    failure mode the hard councillor-page check guards against, but read off
    the free-text whatAYeaDid cell instead of the templated movedToward
    cell."""
    cell = cell.strip()
    if not cell:
        return False
    if cell.lower().startswith(NOT_CLASSIFIED_PLACEHOLDER):
        return False
    if "would have" in cell.lower():
        return False
    first_word = re.match(r"^[A-Za-z]+", cell)
    if not first_word:
        return False
    word = first_word.group(0)
    if REGULAR_PAST_TENSE_RE.match(word):
        return True
    return word.lower() in IRREGULAR_PAST_TENSE_FIRST_WORDS


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

    for path in sorted(glob.glob(ISSUE_GLOB)):
        for line_no, line in enumerate(open(path, encoding="utf-8"), start=1):
            m = ROW_RE_5COL.match(line)
            if not m:
                continue
            _date, _item, whatayeadid, _tally, result = m.groups()
            if "failed" not in result.lower():
                continue
            whatayeadid = whatayeadid.strip()
            if is_unhedged_past_tense_action(whatayeadid):
                soft_flags.append((path, line_no, whatayeadid, result.strip()))

    print(f"Scanned councillor evidence tables ({len(glob.glob(COUNCILLOR_GLOB))} files) for unhedged yea-on-Failed movedToward cells.")
    if hard_fails:
        print(f"\nFAIL: {len(hard_fails)} unhedged yea-on-Failed row(s):")
        for path, line_no, moved_toward, result in hard_fails:
            print(f"  {path}:{line_no}  movedToward={moved_toward!r}  result={result!r}")
    else:
        print("PASS: every yea-on-Failed row's movedToward cell is hedged (\"backed a measure that would have ...\").")

    print(f"\nScanned issue-page vote tables ({len(glob.glob(ISSUE_GLOB))} files) for unhedged past-tense 'what a yea did' cells on Failed motions (belt-and-suspenders, non-fatal).")
    if soft_flags:
        print(f"\nWARN: {len(soft_flags)} unhedged past-tense whatAYeaDid cell(s) on a Failed motion (not a hard failure — see module docstring):")
        for path, line_no, whatayeadid, result in soft_flags:
            print(f"  {path}:{line_no}  whatAYeaDid={whatayeadid!r}  result={result!r}")
    else:
        print("PASS: every issue-page whatAYeaDid cell on a Failed motion is either hedged (\"Would have ...\") or not a plain past-tense action assertion.")

    print(f"\n{'=' * 60}")
    if hard_fails:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
