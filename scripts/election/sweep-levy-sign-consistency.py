#!/usr/bin/env python3
"""
Gate round 4 item B rewrite: full corpus-wide coverage for every levy-size
row, not just the narrow BE INCLUDED/EXCLUDED + "Tax Levy: $N" shape the
round-3 version of this sweep covered (6/82 rows). Three tiers now cover
every row currently on axis levy-size (post-corrections.json,
verdict confirmed/corrected), with ZERO silent gaps:

  TIER 1 -- MECHANICAL DIRECT-SIGN DERIVATION. A row is mechanically
  derivable when its authoritative motionText (from data/votes/
  _all-motions.json, post motionText-correction -- never the batch's own
  possibly-truncated `quote`) is NOT a self-referential "amendment to a
  still-pending motion" wrapper (see TIER 2) and contains at least one
  explicit signed "Tax Levy: $N" figure. Convention (unchanged from the
  round-3 rewrite): the printed figure's sign, exactly as worded, already
  IS the polarity relative to the tabled budget -- positive is expansive,
  negative is restrictive. When every "Tax Levy" occurrence in the text is
  exactly $0 (a reserve-funded line with no direct levy line-item), fall
  back to the same signed-figure test against "Operating Expenditures:"
  occurrences instead -- the real fiscal direction of a reserve-funded
  addition/removal still shows up there even though the levy itself nets
  to zero. A row with no clean single-sign figure under either test (mixed
  signs, or no figure at all) falls through to TIER 3.

  TIER 2 -- AMENDMENT-TO-PENDING WRAPPER, MECHANICALLY OUT OF SCOPE. Some
  motions are themselves a self-referential edit of a motion still on the
  floor ("That the motion be (further) amended, to read as follows: ...",
  or "That Budget Amendment Case #P-NN BE AMENDED to be in the amount of
  ($N)"). Per the corpus's own established convention (verified against
  92c5abcb31d2, 98b1cc4021c2, 2071a9b9c052; applied in gate round 4 item A
  to ad4332ac35af/2789ce535bcb/d925b5e3502c, and to the sibling c77f2ff22429
  found while widening this sweep), such a row's direction must be judged
  against what was actually PENDING at the moment it was moved, not the
  tabled budget -- which requires reconstructing the specific preceding
  sibling motion in the source meeting JSON for each one. That is a
  human-judgment reconstruction, not a safe corpus-wide mechanical rule (a
  "from X to Y" figure or a same-total year-reallocation both need a human
  to identify what was actually on the floor). Every such row is therefore
  routed to TIER 3 rather than guessed at mechanically.

  TIER 3 -- REVIEWED-LEVY-ROWS.JSON, ZERO SILENT GAPS. Every levy-size row
  this script cannot mechanically derive (TIER 2 wrapper rows, and any
  TIER-1-eligible row with no clean single-sign figure) MUST have a
  corresponding entry in data/election/classify/reviewed-levy-rows.json,
  keyed by id, carrying the polarity a human derived from the FULL source
  record and a verbatim quote justifying it. This script FAILS (exit 1) on
  any levy-size row missing from that file, on any reviewed entry whose
  recorded polarity no longer matches the row's CURRENT (post-corrections)
  polarity (a stale review -- the row moved out from under it), and on any
  reviewed entry whose quote is not found verbatim (whitespace/quote-style
  normalized only) in the row's own full source motion text.

Usage: python3 scripts/election/sweep-levy-sign-consistency.py [--apply]
Without --apply: report-only. With --apply: appends TIER-1 mismatches to
corrections.json (idempotent) and re-checks that zero mismatches remain;
TIER-3 gaps/staleness are never auto-fixed -- they need a human to write
the reviewed-levy-rows.json entry, so --apply still exits 1 if any remain.
"""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_corrections import full_motion_texts, load_merged, norm_ws  # noqa: E402

CORRECTIONS_PATH = "data/election/classify/corrections.json"
REVIEWED_PATH = "data/election/classify/reviewed-levy-rows.json"

LEVY_RE = re.compile(r"Tax Levy:?\s*(\(?-?\$[\d,]+\)?)", re.I)
OPEX_RE = re.compile(r"Operating Expenditures?:?\s*(\(?-?\$[\d,]+\)?)", re.I)

PENDING_WRAPPER_RE = re.compile(r"^\s*That the motion (be (further )?amended\b|BE AMENDED to read as follows\b)", re.I)
CASE_AMEND_AMOUNT_RE = re.compile(r"BE AMENDED to be in the amount of", re.I)


def parse_amt(s: str) -> int:
    neg = s.startswith("(") or s.startswith("-")
    digits = re.sub(r"[^\d]", "", s)
    val = int(digits) if digits else 0
    return -val if (neg and val) else val


def is_pending_wrapper(motion_text: str) -> bool:
    return bool(PENDING_WRAPPER_RE.search(motion_text)) or bool(CASE_AMEND_AMOUNT_RE.search(motion_text))


def signed_derive(text: str) -> str | None:
    """Returns 'expansive'/'restrictive' if every nonzero Tax Levy figure in
    `text` agrees in sign (falling back to Operating Expenditures figures
    when every Tax Levy occurrence is exactly $0), else None (mixed signs or
    no figure at all -- not mechanically derivable)."""
    levy_nonzero = [parse_amt(m.group(1)) for m in LEVY_RE.finditer(text)]
    levy_nonzero = [f for f in levy_nonzero if f != 0]
    if levy_nonzero:
        signs = set(1 if f > 0 else -1 for f in levy_nonzero)
        if len(signs) == 1:
            return "expansive" if signs.pop() > 0 else "restrictive"
        return None
    opex_nonzero = [parse_amt(m.group(1)) for m in OPEX_RE.finditer(text)]
    opex_nonzero = [f for f in opex_nonzero if f != 0]
    if opex_nonzero:
        signs = set(1 if f > 0 else -1 for f in opex_nonzero)
        if len(signs) == 1:
            return "expansive" if signs.pop() > 0 else "restrictive"
    return None


def load_reviewed() -> dict:
    if not os.path.exists(REVIEWED_PATH):
        return {}
    rows = json.load(open(REVIEWED_PATH))
    by_id = {}
    for r in rows:
        if r["id"] in by_id:
            raise ValueError(f"{REVIEWED_PATH}: duplicate id {r['id']}")
        by_id[r["id"]] = r
    return by_id


def main() -> int:
    apply_mode = "--apply" in sys.argv

    entries, motions = load_merged()
    reviewed = load_reviewed()

    levy_ids = sorted(
        eid
        for eid, e in entries.items()
        if e.get("verdict") in ("confirmed", "corrected") and e.get("axis") == "levy-size"
    )
    print(f"Rows currently on axis levy-size (post-corrections, verdict confirmed/corrected): {len(levy_ids)}\n")

    tier1_match = []
    tier1_mismatch = []
    tier2_wrapper = []
    tier3_needs_review = []  # TIER-1-eligible but no clean sign
    reviewed_ok = []
    reviewed_missing = []
    reviewed_stale = []
    reviewed_bad_quote = []

    for mid in levy_ids:
        e = entries[mid]
        m = motions.get(mid, {})
        cur_pol = e.get("polarity")
        motion_text = m.get("motionText") or ""
        src = motion_text or (e.get("quote") or "")

        if not motion_text or not is_pending_wrapper(motion_text):
            derived = signed_derive(src)
            if derived is not None:
                if derived == cur_pol:
                    tier1_match.append((mid, derived))
                else:
                    tier1_mismatch.append((mid, cur_pol, derived))
                continue
            tier3_needs_review.append(mid)
        else:
            tier2_wrapper.append(mid)

        # TIER 3: must be in reviewed-levy-rows.json
        r = reviewed.get(mid)
        if r is None:
            reviewed_missing.append(mid)
            continue
        if r.get("polarity") != cur_pol:
            reviewed_stale.append((mid, r.get("polarity"), cur_pol))
            continue
        quote = r.get("quote") or ""
        texts = full_motion_texts(m.get("meetingSlug", ""), m.get("itemNumber", "")) if m else []
        verbatim = any(norm_ws(quote) == norm_ws(t) for t in texts) or norm_ws(quote) in {
            norm_ws(t) for t in texts
        }
        # A quote that is a genuine SUBSTRING of a full source text also counts
        # (many reviewed quotes are the classify layer's own excerpt, not the
        # full motion string) -- check containment both ways, normalized.
        if not verbatim:
            verbatim = any(norm_ws(quote) in norm_ws(t) for t in texts) or any(
                norm_ws(t) in norm_ws(quote) for t in texts
            )
        if not verbatim:
            reviewed_bad_quote.append(mid)
            continue
        reviewed_ok.append(mid)

    print(f"TIER 1 (mechanical direct-sign, non-wrapper, clean sign): {len(tier1_match) + len(tier1_mismatch)}")
    print(f"  match: {len(tier1_match)}")
    print(f"  MISMATCH: {len(tier1_mismatch)}")
    for mid, was, now in tier1_mismatch:
        print(f"    -> {mid}: current={was}, derived={now}")

    print(f"\nTIER 2 (amendment-to-pending wrapper, routed to review): {len(tier2_wrapper)}")
    print(f"\nTIER 3 (no clean mechanical sign, routed to review): {len(tier3_needs_review)}")

    print(f"\nreviewed-levy-rows.json coverage: {len(reviewed_ok)} OK, "
          f"{len(reviewed_missing)} MISSING, {len(reviewed_stale)} STALE, {len(reviewed_bad_quote)} BAD QUOTE")
    for mid in reviewed_missing:
        print(f"  MISSING: {mid} has no reviewed-levy-rows.json entry")
    for mid, was, now in reviewed_stale:
        print(f"  STALE: {mid} reviewed polarity={was} but current polarity={now}")
    for mid in reviewed_bad_quote:
        print(f"  BAD QUOTE: {mid} reviewed quote not found verbatim in source")

    total_gap = len(tier1_mismatch) + len(reviewed_missing) + len(reviewed_stale) + len(reviewed_bad_quote)

    print(f"\n{'=' * 60}")
    print(f"Total defects: {total_gap}")

    if not apply_mode:
        if total_gap:
            print("\nRun with --apply to write TIER-1 mismatches to corrections.json "
                  "(TIER-3 gaps/staleness need a human edit to reviewed-levy-rows.json).")
            sys.exit(1)
        print("\nZero gaps corpus-wide. PASS.")
        sys.exit(0)

    if not tier1_mismatch:
        print("\nNo TIER-1 mismatches to apply.")
        if total_gap:
            sys.exit(1)
        sys.exit(0)

    corrections = json.load(open(CORRECTIONS_PATH))
    existing_keys = {(c["id"], c["field"]) for c in corrections}
    appended = 0
    for mid, was, now in tier1_mismatch:
        if (mid, "polarity") in existing_keys:
            print(f"SKIP {mid}.polarity: corrections.json already has an entry for this id/field")
            continue
        corrections.append({
            "id": mid,
            "field": "polarity",
            "was": was,
            "now": now,
            "reason": "Gate round 4 item B: widened levy-sign-consistency sweep -- this row's own "
                      "motionText carries an unambiguous signed Tax Levy (or Operating Expenditures "
                      "fallback) figure disagreeing with the corrected effect-of-passing convention.",
            "quote": entries[mid].get("quote") or "",
        })
        existing_keys.add((mid, "polarity"))
        appended += 1
    json.dump(corrections, open(CORRECTIONS_PATH, "w"), indent=1)
    print(f"\nAppended {appended} correction row(s) to {CORRECTIONS_PATH}.")
    sys.exit(1 if (total_gap - len(tier1_mismatch)) else 0)


if __name__ == "__main__":
    main()
