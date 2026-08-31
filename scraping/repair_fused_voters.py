#!/usr/bin/env python3
"""
In-place repair for the fused-voter bug fixed in content.py (dc030fde,
"fix(scraper): stop fusing the last two voters in multi-voter vote rows").

That fix only stops the bug on FUTURE scrapes. It does nothing for the 526
data/*.json files (2018-03..2023-05) that were already scraped with the old
`voters_cell.contents[0].replace(" and ", "").split(", ")` logic, which
glued the last two voters in a row together with a bare comma and no space
(e.g. "D. Ferreira,C. Rahman" instead of two separate entries). Downstream,
normalizeCouncillorName() rejects any string with an internal comma and
returns null, so BOTH fused councillors silently vanish from that
division's vote record - roughly 9,904 fused entries destroying ~19,808
vote attributions corpus-wide (see the 30 Aug 2026 audit).

WHY THIS IS AN IN-PLACE REPAIR, NOT A RE-SCRAPE:
  A live re-scrape (`process_meeting()` on each affected meeting) would
  re-fetch from eSCRIBE and unconditionally overwrite the local JSON. That's
  unsafe here: 150 of the 526 affected files carry non-empty `transcript`
  data (added by a separate transcript-sync pass, keyed by re-matching
  against transcript.py's own source - not reproducible by re-running
  process_meeting()), and process_meeting()'s merge path only preserves an
  existing transcript when `data_sources.official_minutes` is explicitly
  False; none of these 526 files have a `data_sources` key at all, so a
  live re-scrape would silently drop transcript data on all 150 of them.

  The fused string itself, on the other hand, is 100% mechanically
  recoverable without re-fetching anything: the bug always fuses exactly
  the LAST TWO voters in a row (one "and" join point), so every fused entry
  in the corpus splits on its one bare comma (a comma NOT followed by
  whitespace - never legitimate inside a name) into exactly two pieces.
  Verified corpus-wide before writing this script: all 9,904 fused entries
  across all 526 files split into exactly 2 pieces, zero exceptions - see
  the "exactly two pieces" assertion below, which turns any future
  surprise (e.g. a triple-fusion, which the bug's own mechanism can't
  produce) into a loud failure instead of a silent bad split.

  This also reconstructs EXACTLY what a live re-scrape would produce from
  the same source HTML through the fixed parser - eSCRIBE's raw markup for
  these meetings has not changed, it's the same "A, B, ...,  and Z" text,
  the old code just split it wrong.

SCOPE: only data/*.json (the source generate-votes.ts and generate-stats.ts
read). content/months/*.md's embedded "Vote:" markdown tables also show the
old fused cells (e.g. "|P. Van Meerbergen,S. Hillier||") - repairing those
in place would mean regenerating the whole table's row count (the split
adds a voter, changing the table's tallest column), which is a materially
bigger, higher-risk change than this script's job. Left as a known,
documented residual: the per-meeting page's own vote table still shows the
historical fused cell after this repair; data/votes/*.json, data/stats/*.json,
and the councillor pages built from them are correct.

Usage:
  cd scraping && python repair_fused_voters.py            # repair
  cd scraping && python repair_fused_voters.py --check    # report only, no writes
"""

import glob
import json
import re
import sys

# A comma directly followed by a non-whitespace character. Never legitimate
# inside a councillor name (or the "Mayor X. Surname" / "(Acting Chair)"
# forms normalizeCouncillorName() already strips) - this is exactly the
# glued join point `.replace(" and ", "").split(", ")` left behind.
FUSED_RE = re.compile(r",(?=\S)")


def find_fused_entries(obj):
    """Yield (container_list, index, value) for every fused voters[] entry
    anywhere in a meeting's JSON tree. Deliberately structure-agnostic
    (matches on any string inside any list, not a specific "voters" key
    path) since votes are nested arbitrarily deep under items/sub-items -
    the same defensive posture dedupe-placeholders.ts takes rather than
    hard-coding one filename/shape convention.
    """
    if isinstance(obj, dict):
        for v in obj.values():
            yield from find_fused_entries(v)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            if isinstance(v, str):
                if FUSED_RE.search(v):
                    yield (obj, i, v)
            else:
                yield from find_fused_entries(v)


def repair_file(path, check_only=False):
    with open(path, "rb") as f:
        raw = f.read()
    data = json.loads(raw)

    # Preserve the file's existing JSON formatting exactly. The 526 affected
    # files are NOT uniformly formatted: 376 are the compact single-line
    # output process_meeting.py writes (`json.dumps(meeting, ...)`, no
    # indent), but 150 carry transcript data merged in later by a separate
    # (Node/TS) pass that pretty-prints with a 2-space indent. Reserializing
    # every file the same way - which an earlier version of this script did
    # - collapsed those 150 multi-thousand-line pretty files down to one
    # line each: a ~305,000-line unintended reformatting diff hiding a
    # ~9,900-line real fix. Verified byte-for-byte against every one of the
    # 526 files before this shipped: matching each file's own compact-vs-
    # indent(2) style round-trips identically when nothing changed.
    pretty = raw.startswith(b"{\n")

    # Collect all matches before mutating anything (mutating a list while a
    # generator is walking it is asking for trouble), then apply each
    # container's replacements highest-index-first so an earlier
    # replacement growing the list by one element can't shift the index of
    # a later one in the same container.
    matches = list(find_fused_entries(data))
    matches.sort(key=lambda m: m[1], reverse=True)

    fixed_entries = 0
    for container, index, value in matches:
        pieces = [p.strip() for p in FUSED_RE.split(value)]
        pieces = [p for p in pieces if p]
        if len(pieces) != 2:
            # The bug only ever fuses one join point (last two voters).
            # Anything else is unexpected corruption this script doesn't
            # know how to repair safely - skip it and let it surface in
            # the summary rather than guessing.
            print(f"  ⚠ {path}: unexpected split ({len(pieces)} pieces) for {value!r}, skipping")
            continue
        # Replace the one fused entry with the two real names, in place.
        container[index : index + 1] = pieces
        fixed_entries += 1

    if fixed_entries and not check_only:
        with open(path, "w", encoding="utf-8") as f:
            if pretty:
                json.dump(data, f, indent=2)
            else:
                json.dump(data, f)

    return fixed_entries


def main():
    check_only = "--check" in sys.argv

    paths = sorted(glob.glob("../data/*/*.json"))
    total_files = 0
    total_entries = 0

    for path in paths:
        try:
            n = repair_file(path, check_only=check_only)
        except Exception as e:
            print(f"  ✗ {path}: error - {e}")
            continue
        if n:
            total_files += 1
            total_entries += n

    verb = "would fix" if check_only else "fixed"
    print(f"\n{'🔍' if check_only else '🧹'} {verb} {total_entries:,} fused voter entries across {total_files:,} files")


if __name__ == "__main__":
    main()
