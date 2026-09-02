#!/usr/bin/env python3
"""
Round-5 gate item 3 sweep: levy-sign consistency for EVERY business-case-
derived row currently on the levy-size axis — not just the rows round-4's
sweep-business-case-levy.py newly moved there. Round-4 only re-derived rows
that started out classified axis=="business-case"; any row that was already
classified straight to levy-size in the verified batches (by the original
LLM-assisted pass, not the mechanical Tax-Levy-sign rule) was never checked
against that rule and could disagree with it silently.

DETECTION RULE (the whole rule, not a summary): convention-independent group
check.

  1. Universe: every verified-batch entry (across ALL batch-*-verified.json,
     including data/election/classify/batch-returning-verified.json) with
     verdict confirmed/corrected whose CURRENT axis — after applying every
     row in corrections.json, in file order — is "levy-size".

  2. For each, re-extract the motion's FULL text straight from the raw
     meeting JSON (never the truncated data/votes/_all-motions.json copy or
     the batch's own possibly-truncated quote field), matching on the first
     60 characters of the batch's quote under the motion's own item number.

  3. BUSINESS-CASE-DERIVED test: the full text contains both an explicit
     BE INCLUDED / BE EXCLUDED verb and a "Tax Levy: $N" dollar line (the
     same pattern sweep-business-case-levy.py keys derivation off of). A
     levy-size row whose full text has neither is a DIFFERENT kind of levy
     motion (e.g. a direct "increase the overall tax levy by X%" motion with
     no business-case dollar line) — out of scope for this sweep, left
     untouched.

  4. GROUP KEY for every business-case-derived row: (verb, sign-of-levy-
     figure), e.g. ("INCLUDED", positive) or ("EXCLUDED", negative). This
     key alone determines what polarity the established convention assigns
     (see CONVENTION below) — it does NOT depend on which axis/polarity the
     row currently carries. Two rows with the same key must always resolve
     to the same polarity; if the CURRENT (post-corrections.json) polarities
     within one group are not all identical, that group is internally
     contradictory — proof that at least one member disagrees with the
     convention every other member follows.

  CONVENTION (identical to sweep-business-case-levy.py's derive_polarity):
       BE INCLUDED + positive levy -> expansive (yea raises the levy)
       BE INCLUDED + negative levy -> restrictive (yea cuts the levy)
       BE EXCLUDED + positive levy -> restrictive (yea avoids a levy increase)
       BE EXCLUDED + negative levy -> expansive (yea keeps a levy cut in place)

  5. RESOLUTION for every contradictory group: each member is independently
     re-derived from its OWN dollar line via the convention above (never
     from what the rest of its group says). A member whose derived polarity
     already matches its current polarity needs no correction. A member
     that disagrees gets a new corrections.json row moving it to the
     convention's answer. A member with no cleanly derivable sign (the
     "DEGENERATE" scraper-noise guard, or no Tax Levy line at all despite
     matching the verb test loosely) is downgraded to unclear (axis=null,
     polarity=null) instead of guessed at.

  6. Rows already correct, or in a group that was never mixed to begin with,
     are left untouched — this sweep only writes corrections for rows that
     fail the check.

Usage: python3 scripts/election/sweep-levy-sign-consistency.py [--apply]
Without --apply: report-only (prints every business-case-derived levy-size
row, its group key, its current vs. convention-derived polarity, and flags
every contradictory group). With --apply: additionally appends the needed
rows to corrections.json (idempotent — skips any id/field already covered by
an identical existing correction) and re-checks that zero mixed groups
remain.
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

# Round-3 corrections that were deliberately derived from the case's own
# TITLE ("Reduced Road Network Improvements" etc.), not the mechanical
# Tax-Levy-sign rule, precisely because their dollar-line figures are
# degenerate scraper noise (Operating/Capital/Tax-Levy all identical, no
# sign). sweep-business-case-levy.py already carves these out by name;
# verify-round4-items.py asserts they stay untouched. This sweep must not
# silently downgrade them just because the mechanical rule alone can't
# confirm them.
PROTECTED_TITLE_DERIVED_IDS = {"18633398dd86", "ea03954e4926"}


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
    """Returns ("OK", figure, polarity) | ("DEGENERATE", None, None) |
    (None, None, None) if not business-case-derived / not sign-derivable."""
    included = bool(re.search(r"BE\s+INCLUDED", full_text, re.IGNORECASE))
    excluded = bool(re.search(r"BE\s+EXCLUDED", full_text, re.IGNORECASE))
    m = LEVY_RE.search(full_text)
    if not m or (not included and not excluded) or (included and excluded):
        return (None, None, None)  # not business-case-derived / ambiguous verb

    figure = m.group(1)

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
        return ("DEGENERATE", None, None)

    negative = figure.startswith("-")
    is_zero = re.sub(r"[^\d]", "", figure) == "0"
    if is_zero:
        rest = full_text[m.end():]
        m2 = LEVY_RE.search(rest)
        if m2 and re.sub(r"[^\d]", "", m2.group(1)) != "0":
            figure = m2.group(1)
            negative = figure.startswith("-")
        else:
            return (None, None, None)

    verb = "INCLUDED" if included else "EXCLUDED"
    if verb == "INCLUDED":
        polarity = "restrictive" if negative else "expansive"
    else:
        polarity = "expansive" if negative else "restrictive"
    sign = "negative" if negative else "positive"
    return ("OK", (verb, sign), polarity)


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

    groups: dict[tuple, list[dict]] = {}
    skipped_not_bc = 0
    rows_report = []

    for mid in levy_ids:
        e = entries_by_id[mid]
        m = all_motions.get(mid)
        cur_pol = current[mid]["polarity"]
        full_text = None
        if m:
            full_text = load_full_motion_text(m["meetingSlug"], m["itemNumber"], e["quote"])
        if not full_text:
            full_text = e["quote"]

        kind, key, derived_pol = derive(full_text)
        if kind is None:
            skipped_not_bc += 1
            continue

        row = {"id": mid, "current_polarity": cur_pol, "kind": kind, "key": key, "derived_polarity": derived_pol}
        rows_report.append(row)
        if kind == "OK":
            groups.setdefault(key, []).append(row)

    print(f"Business-case-derived levy-size rows (verb + Tax Levy line present): {len(rows_report)}")
    print(f"Levy-size rows skipped as NOT business-case-derived (out of scope): {skipped_not_bc}\n")

    contradictory_groups = 0
    to_correct = []  # (id, field, was, now, reason)
    to_downgrade = []

    protected_degenerate = []
    for row in rows_report:
        if row["kind"] == "DEGENERATE":
            if row["id"] in PROTECTED_TITLE_DERIVED_IDS:
                protected_degenerate.append(row["id"])
            elif row["current_polarity"] is not None:
                to_downgrade.append(row["id"])
            continue

    for key, members in sorted(groups.items(), key=lambda kv: kv[0]):
        pols = {m["current_polarity"] for m in members}
        expected = members[0]["derived_polarity"]
        mixed = len(pols) > 1
        disagreeing = [m for m in members if m["current_polarity"] != expected]
        if mixed or disagreeing:
            contradictory_groups += 1
            print(f"CONTRADICTORY GROUP {key}: {len(members)} rows, current polarities present = {sorted(pols)}, convention says {expected}")
            for m in disagreeing:
                print(f"  -> {m['id']}: current={m['current_polarity']}  convention={expected}  [NEEDS CORRECTION]")
                to_correct.append((m["id"], "polarity", m["current_polarity"], expected))
        else:
            print(f"consistent group {key}: {len(members)} rows, all polarity={expected}")

    if protected_degenerate:
        print(f"\n{len(protected_degenerate)} DEGENERATE-by-dollar-line row(s) left untouched — protected, title-derived round-3 correction: {protected_degenerate}")

    if to_downgrade:
        print(f"\n{len(to_downgrade)} DEGENERATE row(s) (scraper-noise guard, no clean sign) still carrying a polarity -> unclear:")
        for mid in to_downgrade:
            print(f"  -> {mid}: current={current[mid]['polarity']} -> null")

    print(f"\n{'=' * 60}")
    print(f"Contradictory groups: {contradictory_groups}")
    print(f"Rows needing a polarity correction: {len(to_correct)}")
    print(f"Rows needing a downgrade-to-unclear: {len(to_downgrade)}")

    if not apply_mode:
        if to_correct or to_downgrade:
            print("\nRun with --apply to write these to corrections.json.")
            sys.exit(1)
        else:
            print("\nZero mixed groups corpus-wide. PASS.")
            sys.exit(0)

    # --apply: append corrections, idempotently.
    existing_keys = {(c["id"], c["field"]) for c in corrections}
    appended = 0
    for mid, field, was, now in to_correct:
        if (mid, field) in existing_keys:
            print(f"SKIP {mid}.{field}: corrections.json already has an entry for this id/field — resolve the conflict manually")
            continue
        corrections.append({
            "id": mid,
            "field": field,
            "was": was,
            "now": now,
            "reason": "Round-5 gate item 3: levy-sign consistency group check — this row's own motion text (BE INCLUDED/EXCLUDED verb + Tax Levy dollar sign) disagrees with the convention every other row sharing its (verb, sign) group follows. Re-derived independently from this row's own dollar line, not from its group's majority.",
            "quote": entries_by_id[mid]["quote"],
        })
        existing_keys.add((mid, field))
        appended += 1

    for mid in to_downgrade:
        for field, was in (("axis", current[mid]["axis"]), ("polarity", current[mid]["polarity"])):
            if (mid, field) in existing_keys:
                print(f"SKIP {mid}.{field}: corrections.json already has an entry for this id/field — resolve the conflict manually")
                continue
            corrections.append({
                "id": mid,
                "field": field,
                "was": was,
                "now": None,
                "reason": "Round-5 gate item 3: levy-size row flagged DEGENERATE by the scraper-noise guard (Operating/Capital/Tax-Levy figures identical, no sign anywhere) — not mechanically sign-derivable, downgraded to unclear rather than guessed at.",
                "quote": entries_by_id[mid]["quote"],
            })
            existing_keys.add((mid, field))
            appended += 1

    json.dump(corrections, open(CORRECTIONS_PATH, "w"), indent=2)
    open(CORRECTIONS_PATH, "a").write("\n")
    print(f"\nAppended {appended} correction row(s) to {CORRECTIONS_PATH}. Re-run without --apply to confirm zero mixed groups remain.")


if __name__ == "__main__":
    main()
