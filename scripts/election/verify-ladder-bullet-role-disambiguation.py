#!/usr/bin/env python3
"""
Round-3 gate item 7 verification: proves that whenever two-plus
ladder-exclusion bullets in the SAME decision group would render with the
same opening 40 characters of their whatAYeaDid text (the "distinguishable
only by tally" defect -- see e-peloza.md's Ark Aid day drop-in pair,
1c0f60d005b5/d2ed469d2746), every one of those colliding rows that HAS a
mechanically-derived role (see motionRole in generate-stances.ts:
"amendment" vs "approval of the part") actually carries that role as a
rendered suffix on the actual page -- not just computed and dropped.

METHOD: independently re-derives the same collision test
renderLadderExclusions (generate-hub-pages.ts) applies -- mirrored here in
Python from data/election/stances.json's own ladderExclusions rows (never
re-running or importing the TypeScript) -- then confirms the resulting
"<Vote>: <rendered whatAYeaDid> (<role>)" text is actually present,
verbatim, somewhere on the corresponding councillor page. This is a
substring existence check, not a full line-for-line reconstruction (the
full bullet also includes the link, date, axisDirection and result, which
this script doesn't need to prove role disambiguation specifically) -- but
the vote+label+role slice is already long and specific enough that a false
positive would require a coincidental duplicate elsewhere on the same
page, which round-2 gate item 6's tally-appending fix and this file's own
verify-ladder-bullets-distinct.py both already guard against independently.

Usage: python3 scripts/election/verify-ladder-bullet-role-disambiguation.py
"""
import json
import re
import sys
from collections import Counter

STANCES_PATH = "data/election/stances.json"

VOTE_LABEL = {
    "yea": "Yea",
    "nay": "Nay",
    "recuse": "Recused",
    "absent": "Absent",
    "abstain": "Abstained",
    "other": "Other",
}

STAGE_SIGNAL_RE = re.compile(r"^recommended\b|\bcommittee stage\b", re.IGNORECASE)
HASH_TAG_RISK_RE = re.compile(r"#(?=\w)")
DOUBLE_SPACE_RE = re.compile(r" {2,}")


def strip_hash_tag_risk(s: str) -> str:
    return DOUBLE_SPACE_RE.sub(" ", HASH_TAG_RISK_RE.sub("No. ", s))


def tcell(s: str) -> str:
    s = strip_hash_tag_risk(s)
    s = s.replace("|", "\\|")
    s = re.sub(r"\r?\n", " ", s)
    return s.strip()


def with_stage_qualifier(what_a_yea_did: str, meeting_type: str) -> str:
    if meeting_type == "Council":
        return what_a_yea_did
    if STAGE_SIGNAL_RE.search(what_a_yea_did):
        return what_a_yea_did
    return f"{what_a_yea_did} (committee stage)"


# Final gate item 1: renderWhatAYeaDid (generate-hub-pages.ts) now
# sentence-cases its label -- applied BEFORE withStageQualifier, same order
# mirrored here -- so a "collision" test built from the raw (lowercase)
# stances.json whatAYeaDid values would no longer match the actual rendered
# page text this script greps for. Mirrors generate-hub-pages.ts's
# sentenceCase exactly.
def sentence_case(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def main():
    stances = json.load(open(STANCES_PATH, encoding="utf-8"))

    collisions_found = 0
    fails = []
    page_text_cache: dict[str, str] = {}

    def page_text(slug: str) -> str:
        if slug not in page_text_cache:
            page_text_cache[slug] = open(
                f"content/election/councillors/{slug}.md", encoding="utf-8"
            ).read()
        return page_text_cache[slug]

    for slug, c in stances["councillors"].items():
        for issue_slug, issue in c["issues"].items():
            for axis in issue.get("axes", []):
                le = axis.get("ladderExclusions", [])
                if not le:
                    continue
                groups: dict[int, list] = {}
                for ex in le:
                    groups.setdefault(ex["decisionGroupIndex"], []).append(ex)

                for group in groups.values():
                    rendered = [
                        (
                            ex,
                            tcell(
                                with_stage_qualifier(
                                    sentence_case(ex["whatAYeaDid"]), ex["meetingType"]
                                )
                            ),
                        )
                        for ex in group
                    ]
                    prefix_counts = Counter(text[:40] for _, text in rendered)
                    for ex, rendered_text in rendered:
                        if prefix_counts[rendered_text[:40]] <= 1:
                            continue
                        collisions_found += 1
                        if not ex.get("role"):
                            # No mechanical role available for this motion --
                            # nothing this script can demand be rendered.
                            continue
                        vote_label = VOTE_LABEL.get(ex["theirVote"], ex["theirVote"])
                        expected = f"{vote_label}: {rendered_text} ({ex['role']})"
                        if expected not in page_text(slug):
                            fails.append(
                                f"{slug}/{issue_slug}/{axis['axis']} decisionGroupIndex="
                                f"{ex['decisionGroupIndex']} motion {ex['motionId']}: "
                                f"expected role-disambiguated text not found on page -- "
                                f"{expected[:160]!r}"
                            )

    print(
        f"Found {collisions_found} ladder-exclusion row(s) whose whatAYeaDid collides "
        f"(same opening 40 chars) with a sibling in its own decision group."
    )

    print()
    if fails:
        print(f"{len(fails)} CHECK(S) FAILED:")
        for f in fails[:50]:
            print(" -", f)
        if len(fails) > 50:
            print(f"   ... and {len(fails) - 50} more")
        sys.exit(1)
    print(
        "ALL CHECKS PASSED -- every colliding ladder-exclusion row with a mechanical "
        "role renders that role as a disambiguating suffix."
    )


if __name__ == "__main__":
    main()
