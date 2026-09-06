#!/usr/bin/env python3
"""
Round-4 gate item 3 sweep: the business-case axis pools fiscally opposite
effects under one direction-agnostic "included/excluded" label. This finds
every business-case-axis motion whose FULL text (re-extracted from the raw
meeting JSON, not the 500-char-truncated data/votes/_all-motions.json copy)
carries an explicit "Tax Levy" dollar line, and derives a real fiscal
polarity from the SIGN of that line together with the include/exclude verb.

DETECTION + DERIVATION RULE (the whole rule, not a summary):

  1. Universe: every verified-batch entry with verdict confirmed/corrected
     and axis == "business-case" (including entries corrections.json has
     already moved off business-case in a prior round — checked against
     the CURRENT corrections.json so this sweep is idempotent/re-runnable).

  2. For each, re-extract the motion's full text straight from the raw
     meeting JSON (data/<meetingSlug minus "months/">.json, item
     `itemNumber`, matched against the batch entry's `quote`) rather than
     trusting the batch `quote`/`whatAYeaDid` fields, which can themselves
     be truncated excerpts.

  3. MATCH: the full text contains a "Tax Levy" dollar line — regex
     r"Tax Levy:\s*(-?\$[\d,]+)" — for the year matching the case's own
     first stated Operating/Tax Levy pair (first occurrence is used; a
     case with $0 in year 1 and a nonzero figure in year 2, e.g. P-12,
     falls through to the year-2 occurrence since $0 carries no sign to
     derive from).

  4. POLARITY for a MATCH is derived from the SIGN of that dollar figure
     ALONE (Gate round 3 item A correction: the original version of this
     rule flipped the sign for BE EXCLUDED rows, which is INVERTED — see
     sweep-levy-sign-consistency.py's docstring for the full proof from the
     corpus's own precedent rows, P-25/P-24/P-6). The printed Tax Levy
     figure already IS the net effect of the motion, exactly as worded,
     passing — the include/exclude verb plays no further role once the
     dollar line is found:
       - positive levy figure -> expansive (yea moves the levy UP)
       - negative levy figure -> restrictive (yea moves the levy DOWN)
     Axis is reclassified from "business-case" to "levy-size" for every
     MATCH whose derived (axis, polarity) differs from its current
     (axis, polarity) in the verified batches after existing corrections.

  5. NO MATCH (no "Tax Levy" dollar line anywhere in the full text): the
     row lacks a derivable fiscal direction. Downgraded to unclear (axis
     and polarity both -> null) via corrections.json.

Usage: python3 scripts/election/sweep-business-case-levy.py
Prints every business-case-axis row, its full-text Tax Levy line (if any),
the derived disposition, and whether corrections.json already reflects it.
"""
import json
import glob
import re
import os

CORRECTIONS_PATH = "data/election/classify/corrections.json"
BATCH_GLOB = "data/election/classify/batch-*-verified.json"
ALL_MOTIONS_PATH = "data/votes/_all-motions.json"

LEVY_RE = re.compile(r"Tax Levy:\s*(-?\$[\d,]+)")

# Gate round 3 item A: 1d7c40b467ec is the SAME underlying business case as
# 22951914b4b2/P-6 ("Reduced Road Network Improvements", Appendix B Ref#2) at
# an earlier, preliminary procedural stage (2025-05-22) whose own clause
# carries no Tax Levy dollar line at all (that only appears in the later,
# formal 2025-11-20 vote) — not mechanically sign-derivable by this script,
# but manually aligned via corrections.json onto its sibling's verified
# direction (expansive) rather than left unclear. See that correction's
# reason for the full title-based derivation.
NO_LEVY_LINE_TITLE_DERIVED_IDS = {"1d7c40b467ec"}


def load_full_motion_text(meeting_slug: str, item_number: str, quote: str) -> str | None:
    """Re-extract the exact motion's full text from the raw meeting JSON by
    matching the FIRST ~60 chars of the batch's own `quote` against each
    candidate motion under that item number — avoids relying on the
    truncated _all-motions.json copy."""
    path = "data/" + meeting_slug[len("months/") :] + ".json"
    if not os.path.exists(path):
        return None
    raw = json.load(open(path))
    parts = item_number.split(".")
    cur = raw["items"]
    node = None
    try:
        for p in parts:
            node = cur[p]
            cur = node.get("items", {})
    except (KeyError, TypeError):
        return None

    needle = quote.strip()[:60]

    def walk(n):
        for c in n.get("content", []):
            if isinstance(c, dict) and (c.get("__class__") == "Motion" or "motion_texts" in c):
                texts = []
                for mt in c.get("motion_texts", []):
                    s = mt.get("string") if isinstance(mt, dict) else mt
                    if s:
                        texts.append(s)
                full = " ".join(texts)
                if needle in full:
                    return full
        for sub in n.get("items", {}).values():
            found = walk(sub)
            if found:
                return found
        return None

    return walk(node)


def derive_polarity(full_text: str) -> tuple[str, str] | None:
    """Returns (sign_word, polarity) or None if no Tax Levy line found."""
    m = LEVY_RE.search(full_text)
    if not m:
        return None
    figure = m.group(1)

    # Degenerate-scrape guard: some rows (e.g. 18633398dd86) show the exact
    # same figure repeated for Operating Expenditures, Tax Levy, AND Capital
    # Expenditures with no minus sign anywhere in the text — three normally-
    # distinct dollar categories collapsing to one identical unsigned number
    # is itself evidence the source table's sign/structure didn't survive
    # scraping, not evidence of a genuine positive figure. Treated as NOT
    # sign-derivable by this mechanical rule (round-3's existing correction
    # on 18633398dd86, which instead reasoned from the case's own title —
    # "Reduced Road Network Improvements" is a cut/savings case — stands;
    # this sweep does not overwrite it with a naive misread of scraper
    # noise).
    opex_matches = re.findall(r"Operating Expenditures:\s*(-?\$[\d,]+)", full_text)
    capex_matches = re.findall(r"Capital Expenditures:\s*(-?\$[\d,]+)", full_text)
    levy_matches = re.findall(r"Tax Levy:\s*(-?\$[\d,]+)", full_text)
    if (
        opex_matches
        and capex_matches
        and levy_matches
        and len(set(opex_matches)) == 1
        and set(opex_matches) == set(capex_matches) == set(levy_matches)
        and not figure.startswith("-")
    ):
        return "DEGENERATE"

    negative = figure.startswith("-")
    is_zero = re.sub(r"[^\d]", "", figure) == "0"
    if is_zero:
        # $0 for this year's line — look for a second, later occurrence
        # with a nonzero figure (e.g. P-12: 2026 is $0, 2027 is $28,000).
        rest = full_text[m.end() :]
        m2 = LEVY_RE.search(rest)
        if m2 and re.sub(r"[^\d]", "", m2.group(1)) != "0":
            figure = m2.group(1)
            negative = figure.startswith("-")
        else:
            return None  # every levy figure found is $0 — no direction

    included = bool(re.search(r"BE\s+INCLUDED", full_text, re.IGNORECASE))
    excluded = bool(re.search(r"BE\s+EXCLUDED", full_text, re.IGNORECASE))
    if included == excluded:
        return None  # neither or both verbs present — ambiguous, don't guess
    # Gate round 3 item A: sign alone decides polarity, regardless of verb —
    # see sweep-levy-sign-consistency.py's docstring for the full proof.
    return (figure, "restrictive" if negative else "expansive")


def main():
    entries = []
    for f in sorted(glob.glob(BATCH_GLOB)):
        entries.extend(json.load(open(f)))
    entries_by_id = {e["id"]: e for e in entries}

    corrections = json.load(open(CORRECTIONS_PATH))
    # Reconstruct each id's CURRENT axis/polarity after existing corrections.
    current = {e["id"]: {"axis": e["axis"], "polarity": e["polarity"]} for e in entries}
    for c in corrections:
        if c["id"] in current:
            current[c["id"]][c["field"]] = c["now"]

    all_motions = {m["id"]: m for m in json.load(open(ALL_MOTIONS_PATH))["motions"]}

    business_case_ids = [
        e["id"]
        for e in entries
        if e["verdict"] in ("confirmed", "corrected") and e.get("axis") == "business-case"
    ]

    print(f"Business-case-axis rows in verified batches (pre-correction): {len(business_case_ids)}\n")

    for mid in business_case_ids:
        e = entries_by_id[mid]
        m = all_motions.get(mid)
        cur = current[mid]
        full_text = None
        if m:
            full_text = load_full_motion_text(m["meetingSlug"], m["itemNumber"], e["quote"])
        if not full_text:
            full_text = e["quote"]  # fallback

        derived = derive_polarity(full_text)
        if derived == "DEGENERATE":
            print(
                f"--- {mid}  current=({cur['axis']}, {cur['polarity']})  "
                f"-> DEGENERATE (Operating/Tax Levy/Capital all identical, no sign — "
                f"not mechanically sign-derivable; round-3's title-based correction stands)  "
                f"[NOT RE-DERIVED]"
            )
            continue
        if derived:
            figure, polarity = derived
            target_axis = "levy-size"
            disposition = f"levy-size / {polarity} (Tax Levy {figure})"
        elif mid in NO_LEVY_LINE_TITLE_DERIVED_IDS:
            print(
                f"--- {mid}  current=({cur['axis']}, {cur['polarity']})  "
                f"-> no Tax Levy line in this clause — title-derived, aligned to sibling "
                f"22951914b4b2 via corrections.json  [NOT RE-DERIVED]"
            )
            continue
        else:
            target_axis = None
            polarity = None
            disposition = "unclear (no derivable Tax Levy sign)"

        matches_current = cur["axis"] == target_axis and cur["polarity"] == polarity
        status = "MATCHES corrections.json" if matches_current else "corrections.json OUT OF SYNC"

        print(f"--- {mid}  current=({cur['axis']}, {cur['polarity']})  -> {disposition}  [{status}]")

    print(f"\nTotal scanned: {len(business_case_ids)}")


if __name__ == "__main__":
    main()
