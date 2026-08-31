#!/usr/bin/env python3
"""
Round-5/round-6 gate BLOCKER item 1 sweep: proves zero committee/council-
membership assertions remain anywhere in content/election/, after eliminating
the whole claim class (there is no membership source anywhere in this repo).

Round-6 added: the round-5 fix didn't eliminate the claim class, it INVERTED
it ("was on the roster for N" / "attended as an observer (only committee
members vote)" still assert a membership status, just the opposite one).
That shipped past the round-5 sweep because the sweep was a fixed list of
EXACT PHRASES shaped to the wording that existed at the time — any rewording
that kept the same underlying claim, in different words, sailed through.

Round-7 added: same failure mode again, in a THIRD wording — the empty-
profile fallback in generate-hub-pages.ts asserted membership via
"committee assignments didn't overlap", using neither "member" nor "roster".
Added the "assignment"/"assignments" word-stem, plus "sits on"/"serves
on"/"appointed to"/"seat on" as TIER-1 exact phrases (no exemptions), on
the reasoning that these four are specific enough to a membership claim
that they wouldn't occur in a genuine council record.

Round-8 gate item 6: that reasoning was wrong. 16 real motions since 2023
use "appointed to", "sits on", "serves on" or "seat on" verbatim in their
own agenda-item title or motion text (committee/board appointment items are
routine council business) — as tier-1, no-exemption phrases, every one of
those legitimate quotations was a false-positive FAIL. Moved all four to
TIER-2 (word-stem tier, same verbatim-source-line exemption as roster/
member/membership/observer/assignment already get) instead of removing
them: they still catch a reworded membership claim in ordinary prose, they
just no longer fire on a real motion quoting its own appointment.

DETECTION RULE (the whole rule, not a summary): two tiers of pattern, over
every *.md file under content/election/.

  1. EXACT_PHRASE_PATTERNS: specific wordings past generators used to claim
     a councillor IS or IS NOT a member of a committee, in either direction,
     plus generic guard phrases. Scanned against the ENTIRE file, including
     markdown table cells and quoted source-title lines — these phrasings
     are specific enough that they are not expected to occur in a verbatim
     quote of a real council agenda item or motion text.

  2. WORD_STEM_PATTERNS: bare stems roster, member, membership, observer,
     assignment(s), plus (round-8 gate item 6) "sits on", "serves on",
     "appointed to", "seat on" — added because item 1's exact-phrase
     wording is exactly what round-5's inversion evaded; a bare-stem net
     catches ANY future rewording that reaches for this vocabulary at all,
     not just the specific phrasings seen so far. Scanned only against lines
     that are NOT a verbatim quotation of the source meeting record, because
     these stems occur legitimately in two places this sweep must not flag:

       a. Real agenda-item titles and motion excerpts, quoted verbatim from
          the source meeting record (e.g. "Consideration of Appointment to
          the Committee of Adjustment (Requires 1 Member)", "Board Member
          Composition"). These appear in markdown table rows (evidence
          tables, issue-page vote tables) and in the "Unclassified divided
          votes" bullet list (`- YYYY-MM-DD — <verbatim title> (item N)`).
          Rewriting someone else's words to dodge this sweep would be a
          worse defect than the one it exists to catch — see
          verify-round4-items.py and the project's own citation-fidelity
          rule. Detected structurally: a line that is a markdown table row
          (starts with `|`) or an unclassified-list source-title bullet
          (matches `^- \\d{4}-\\d{2}-\\d{2} — `).
       b. "roster data conflict" / "roster-conflicts.json" / rosterConflictCount
          prose — an established, unrelated data-quality concept (the same
          person recorded in two vote-kind buckets on one motion) that has
          nothing to do with committee membership and predates the round-5/6
          defect entirely. Detected by an explicit phrase allowlist
          (ROSTER_DATA_CONFLICT_ALLOW), not a structural skip, because this
          prose sits in ordinary paragraphs alongside genuine claim
          sentences and a line-level skip would be too blunt.

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
# defect it guards against. Scanned against the whole file.
EXACT_PHRASE_PATTERNS = [
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
    (r"was on the roster for", "round-5's INVERTED membership claim — the exact defect round-6 exists to catch"),
    (r"attended as an observer", "round-5's inverted non-membership claim"),
    (r"only committee members vote", "round-5's membership gloss on the observer clause"),
]

# Bare word-stems that must not appear anywhere this sweep can be sure is
# NOT a verbatim quotation of the source record (see module docstring, tier
# 2). Round-6 gate item 3: added specifically because item 1's exact-phrase
# patterns are shaped to wording that already shipped once and got past
# round-5 — a stem-level net catches a differently-worded reintroduction
# that no exact phrase yet anticipates.
WORD_STEM_PATTERNS = [
    (r"\broster\w*\b", "word-stem: roster"),
    (r"\bmembers?\b", "word-stem: member"),
    (r"\bmembership\w*\b", "word-stem: membership"),
    (r"\bobservers?\b", "word-stem: observer"),
    # Round-7 gate item 5: "committee assignments" is the same membership
    # claim in different words (see generate-hub-pages.ts's noPatternNote
    # fallback, fixed alongside this sweep addition).
    (r"\bassignments?\b", "word-stem: assignment"),
    # Round-8 gate item 6: moved down from EXACT_PHRASE_PATTERNS (tier 1).
    # Round-7 put these here as no-exemption whole-file phrases on the
    # reasoning that they were specific enough to a membership claim not to
    # occur in a genuine council record; that turned out to be false -- 16
    # real motions since 2023 use one of these four phrasings verbatim in
    # their own agenda-item title or motion text (appointing someone to a
    # board or committee is routine council business). Tier 2 still catches
    # a reworded membership claim anywhere in ordinary prose; it just also
    # gets the same verbatim-source-line exemption (table rows, unclassified-
    # list bullets) every other word-stem here already gets, so a real
    # motion quoting its own appointment doesn't fail the sweep.
    (r"\bsits on\b", "word-stem: \"sits on\""),
    (r"\bserves on\b", "word-stem: \"serves on\""),
    (r"\bappointed to\b", "word-stem: \"appointed to\""),
    (r"\bseat on\b", "word-stem: \"seat on\""),
]

EXACT_PHRASE_COMPILED = [(re.compile(p, re.IGNORECASE), desc) for p, desc in EXACT_PHRASE_PATTERNS]
WORD_STEM_COMPILED = [(re.compile(p, re.IGNORECASE), desc) for p, desc in WORD_STEM_PATTERNS]

# A markdown table row (evidence tables, issue vote tables): verbatim
# motion/item text lives in these cells.
TABLE_ROW_RE = re.compile(r"^\s*\|")

# An "Unclassified divided votes" bullet quoting a real agenda-item title
# verbatim — see generateIssuesIndexPage in generate-hub-pages.ts.
SOURCE_TITLE_BULLET_RE = re.compile(r"^\s*-\s+\d{4}-\d{2}-\d{2}\s+—\s+")

# Explicit allowlist for the one legitimate, unrelated prose use of
# "roster": the data-quality concept of a roster (vote-kind bucket)
# conflict — see rosterConflictCount / roster-conflicts.json in
# generate-stances.ts. Not a membership claim; predates and is unrelated to
# the round-5/6 defect class. Matched as a substring so any of these exact,
# already-published wordings is exempt; anything else containing "roster"
# still fails.
ROSTER_DATA_CONFLICT_ALLOW = [
    "roster data conflict",
    "roster-conflicts.json",
    "a roster conflict",
]


def is_verbatim_source_line(line: str) -> bool:
    return bool(TABLE_ROW_RE.match(line) or SOURCE_TITLE_BULLET_RE.match(line))


def is_allowlisted_roster_use(line: str) -> bool:
    lowered = line.lower()
    return any(allowed in lowered for allowed in ROSTER_DATA_CONFLICT_ALLOW)


def main():
    files = sorted(glob.glob(CONTENT_GLOB, recursive=True))
    if not files:
        print("ERROR: no files matched content/election/**/*.md — check CWD (run from repo root)")
        sys.exit(2)

    hits = []
    exempted = 0
    for path in files:
        text = open(path, encoding="utf-8").read()

        # Tier 1: exact phrases, whole file, no exemptions.
        for pattern, desc in EXACT_PHRASE_COMPILED:
            for m in pattern.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                hits.append((path, line_no, desc, m.group(0)))

        # Tier 2: word stems, line by line, skipping verbatim source lines
        # and the allowlisted roster-data-conflict phrasing.
        lines = text.split("\n")
        for i, line in enumerate(lines):
            line_no = i + 1
            if is_verbatim_source_line(line):
                for pattern, _ in WORD_STEM_COMPILED:
                    if pattern.search(line):
                        exempted += 1
                continue
            for pattern, desc in WORD_STEM_COMPILED:
                for m in pattern.finditer(line):
                    if "roster" in desc and is_allowlisted_roster_use(line):
                        exempted += 1
                        continue
                    hits.append((path, line_no, desc, m.group(0)))

    print(f"Scanned {len(files)} files under content/election/.")
    print(f"Exempted {exempted} match(es) as verbatim source quotes or the allowlisted roster-data-conflict phrase (see DETECTION RULE in this file's docstring).")
    if hits:
        print(f"\nFAIL: {len(hits)} membership assertion(s) found:")
        for path, line_no, desc, matched in hits:
            print(f"  {path}:{line_no}  [{desc}]  {matched!r}")
        sys.exit(1)

    print("PASS: zero membership assertions found in content/election/.")


if __name__ == "__main__":
    main()
