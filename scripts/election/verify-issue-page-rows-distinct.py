#!/usr/bin/env python3
"""
Round-3 gate item 3 verification: proves zero byte-identical vote rows
remain on any issue page, and that where two distinct motions genuinely
collide on date/item/tally, the motion-excerpt column (added by round-3
gate item 3 -- see renderIssueVoteRow/motionSnippet in
generate-hub-pages.ts / generate-stances.ts) actually differentiates them.

WHAT COUNTS AS A ROW: every table data row in content/election/issues/*.md
(the renderIssueVoteRow shape: date | item link | what a yea did | motion
excerpt | tally | result). This is the actual rendered markdown, not
issues.json re-parsed -- proving what a reader sees.

CHECK: within one issue page, no two rows are byte-identical. Separately
(informational, not a failure on its own): counts how many DISTINCT-motion
row pairs share every visible field except the excerpt (i.e. would have
collided before item 3 added that column) -- confirms the fix is load-
bearing, not decorative.

Usage: python3 scripts/election/verify-issue-page-rows-distinct.py
"""
import glob
import re
import sys

ISSUE_GLOB = "content/election/issues/*.md"

ROW_RE = re.compile(
    r"^\|\s*\d{4}-\d{2}-\d{2}\s*\|.*\|.*\|.*\|.*\|.*\|\s*$"
)


def split_unescaped_pipes(line: str) -> list[str]:
    # tcell() escapes every literal "|" inside a cell as "\|", so an
    # unescaped " | " is always a real column boundary.
    parts = re.split(r"(?<!\\)\|", line)
    return [p.strip() for p in parts]


def main():
    fails = []
    would_have_collided = 0
    total_rows = 0

    for path in sorted(glob.glob(ISSUE_GLOB)):
        if path.endswith("/index.md"):
            continue
        rows = []
        for lineno, line in enumerate(open(path, encoding="utf-8"), start=1):
            line = line.rstrip("\n")
            if not ROW_RE.match(line):
                continue
            rows.append((lineno, line))

        total_rows += len(rows)

        seen_full = {}
        # key = every column EXCEPT the excerpt (index 4); value = the set
        # of distinct excerpt values seen for that key, plus how many rows.
        seen_minus_excerpt: dict[tuple, dict] = {}
        for lineno, line in rows:
            seen_full.setdefault(line, []).append(lineno)

            cols = split_unescaped_pipes(line)
            # ["", date, item, whatayeadid, excerpt, tally, result, ""]
            if len(cols) < 8:
                continue
            without_excerpt = tuple(c for i, c in enumerate(cols) if i != 4)
            bucket = seen_minus_excerpt.setdefault(
                without_excerpt, {"linenos": [], "excerpts": set()}
            )
            bucket["linenos"].append(lineno)
            bucket["excerpts"].add(cols[4])

        for line, linenos in seen_full.items():
            if len(linenos) > 1:
                fails.append(
                    f"{path}: rows {linenos} are byte-identical -- {line[:160]}"
                )

        for bucket in seen_minus_excerpt.values():
            # Rows that agree on every column except the excerpt AND whose
            # excerpts differ from each other -- would have collided
            # pre-item-3; the excerpt is the only thing telling them apart
            # now. (If the excerpts also match, that's the full-row dupe
            # case already caught above, not counted twice here.)
            if len(bucket["linenos"]) > 1 and len(bucket["excerpts"]) > 1:
                would_have_collided += len(bucket["linenos"])

    print(f"scanned {total_rows} issue-page vote row(s) across {len(glob.glob(ISSUE_GLOB)) - 1} issue page(s)")
    print(f"{would_have_collided} row(s) share every column except the motion excerpt -- the excerpt is the only thing distinguishing them")

    print()
    if fails:
        print(f"{len(fails)} CHECK(S) FAILED:")
        for f in fails[:50]:
            print(" -", f)
        if len(fails) > 50:
            print(f"   ... and {len(fails) - 50} more")
        sys.exit(1)
    print("ALL CHECKS PASSED -- zero byte-identical vote rows on any issue page")


if __name__ == "__main__":
    main()
