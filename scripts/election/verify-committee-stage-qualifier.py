#!/usr/bin/env python3
"""
Round-2 gate item 8 verification: proves every rendered "what a yea did"
cell/bullet whose underlying motion was recorded at a COMMITTEE meeting
(meetingType != "Council") carries some stage signal -- the mechanical "
(committee stage)" suffix generate-hub-pages.ts's withStageQualifier
appends, or the pre-existing "Recommended ..."/"committee stage" wording
some rows already carry -- so a bare binding verb ("Approved...",
"Directed...", "Awarded...") is never left implying finality a committee
vote doesn't have.

INDEPENDENCE: this re-derives meetingType from data/votes/_all-motions.json
via each row's own Item-column link (meetingSlug -> meetingType is a 1:1
map -- every motion in one meeting shares that meeting's type), and checks
the ACTUAL RENDERED markdown in content/election/ -- it does not re-run or
import generate-hub-pages.ts's own withStageQualifier logic, so a bug in
that function's wiring (e.g. a call site that forgot to apply it) is
something this script can actually catch, not just restate.

WHAT'S SCANNED: every axis evidence-table row, every unclear-evidence-table
row, and every ladder-exclusion bullet, on every councillor profile page
(content/election/councillors/*.md) -- the three renderers that display a
whatAYeaDid string (see generate-hub-pages.ts). Issue-page rows
(renderIssueVoteRow) are out of scope: they render direction.label from the
regex engine, not the verified whatAYeaDid field.

Usage: python3 scripts/election/verify-committee-stage-qualifier.py
"""
import glob
import json
import re
import sys

FAIL = []

STAGE_SIGNAL_RE = re.compile(r"^recommended\b|\bcommittee stage\b", re.IGNORECASE)

motions = json.load(open("data/votes/_all-motions.json"))["motions"]
meeting_type_by_slug = {}
for m in motions:
    slug = m["meetingSlug"]
    mt = m["meetingType"]
    prev = meeting_type_by_slug.get(slug)
    if prev is not None and prev != mt:
        print(f"FATAL: meetingSlug {slug!r} has inconsistent meetingType {prev!r} vs {mt!r}")
        sys.exit(2)
    meeting_type_by_slug[slug] = mt

LINK_DEST_RE = re.compile(r"\]\(<([^>]*)>\)")


def slug_from_dest(dest: str) -> str:
    """"/months/2025-03/2025-03-25 4th Meeting of the ... Committee#anchor"
    -> "months/2025-03/2025-03-25 4th Meeting of the ... Committee" -- the
    exact meetingSlug form used as the key in _all-motions.json."""
    d = dest[1:] if dest.startswith("/") else dest
    return d.split("#", 1)[0]


def split_unescaped_pipes(line: str) -> list[str]:
    # tcell() escapes every literal "|" inside a cell as "\|", so an
    # unescaped " | " is always a real column boundary.
    parts = re.split(r"(?<!\\)\|", line)
    return [p.strip() for p in parts]


ROW_RE = re.compile(
    r"^\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*(Yea|Nay|Recused|Absent|Abstained|Other)\s*\|"
)
BULLET_RE = re.compile(
    r"^-\s+(Yea|Nay|Recused|Absent|Abstained|Other):\s"
)

total_checked = 0
skipped_no_slug = 0

for path in sorted(glob.glob("content/election/councillors/*.md")):
    for lineno, line in enumerate(open(path, encoding="utf-8"), start=1):
        line = line.rstrip("\n")

        what_a_yea_did = None
        dest = None

        if ROW_RE.match(line):
            cols = split_unescaped_pipes(line)
            # ["", date, vote, whatAYeaDid, item, ...rest..., ""]
            if len(cols) < 5:
                continue
            what_a_yea_did = cols[3]
            item_cell = cols[4]
            m = LINK_DEST_RE.search(item_cell)
            if m:
                dest = m.group(1)
        elif BULLET_RE.match(line):
            # "- Yea: <whatAYeaDid> — [text](<dest>) ... (date, counts as
            # for, Result)"
            body = line.split(":", 1)[1].strip()
            em_split = body.split(" — ", 1)
            if len(em_split) != 2:
                continue
            what_a_yea_did = em_split[0].strip()
            m = LINK_DEST_RE.search(em_split[1])
            if m:
                dest = m.group(1)
        else:
            continue

        if what_a_yea_did is None or dest is None:
            continue
        if not what_a_yea_did or what_a_yea_did == "—":  # "—" placeholder cell
            continue

        slug = slug_from_dest(dest)
        meeting_type = meeting_type_by_slug.get(slug)
        if meeting_type is None:
            skipped_no_slug += 1
            continue

        total_checked += 1
        if meeting_type != "Council":
            if not STAGE_SIGNAL_RE.search(what_a_yea_did):
                FAIL.append(
                    f"{path}:{lineno}: committee meeting ({meeting_type}) but no "
                    f"stage signal in whatAYeaDid -- {what_a_yea_did[:140]!r}"
                )

print(f"checked {total_checked} whatAYeaDid row(s)/bullet(s); {skipped_no_slug} skipped (dest slug not found in _all-motions.json, e.g. an ambiguous-anchor row pointing at a bare meeting page whose slug wasn't resolvable)")

print()
if FAIL:
    print(f"{len(FAIL)} CHECK(S) FAILED:")
    for f in FAIL[:50]:
        print(" -", f)
    if len(FAIL) > 50:
        print(f"   ... and {len(FAIL) - 50} more")
    sys.exit(1)
else:
    print("ALL CHECKS PASSED -- zero committee-stage motions render a bare binding verb with no stage signal")
