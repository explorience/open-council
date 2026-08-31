#!/usr/bin/env python3
"""
In-place repair for the phantom-title bug fixed in content.py Vote.add_row
and Meeting.py get_names (see BARE_TITLE_TOKENS in content.py).

eSCRIBE sometimes renders the presiding officer as an appositive inline
with a comma-joined voter/name list instead of attaching the title to a
name, e.g.:

    "P. Squire, J. Morgan, Acting Mayor, A. Hopkins, S. Lewis, S. Hillier,
     and S. Lehman"

The chair's real name (J. Morgan) is already in the list - "Acting Mayor"
is not a second voter. The old comma-splitting logic in Vote.add_row had
no way to distinguish a title apposition from a list separator, so it
produced "Acting Mayor" (or "Chair") as its own phantom entry: a voter
attributed to a division who cast no vote and, in the affected rows,
inflates the recorded tally past what the minutes state.

That fix only stops the bug on FUTURE scrapes. This script repairs the
already-scraped data/*.json corpus by removing every exact-match bare
title token found anywhere inside a "voters" list - the token is 100%
mechanically identifiable (see BARE_TITLE_TOKENS: exact match after trim,
never a substring match, so a real name like "J. Chair" is never touched)
and 100% safe to delete outright (unlike the fused-voter bug this mirrors,
there is no information to recover here - the token never carried a name,
so there is nothing to split it into; the fix is deletion, not splitting).

SCOPE: only data/*.json (the source generate-votes.ts and generate-stats.ts
read), same scope as repair_fused_voters.py and for the same reason -
content/months/*.md's embedded vote tables also carry the phantom, but
repairing those in place means regenerating table row counts, a materially
bigger change left as a known, documented residual (data/votes/*.json,
data/stats/*.json, and the councillor pages built from them are correct
after this script; the per-meeting page's own vote table is not).

Usage:
  cd scraping && python repair_phantom_titles.py            # repair
  cd scraping && python repair_phantom_titles.py --check    # report only, no writes
"""

import glob
import json
import sys

from content import BARE_TITLE_TOKENS


def find_phantom_entries(obj):
    """Yield (container_list, index, value) for every bare-title entry
    anywhere in a meeting's JSON tree. Deliberately structure-agnostic
    (matches on any string inside any list, not a hard-coded "voters" key
    path) since votes are nested arbitrarily deep under items/sub-items -
    same defensive posture as repair_fused_voters.py's find_fused_entries.
    """
    if isinstance(obj, dict):
        for v in obj.values():
            yield from find_phantom_entries(v)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            if isinstance(v, str):
                if v.strip() in BARE_TITLE_TOKENS:
                    yield (obj, i, v)
            else:
                yield from find_phantom_entries(v)


def repair_file(path, check_only=False):
    with open(path, "rb") as f:
        raw = f.read()
    data = json.loads(raw)

    # Preserve the file's existing JSON formatting exactly - see
    # repair_fused_voters.py for why (376 files are compact single-line
    # process_meeting.py output, 150 are pretty-printed indent(2) by a
    # later transcript-merge pass; reserializing every file the same way
    # would produce a spurious formatting diff on top of the real fix).
    pretty = raw.startswith(b"{\n")

    # Collect all matches before mutating anything, then delete
    # highest-index-first within each container so an earlier deletion
    # can't shift the index of a later one in the same list.
    matches = list(find_phantom_entries(data))
    matches.sort(key=lambda m: m[1], reverse=True)

    removed = 0
    for container, index, value in matches:
        del container[index]
        removed += 1

    if removed and not check_only:
        with open(path, "w", encoding="utf-8") as f:
            if pretty:
                json.dump(data, f, indent=2)
            else:
                json.dump(data, f)

    return removed


def main():
    check_only = "--check" in sys.argv

    paths = sorted(glob.glob("../data/*/*.json"))
    total_files = 0
    total_entries = 0
    per_file = {}

    for path in paths:
        try:
            n = repair_file(path, check_only=check_only)
        except Exception as e:
            print(f"  ✗ {path}: error - {e}")
            continue
        if n:
            total_files += 1
            total_entries += n
            per_file[path] = n

    for path, n in sorted(per_file.items()):
        print(f"  {path}: {n}")

    verb = "would remove" if check_only else "removed"
    print(f"\n{'🔍' if check_only else '🧹'} {verb} {total_entries:,} phantom title-only voter entries across {total_files:,} files")


if __name__ == "__main__":
    main()
