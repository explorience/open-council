#!/usr/bin/env python3
"""
Round-7 gate item 2 verification: corpus-wide arithmetic check proving the
section sentence ("has a recorded position on N of them"), that same
sentence's own "The other N:" footer clause, and every axis's evidence
table agree on the same computed buckets, for every councillor x issue on
every one of the 15 councillor profile pages.

N-SEMANTICS (the definition this check enforces — round-7 gate item 2, the
round-5 defect's third form): a "recorded position" is a recorded YEA or
NAY, nothing else. N = overall.sampleSize (real yea/nay votes counted in
the axis patterns) + overall.ladderExcluded (real yea/nay votes this
councillor actually cast, pulled out of the pattern tally only because they
pointed a different way than a same-decision sibling vote — still a
recorded position, just excluded from pattern aggregation, so it gets its
own parenthetical rather than silently vanishing from or being folded into
N). Recused, absent, abstained, and "other" are NOT positions — they are
reported in their own clause in the same sentence, never counted toward N.

CHECKS (all per councillor x issue, on the actual rendered markdown, not
just re-deriving from stances.json a second time):
  1. Section sentence's N == stances.json overall.sampleSize + ladderExcluded.
  2. Section sentence's ladder parenthetical is present iff ladderExcluded
     > 0, and states the correct count.
  3. Section sentence's recused/absent/abstain/other == stances.json
     overall.{recused,absent,abstain,other}.
  4. Section sentence's own numbers close: divisionsInCorpus == N + recused
     + absent + abstain + other + notOnRoster (re-derived from the
     sentence's own printed numbers, not trusted from stances.json).
  5. Evidence-table arithmetic, independently re-derived from the actual
     rendered table rows across every axis on this issue: counting the
     "Their vote" column, #Yea + #Nay == N, and #Recused + #Absent +
     #Abstained + #Other == recused + absent + abstain + other. Unclear-
     evidence rows (6-column table, no "movedToward" cell) don't match the
     7-column evidence-row pattern and are correctly excluded — they're
     listed for transparency but were never part of any pattern or count.
  6. No issue silently drops off the rendered page: every issue key present
     in stances.json for a councillor has a matching "### [" section on
     that councillor's page, and vice versa.

Usage: python3 scripts/election/verify-n-semantics.py
"""
import glob
import json
import re
import sys

STANCES_PATH = "data/election/stances.json"
COUNCILLOR_GLOB = "content/election/councillors/*.md"

SECTION_RE = re.compile(r"^### \[[^\]]*\]\(/election/issues/([a-z0-9-]+)\)$")

SENTENCE_RE = re.compile(
    r"^\*Of the (\d+) divided votes on this issue since 2023 that had a clear direction, "
    r"this councillor has a recorded position on (\d+) of them"
    r"(?: \((\d+) of these are excluded from the pattern counts — see below\))?\. "
    r"(\d+) recused, (\d+) absent(?:, (\d+) abstained, (\d+) other)?\."
    r"(?: The other (\d+): [^*]*)?\*"
)

# Councillor-page axis evidence rows: | date | item | excerpt | whatAYeaDid |
# vote | movedToward | result | — same shape as sweep-failed-motion-yea.py's
# ROW_RE_7COL. The unclear-evidence table (6 columns, no movedToward cell)
# structurally does not match this pattern, so those rows are correctly
# excluded from every count below without any extra filtering.
EVIDENCE_ROW_RE = re.compile(
    r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|(.*?)\|(.*?)\|(.*?)\|\s*(Yea|Nay|Recused|Absent|Abstained|Other)\s*\|(.*?)\|(.*?)\|\s*$"
)


def main():
    stances = json.load(open(STANCES_PATH, encoding="utf-8"))
    councillors = stances["councillors"]

    errors = []
    checked = 0
    councillor_files = [
        p for p in sorted(glob.glob(COUNCILLOR_GLOB)) if not p.endswith("/index.md")
    ]
    if not councillor_files:
        print("ERROR: no councillor pages matched — check CWD (run from repo root)")
        sys.exit(2)

    for path in councillor_files:
        slug = path.rsplit("/", 1)[-1][: -len(".md")]
        if slug not in councillors:
            errors.append(f"{path}: no stances.json entry for slug {slug!r}")
            continue
        c = councillors[slug]
        lines = open(path, encoding="utf-8").read().split("\n")

        # Segment into per-issue chunks by "### [" headings.
        chunks = []  # (issue_slug, [lines])
        chunk_start = None
        chunk_slug = None
        for i, line in enumerate(lines):
            m = SECTION_RE.match(line)
            if m:
                if chunk_start is not None:
                    chunks.append((chunk_slug, lines[chunk_start:i]))
                chunk_start = i
                chunk_slug = m.group(1)
        if chunk_start is not None:
            chunks.append((chunk_slug, lines[chunk_start:]))

        seen_issue_slugs = set()
        for issue_slug, chunk_lines in chunks:
            seen_issue_slugs.add(issue_slug)
            if issue_slug not in c["issues"]:
                errors.append(
                    f"{path}: page has a section for issue {issue_slug!r} not in stances.json for {slug!r}"
                )
                continue
            issue = c["issues"][issue_slug]
            o = issue["overall"]
            checked += 1

            sentence_line = next(
                (l for l in chunk_lines if l.startswith("*Of the ")), None
            )
            if sentence_line is None:
                errors.append(f"{path} [{issue_slug}]: no section sentence found")
                continue
            m = SENTENCE_RE.match(sentence_line)
            if not m:
                errors.append(
                    f"{path} [{issue_slug}]: section sentence didn't match expected shape: {sentence_line!r}"
                )
                continue
            total_s, n_s, ladder_s, recused_s, absent_s, abstain_s, other_s, notonroster_s = m.groups()
            total = int(total_s)
            n = int(n_s)
            ladder = int(ladder_s) if ladder_s is not None else 0
            recused = int(recused_s)
            absent = int(absent_s)
            abstain = int(abstain_s) if abstain_s is not None else 0
            other = int(other_s) if other_s is not None else 0
            not_on_roster = int(notonroster_s) if notonroster_s is not None else 0

            expected_n = o["sampleSize"] + o["ladderExcluded"]
            if n != expected_n:
                errors.append(
                    f"{path} [{issue_slug}]: sentence N={n} != stances.json sampleSize+ladderExcluded={expected_n}"
                )
            if ladder != o["ladderExcluded"]:
                errors.append(
                    f"{path} [{issue_slug}]: sentence ladder count={ladder} != stances.json ladderExcluded={o['ladderExcluded']}"
                )
            if (ladder_s is not None) != (o["ladderExcluded"] > 0):
                errors.append(
                    f"{path} [{issue_slug}]: ladder parenthetical presence disagrees with ladderExcluded>0 (present={ladder_s is not None}, ladderExcluded={o['ladderExcluded']})"
                )
            if recused != o["recused"]:
                errors.append(
                    f"{path} [{issue_slug}]: sentence recused={recused} != stances.json recused={o['recused']}"
                )
            if absent != o["absent"]:
                errors.append(
                    f"{path} [{issue_slug}]: sentence absent={absent} != stances.json absent={o['absent']}"
                )
            if abstain != o["abstain"]:
                errors.append(
                    f"{path} [{issue_slug}]: sentence abstain={abstain} != stances.json abstain={o['abstain']}"
                )
            if other != o["other"]:
                errors.append(
                    f"{path} [{issue_slug}]: sentence other={other} != stances.json other={o['other']}"
                )
            if total != issue["divisionsInCorpus"]:
                errors.append(
                    f"{path} [{issue_slug}]: sentence total={total} != stances.json divisionsInCorpus={issue['divisionsInCorpus']}"
                )
            if not_on_roster != issue["notOnRoster"]:
                errors.append(
                    f"{path} [{issue_slug}]: sentence's notOnRoster clause={not_on_roster} != stances.json notOnRoster={issue['notOnRoster']}"
                )
            if total != n + recused + absent + abstain + other + not_on_roster:
                errors.append(
                    f"{path} [{issue_slug}]: sentence's own numbers don't add up: {total} != {n}+{recused}+{absent}+{abstain}+{other}+{not_on_roster}"
                )

            yea_nay_rows = 0
            other_vote_rows = 0
            for line in chunk_lines:
                rm = EVIDENCE_ROW_RE.match(line)
                if not rm:
                    continue
                vote = rm.group(5)
                if vote in ("Yea", "Nay"):
                    yea_nay_rows += 1
                else:
                    other_vote_rows += 1
            if yea_nay_rows != n:
                errors.append(
                    f"{path} [{issue_slug}]: evidence tables have {yea_nay_rows} yea/nay row(s), sentence claims N={n}"
                )
            expected_other_rows = recused + absent + abstain + other
            if other_vote_rows != expected_other_rows:
                errors.append(
                    f"{path} [{issue_slug}]: evidence tables have {other_vote_rows} non-yea/nay row(s), sentence claims {expected_other_rows} (recused+absent+abstain+other)"
                )

        for issue_slug in c["issues"]:
            if issue_slug not in seen_issue_slugs:
                errors.append(
                    f"{path}: stances.json has issue {issue_slug!r} for {slug!r} but no section rendered on the page"
                )

    print(
        f"Checked {checked} councillor x issue section(s) across {len(councillor_files)} councillor profile page(s)."
    )
    if errors:
        print(f"\nFAIL: {len(errors)} arithmetic disagreement(s):")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    print(
        "PASS: section sentence, its own footer clause, and every axis's evidence table agree on the same buckets, on every councillor x issue."
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
