#!/usr/bin/env python3
"""
Round-5 gate BLOCKER item 1 sweep: proves zero committee/council-membership
assertions remain anywhere in content/election/, after eliminating the whole
claim class (there is no membership source anywhere in this repo).

DETECTION RULE (the whole rule, not a summary): scan every *.md file under
content/election/ for any of a fixed set of membership-assertion phrases —
the exact wordings the round-3/round-4 generators used to claim a councillor
IS or IS NOT a member of a committee, in either direction, plus generic
guard phrases ("member of that committee", "member of this committee") that
would catch a differently-worded reintroduction of the same claim. This is a
plain-text grep, not a semantic check — deliberately conservative (would
rather over-match and require a human look than silently miss a
reintroduced claim).

A hit is a FAIL. Zero hits is the only passing state.

Usage: python3 scripts/election/sweep-membership-claims.py
"""
import glob
import re
import sys

CONTENT_GLOB = "content/election/**/*.md"

# Every phrasing (case-insensitive) that asserts committee/council
# membership status in either direction. Kept as literal substrings/regexes
# rather than one clever pattern, so each one documents exactly which past
# defect it guards against.
BANNED_PATTERNS = [
    (r"is not a member of", "asserts non-membership"),
    (r"is a member of that committee", "asserts membership"),
    (r"is a member of this committee", "asserts membership"),
    (r"not a member of that committee", "asserts non-membership"),
    (r"not a member of this committee", "asserts non-membership"),
    (r"member of that committee", "generic committee-membership assertion"),
    (r"member of this committee", "generic committee-membership assertion"),
    (r"committee this councillor is (?:not )?a member", "membership assertion"),
    (r"members? sit on Council", "membership assertion (even the true-by-structure council wording is retired — see round-5 item 1)"),
    (r"absent for the whole meeting, so no individual vote exists", "round-4's memberAbsentCommittee wording (implies known membership)"),
    (r"a member who attended", "round-4 membership-inference wording"),
    (r"not evidence (?:of|they weren't) (?:non-membership|weren't on that committee)", "round-4 membership-inference wording"),
]

COMPILED = [(re.compile(p, re.IGNORECASE), desc) for p, desc in BANNED_PATTERNS]


def main():
    files = sorted(glob.glob(CONTENT_GLOB, recursive=True))
    if not files:
        print("ERROR: no files matched content/election/**/*.md — check CWD (run from repo root)")
        sys.exit(2)

    hits = []
    for path in files:
        text = open(path, encoding="utf-8").read()
        for pattern, desc in COMPILED:
            for m in pattern.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                hits.append((path, line_no, desc, m.group(0)))

    print(f"Scanned {len(files)} files under content/election/.")
    if hits:
        print(f"\nFAIL: {len(hits)} membership assertion(s) found:")
        for path, line_no, desc, matched in hits:
            print(f"  {path}:{line_no}  [{desc}]  {matched!r}")
        sys.exit(1)

    print("PASS: zero membership assertions found in content/election/.")


if __name__ == "__main__":
    main()
