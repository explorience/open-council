#!/usr/bin/env python3
"""
Round-4 gate item 2 sweep: re-run the advocacy/apply/request/urge/support
defect-class check over ALL direction-bearing motions, with a pattern that
now also catches application-submission shapes (the 4df11e775c7f defect:
"BE DIRECTED to submit an application to Build Canada Homes" is the same
advocacy-toward-another-government-or-body class as the already-downgraded
c0e0eab57589 "supports the house debate" of a provincial motion, and the
five other corrections.json entries in this class), not just the
letter/urge/request wording the round-3 corrections layer covered.

DETECTION RULE (stated per the round-4 fixer mandate — this is the whole
rule, not a summary of it):

  A direction-bearing motion (verdict confirmed/corrected, axis/polarity
  non-null in the verified batches) MATCHES this sweep if its `quote` or
  `whatAYeaDid` text contains, case-insensitively:

    - "submit an/its/a ... application" / "submit ... application" (the
      application-submission shape added for item 2), OR
    - "apply to" / "apply for" (funding/program application), OR
    - "advocate" (any inflection), OR
    - "urge" (any inflection), OR
    - "be requested to engage/advocate/submit/urge/support/request", OR
    - "supports the house debate" / "supports the following motion"
      (endorsing another government's motion), OR
    - "request the government of ontario/canada" / "request ... province"
      / "request ... federal" / "request ... provincial" (asking another
      government to act/fund, not the City acting itself)

  Each match is then manually dispositioned by reading its full quote:
  TRUE POSITIVE (same advocacy-toward-another-government/body class,
  needs a corrections.json downgrade) vs. FALSE POSITIVE (keyword hit but
  the motion is the City directly deciding/funding/zoning something
  itself, e.g. "the City SHALL apply the following setback" is a City
  standard, not advocacy).

Usage: python3 scripts/election/sweep-advocacy-class.py
"""
import json
import glob
import re

PATTERN = re.compile(
    r"submit(?:ted|ting|s)?\s+(?:an?|its|the)?\s*application"
    r"|apply\s+(?:to|for)\b"
    r"|advocat\w*"
    r"|\burg(?:e|es|ed|ing|ent(?:ly)?)\b"
    r"|be requested to (?:engage|advocate|submit|urge|support|request)"
    r"|supports? the (?:house debate|following motion)"
    r"|request\w* the government of (?:ontario|canada)"
    r"|request\w*[^.]{0,60}\b(?:province|federal|provincial)\b",
    re.IGNORECASE,
)

CORRECTIONS_PATH = "data/election/classify/corrections.json"
BATCH_GLOB = "data/election/classify/batch-*-verified.json"


def main():
    entries = []
    for f in sorted(glob.glob(BATCH_GLOB)):
        entries.extend(json.load(open(f)))

    direction_bearing = [
        e
        for e in entries
        if e["verdict"] in ("confirmed", "corrected") and e.get("axis") is not None
    ]

    corrections = json.load(open(CORRECTIONS_PATH))
    already_downgraded_ids = {
        c["id"] for c in corrections if c["field"] == "axis" and c["now"] is None
    }

    matches = []
    for e in direction_bearing:
        haystack = f"{e.get('quote', '')} {e.get('whatAYeaDid', '')}"
        if PATTERN.search(haystack):
            matches.append(e)

    print(f"Direction-bearing motions scanned: {len(direction_bearing)}")
    print(f"Pattern matches: {len(matches)}\n")

    for e in matches:
        status = "ALREADY DOWNGRADED (corrections.json)" if e["id"] in already_downgraded_ids else "NEEDS REVIEW"
        print(f"--- {e['id']}  [{status}]")
        print(f"    issue={e['issue']} axis={e['axis']} polarity={e['polarity']}")
        print(f"    quote: {e['quote'][:220]}")
        print()


if __name__ == "__main__":
    main()
