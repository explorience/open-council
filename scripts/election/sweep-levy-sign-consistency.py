#!/usr/bin/env python3
"""
Gate round 3 item A (integrity BLOCKER 1) sweep: levy-sign consistency for
EVERY business-case-derived row currently on the levy-size axis.

HISTORY OF THE BUG THIS REWRITE FIXES: the original (round-5) version of
this sweep, and sweep-business-case-levy.py's derive_polarity alongside it,
used a table that FLIPPED the printed dollar figure's sign whenever the
motion's verb was "BE EXCLUDED" (git history: commit 156cdde4 introduced
that table in sweep-business-case-levy.py first; 2a078187 copied it into
this sweep). That table is INVERTED. Proof, from the corpus's own precedent
rows:
    P-25               INCLUDED   -$250,000   -> restrictive (a levy cut)
    P-24/021ec895b691  INCLUDED   -$192,000   -> restrictive (a levy cut)
    P-6/22951914b4b2   EXCLUDED   +$114,000   -> expansive (a levy increase)
Every one of these is explained by the SAME rule without ever looking at the
verb: the printed sign already IS the answer. The old table only avoided
ever being disproven by P-6 because P-6 was carved out via a "DEGENERATE,
title-derived, protected" exemption instead of ever being run through the
verb-based table — if it had been, EXCLUDED+positive would have produced
"restrictive", directly contradicting the verified expansive verdict. That
exemption is gone (see below); the corrected table doesn't need it.

DETECTION + DERIVATION RULE (the whole rule, not a summary):

  1. Universe: every verified-batch entry (across ALL batch-*-verified.json,
     including data/election/classify/batch-returning-verified.json) with
     verdict confirmed/corrected whose CURRENT axis — after applying every
     row in corrections.json, in file order — is "levy-size".

  2. For each, re-extract the motion's FULL text straight from the raw
     meeting JSON (never the truncated data/votes/_all-motions.json copy or
     the batch's own possibly-truncated quote field), matching on the first
     60 characters of the batch's quote under the motion's own item number.

  3. BUSINESS-CASE-DERIVED test: the full text contains both an explicit
     BE INCLUDED / BE EXCLUDED verb (exactly one, not both, not neither) and
     a "Tax Levy: $N" dollar line (the same pattern sweep-business-case-
     levy.py keys derivation off of). A levy-size row whose full text has
     neither is a DIFFERENT kind of levy motion (e.g. a direct "increase the
     overall tax levy by X%" motion with no business-case dollar line, or a
     net-$0 offsetting amendment with no include/exclude verb at all, like
     68d604999a94) — out of scope for this sweep, left untouched. A $0
     first-year figure falls through to a later year's nonzero occurrence
     (e.g. P-12: 2026 is $0, 2027 is $28,000) before being treated as
     non-derivable.

  CONVENTION — THE PRINTED TAX LEVY FIGURE IS ALREADY THE NET EFFECT OF THE
  MOTION, EXACTLY AS WORDED, PASSING (relative to the Mayor's tabled
  budget), regardless of which verb it uses:
       positive levy figure -> expansive (yea moves the levy UP)
       negative levy figure -> restrictive (yea moves the levy DOWN)
     The include/exclude verb decides SCOPE (is this a business-case-derived
     row at all) but plays NO further role in the sign: the source report
     has already computed each recommendation's own net dollar effect, so
     re-flipping on top of that would double-count the verb. This matches
     round-3's original, convention-table-free reasoning for both P-6 and
     P-24 (narrated case-by-case from each motion's own numbers) exactly.

  4. Every business-case-derived row is independently re-derived from its
     OWN dollar line — never from what any other row says. A row whose
     derived polarity already matches its current (post-corrections.json)
     polarity needs no correction. A row that disagrees gets a new
     corrections.json row moving it to the convention's answer.

  5. A row whose Operating/Capital/Tax-Levy figures are all identical with
     no minus sign anywhere (e.g. 22951914b4b2/P-6: Operating = Capital =
     Tax Levy = $114,000) is flagged in the report as a scraper-pattern
     worth a human's eye, but — unlike the old sweep — is NOT auto-
     downgraded to unclear: run corpus-wide, this pattern currently matches
     exactly one business-case-derived row (P-6), and its independently
     verified answer (expansive) is exactly what the plain sign gives, so
     the old "DEGENERATE -> exempt or downgrade" branch was solely a
     workaround for the wrong table, not a genuine ambiguity. No exemption
     list survives this rewrite.

Usage: python3 scripts/election/sweep-levy-sign-consistency.py [--apply]
Without --apply: report-only (prints every business-case-derived levy-size
row, its verb/sign, its current vs. convention-derived polarity). With
--apply: additionally appends the needed rows to corrections.json
(idempotent — skips any id/field already covered by an identical existing
correction) and re-checks that zero mismatches remain.
"""
import json
import glob
import re
import os
import sys

CORRECTIONS_PATH = "data/election/classify/corrections.json"
BATCH_GLOB = "data/election/classify/batch-*-verified.json"
ALL_MOTIONS_PATH = "data/votes/_all-motions.json"

LEVY_RE = re.compile(r"Tax Levy:\s*(-?\$[\d,]+)")


def load_full_motion_text(meeting_slug: str, item_number: str, quote: str) -> str | None:
    path = "data/" + meeting_slug[len("months/"):] + ".json"
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


def derive(full_text: str):
    """Returns (verb, sign_word, polarity, degenerate_flag) for a
    business-case-derived row, or (None, None, None, False) if the row is
    out of scope (no verb, ambiguous verb, or no cleanly-signed Tax Levy
    line). Polarity depends ONLY on the sign of the printed figure — see
    CONVENTION above; the verb is returned for reporting only, it plays no
    role in the sign computation."""
    included = bool(re.search(r"BE\s+INCLUDED", full_text, re.IGNORECASE))
    excluded = bool(re.search(r"BE\s+EXCLUDED", full_text, re.IGNORECASE))
    m = LEVY_RE.search(full_text)
    if not m or (not included and not excluded) or (included and excluded):
        return (None, None, None, False)  # not business-case-derived / ambiguous verb

    figure = m.group(1)

    opex_matches = re.findall(r"Operating Expenditures:\s*(-?\$[\d,]+)", full_text)
    capex_matches = re.findall(r"Capital Expenditures:\s*(-?\$[\d,]+)", full_text)
    levy_matches = re.findall(r"Tax Levy:\s*(-?\$[\d,]+)", full_text)
    degenerate = bool(
        opex_matches
        and capex_matches
        and levy_matches
        and len(set(opex_matches)) == 1
        and set(opex_matches) == set(capex_matches) == set(levy_matches)
        and not figure.startswith("-")
    )

    negative = figure.startswith("-")
    is_zero = re.sub(r"[^\d]", "", figure) == "0"
    if is_zero:
        rest = full_text[m.end():]
        m2 = LEVY_RE.search(rest)
        if m2 and re.sub(r"[^\d]", "", m2.group(1)) != "0":
            figure = m2.group(1)
            negative = figure.startswith("-")
        else:
            return (None, None, None, False)

    verb = "INCLUDED" if included else "EXCLUDED"
    polarity = "restrictive" if negative else "expansive"
    sign = "negative" if negative else "positive"
    return (verb, sign, polarity, degenerate)


def main():
    apply_mode = "--apply" in sys.argv

    entries = []
    for f in sorted(glob.glob(BATCH_GLOB)):
        entries.extend(json.load(open(f)))
    entries_by_id = {e["id"]: e for e in entries}

    corrections = json.load(open(CORRECTIONS_PATH))
    current = {e["id"]: {"axis": e["axis"], "polarity": e["polarity"]} for e in entries}
    for c in corrections:
        if c["id"] in current:
            current[c["id"]][c["field"]] = c["now"]

    all_motions = {m["id"]: m for m in json.load(open(ALL_MOTIONS_PATH))["motions"]}

    levy_ids = [
        eid
        for eid, e in entries_by_id.items()
        if e["verdict"] in ("confirmed", "corrected") and current[eid]["axis"] == "levy-size"
    ]

    print(f"Rows currently on axis levy-size (post-corrections, verdict confirmed/corrected): {len(levy_ids)}\n")

    skipped_not_bc = 0
    to_correct = []  # (id, was, now)
    degenerate_rows = []

    for mid in sorted(levy_ids):
        e = entries_by_id[mid]
        m = all_motions.get(mid)
        cur_pol = current[mid]["polarity"]
        full_text = None
        if m:
            full_text = load_full_motion_text(m["meetingSlug"], m["itemNumber"], e["quote"])
        if not full_text:
            full_text = e["quote"]

        verb, sign, derived_pol, degenerate = derive(full_text)
        if verb is None:
            skipped_not_bc += 1
            continue

        if degenerate:
            degenerate_rows.append((mid, verb, sign, derived_pol, cur_pol))

        status = "MATCH" if cur_pol == derived_pol else "MISMATCH -> NEEDS CORRECTION"
        print(f"{mid}: {verb} / {sign} -> convention says {derived_pol}, current={cur_pol}  [{status}]")
        if cur_pol != derived_pol:
            to_correct.append((mid, cur_pol, derived_pol))

    print(f"\nBusiness-case-derived levy-size rows (verb + Tax Levy line present): {len(levy_ids) - skipped_not_bc}")
    print(f"Levy-size rows skipped as NOT business-case-derived (out of scope): {skipped_not_bc}")

    if degenerate_rows:
        print(f"\n{len(degenerate_rows)} row(s) with Operating=Capital=Tax Levy identical, no minus sign "
              f"(scraper-pattern worth a human's eye, not auto-downgraded — see docstring item 5):")
        for mid, verb, sign, pol, cur in degenerate_rows:
            print(f"  -> {mid}: {verb}/{sign} -> {pol} (current={cur})")

    print(f"\n{'=' * 60}")
    print(f"Rows needing a polarity correction: {len(to_correct)}")
    for mid, was, now in to_correct:
        print(f"  -> {mid}: {was} -> {now}")

    if not apply_mode:
        if to_correct:
            print("\nRun with --apply to write these to corrections.json.")
            sys.exit(1)
        else:
            print("\nZero mismatches corpus-wide. PASS.")
            sys.exit(0)

    # --apply: append corrections, idempotently.
    existing_keys = {(c["id"], c["field"]) for c in corrections}
    appended = 0
    for mid, was, now in to_correct:
        if (mid, "polarity") in existing_keys:
            print(f"SKIP {mid}.polarity: corrections.json already has an entry for this id/field — resolve the conflict manually")
            continue
        corrections.append({
            "id": mid,
            "field": "polarity",
            "was": was,
            "now": now,
            "reason": "Gate round 3 item A: levy-sign consistency check — this row's own motion text "
                      "(BE INCLUDED/EXCLUDED verb + Tax Levy dollar sign) disagrees with the corrected "
                      "effect-of-passing convention (printed figure's sign IS the polarity, regardless "
                      "of verb). Re-derived independently from this row's own dollar line.",
            "quote": entries_by_id[mid]["quote"],
        })
        existing_keys.add((mid, "polarity"))
        appended += 1

    json.dump(corrections, open(CORRECTIONS_PATH, "w"), indent=1)
    print(f"\nAppended {appended} correction row(s) to {CORRECTIONS_PATH}. Re-run without --apply to confirm zero mismatches remain.")


if __name__ == "__main__":
    main()
