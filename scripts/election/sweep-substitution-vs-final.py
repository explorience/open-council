#!/usr/bin/env python3
"""
Round-3 gate item 2 -- PERMANENT SWEEP for the SUBSTITUTION-AMENDMENT vs
UNANIMOUS-FINAL defect class (the same class as the round's three BLOCKER
fixes: 95d5c6f299be, c4cfc1e826ec, d3f2b15062e0). A divided motion whose
operative act is substituting/replacing a revised version of the SAME
instrument (a by-law, a numbered option, a map/schedule) at an item whose
FINAL "as amended" motion in the same meeting JSON passes unanimously, with
every one of the divided motion's nay-voters voting yea on that final
motion, cannot honestly be published as those councillors opposing the
item's substance -- they opposed a document-version/option swap, and
approved the substance unanimously minutes later.

DETECTION RULE (the whole rule, not a summary):

  1. UNIVERSE: every id classified in this tranche's own verified batches
     (batch-40-verified.json .. batch-65-verified.json, the 2018-2022 term
     -- same ERA_BATCH_RANGE convention as sweep-levy-thousands-
     rounding.py) whose data/votes/_all-motions.json row is DIVIDED
     (unanimous == False, nays non-empty) and PASSED (passed == True) -- a
     failed amendment isn't published as a positive stance and is out of
     scope for this defect. Run "corpus-wide" means every one of this
     era's 1,135 motions, not other branches' eras (2015-2017 and
     2023-onward belong to separately-gated tranches on other branches;
     this branch's remit, per era-audit round 3, is 2018-2022 only, and a
     sibling era's own amendment-vs-final shape is that era's own gate's
     business, not this sweep's).

  2. For each such divided motion D, the candidate FINAL motion F is the
     SINGLE, IMMEDIATE next roll call in the same item (same meetingSlug +
     itemNumber, next-higher rollCallOrdinal, adjacency required -- not
     merely "some later unanimous vote in the item"), where:
       a. F.passed is True (a failed final vote absorbs nothing), AND
       b. F.motionText contains the corpus's recurring WRAPPER "as amended"
          phrasing (case-insensitive: "the main motion, as amended BE
          APPROVED", "item N, clause X, as amended, BE APPROVED", "the
          motion to approve the motion, as amended, is put") -- EXCLUDING
          a bare statutory citation that happens to contain the same two
          words ("...section 291(4)(c) of the Municipal Act, 2001, as
          amended, the revised 2019 tax levy ... BE READOPTED"). Without
          this exclusion, every "Municipal Act, 2001, as amended"
          READOPTED-tax-levy roll call in an omnibus item falsely counts
          as a wrapper final for whichever unrelated, independently-numbered
          levy vote happens to sit next to it (2019-02-12 item 8.4.7's
          d747b0b5c3c0/08f4496ab2d0 were exactly this false pairing --
          neither is a real substitution-vs-final candidate), AND
       c. if both D and F name a specific "Case #N" (a budget item can
          bundle many INDEPENDENT business-case roll calls back to back
          under one item number), the numbers must agree -- otherwise D
          and F are two different instruments that merely happen to sit
          adjacent in the same omnibus item, not an amendment and its own
          final (this caught 3 false candidates in testing: Case #2/#4/#6
          divided votes each coincidentally nays-subset-of-yeas against
          the NEXT, unrelated Case #7 vote's own "as amended" wrapper),
          AND
       d. every name in D.nays appears in F.yeas (the actual offsetting
          check -- not just "some passing vote exists later", but THIS
          motion's specific nay-voters all voted yea on it).
     If F fails any of these, D is not a candidate for this defect (most
     divided motions in the corpus have no such absorbing final vote, and
     are unaffected). Adjacency is itself derived from the three confirmed
     BLOCKER pairs, every one of which has its final vote as the very next
     roll call with nothing intervening.

     NOTE, round 4: F is deliberately NOT required to be unanimous. That
     requirement was incidental to the round-3 BLOCKER seeds (all three had
     a 15-0 final) rather than principled -- the actual test is (d), the
     offset itself. The round-4 BLOCKER 61e2cd83874e (2020-08-25 item
     8.2.17, D 13-1 sole nay Helmer) proves the point directly: its own
     final F (144d5e593cc6, "Item 17, clause 3.6, as amended BE APPROVED")
     passes 13-1, NOT unanimously -- Paul Van Meerbergen votes nay on F for
     reasons unrelated to D -- but Helmer, D's sole nay, votes YEA on F.
     Helmer's 13-1 nay is still a document-version-swap vote he then
     approved on the merits, whether or not everyone else agreed with him
     on F. Requiring F.unanimous would let this exact defect shape hide
     behind any OTHER councillor's unrelated dissent on the final vote.

  3. For each candidate (D, F) pair, classify D's OWN motionText (the
     divided motion's operative text, not the whole item) using two
     PRINCIPLED, disjoint text signals -- this is what separates a real
     substitution (no stance) from a real levy/spending amendment (a
     stance), rather than an id whitelist:

       SUBSTITUTION signal (SUBSTITUTION_RE): D's text names swapping in a
       "revised"/"attached revised" by-law, map, schedule, or site plan --
       OR the item's chronologically PRIOR motion (any earlier
       rollCallOrdinal in the same item) FAILED and named a DIFFERENT
       numbered "Option #" than D itself names -- i.e. D is substituting
       in a replacement option after an earlier option failed. Either
       shape swaps WHICH VERSION/OPTION governs; it asserts no new
       content of its own.

       DOLLAR signal (DOLLAR_RE): D's own text contains a dollar figure
       ($\\d). A levy/spending amendment's defining feature is that it
       changes WHAT is funded and by how much -- that dollar figure IS a
       real, distinct stance (see the 9 legitimate budget levy
       amendment-pairs this sweep must not flag: 47529b6bfd4b,
       78a0f0a36c6d, 02b775d6fd9f, 532f9cf65fd9, 4b344c12d54b,
       b12ec4b1e9f6, 0501e1ce7481, a8bbf3d1b972, 9d5a329ad946 -- every one
       carries a "$" figure in its own operative text; none of the three
       confirmed substitution BLOCKERS carries any "$" at all). A dollar
       figure in D's own text takes priority over a SUBSTITUTION match
       (an amendment can rename a document AND change a dollar amount in
       the same clause -- that combination is still a real stance, not a
       bare version swap) and marks D as OUT OF SCOPE for this sweep.

       "D's own text" for this signal is NOT motionText alone (see
       dollar_signal()): D's own _all-motions.json motionText, PLUS -- if D
       has a verified-batch entry -- that entry's own `quote` field, PLUS,
       if D names a specific "Case #N" and neither of those two carries a
       dollar figure, the resolved full source text for D's item (every
       pre_motion_texts/motion_texts/post_motion_texts string under D's
       meetingSlug+itemNumber, via lib_corrections.full_motion_texts --
       the same full text a classify/correction quote is checked against),
       SCOPED to the blob(s) naming that same case number (an unscoped
       whole-item search would attribute a dollar figure belonging to a
       different, unrelated business case in the same omnibus item -- see
       dollar_signal()'s own docstring). This is not optional:
       9ed992fb7625 (SPPC 2020-12-10 item 4.1, "BC #4B BE REDUCED by
       $500,000 annually", 9-6) has an EMPTY motionText -- the $500,000
       figure exists only in its verified quote -- so a motionText-only
       DOLLAR_RE check would silently misclassify a real, 9-6 spending
       stance as a bare-text "ambiguous" hit requiring axis=null, which
       would be exactly as false a statement as the substitution defect
       this sweep exists to catch.

     - SUBSTITUTION matched, no dollar figure -> HIT: this row must be
       axis=null/polarity=null (post corrections.json) for its verified
       entry, OR (if it has no verified entry / was never batch-
       classified this way) present in reviewed-substitution-pairs.json
       with a verbatim-quote reason.
     - DOLLAR matched (regardless of SUBSTITUTION) -> OUT OF SCOPE, not a
       hit. Printed separately as a sanity count so a reviewer can see
       the 9 known levy pairs (and any new ones) were correctly excluded,
       not silently skipped.
     - NEITHER matched -> the structural shape (divided + absorbed by a
       same-item "as amended" final with every nay-voter offset onto its
       yeas) is present but the principled text rule can't classify it. -> HIT,
       same resolution requirement as a SUBSTITUTION hit (axis=null or a
       reviewed-entry with a quote-backed reason) -- conservatively
       treated as needing sign-off, never silently ignored.

  4. RESOLUTION CHECK: for every HIT id that has a verified-batch entry,
     its axis and polarity (after applying corrections.json) must both be
     null. For a HIT id with no verified entry at all (never reached
     batch classification -- structurally possible for a raw
     _all-motions.json row with no counterpart id used anywhere in the
     classify pipeline), it must appear in reviewed-substitution-pairs.json
     instead. Anything else is a FAIL.

Usage: python3 scripts/election/sweep-substitution-vs-final.py
       python3 scripts/election/sweep-substitution-vs-final.py --self-test
Exit 0 with zero unresolved hits (self-test also checks both directions:
reverting a known-fixed BLOCKER id's correction must produce exit 1, and
the real, unmutated state must produce exit 0).
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
CLASSIFY_DIR = REPO_ROOT / "data" / "election" / "classify"
ALL_MOTIONS_PATH = REPO_ROOT / "data" / "votes" / "_all-motions.json"
REVIEWED_PATH = CLASSIFY_DIR / "reviewed-substitution-pairs.json"

ERA_BATCH_RANGE = range(40, 66)  # batches 40-65, the 2018-2022 term -- this branch's remit

AS_AMENDED_RE = re.compile(r"as\s+amended", re.IGNORECASE)
# A bare statutory citation ("...section 291(4)(c) of the Municipal Act,
# 2001, as amended, the revised 2019 tax levy...") is not the corpus's
# wrapper-final phrasing -- it's boilerplate that happens to contain "as
# amended" while citing the Municipal Act's own amendment history. Strip
# it out (see has_wrapper_as_amended below) before testing AS_AMENDED_RE so
# it can't manufacture a false candidate pair out of two unrelated,
# independently-numbered READOPTED-tax-levy roll calls that merely sit
# adjacent in an omnibus item (d747b0b5c3c0/08f4496ab2d0, 2019-02-12 item
# 8.4.7).
MUNICIPAL_ACT_CITATION_RE = re.compile(
    r"Municipal\s+Act,?\s*\d{4},?\s+as\s+amended", re.IGNORECASE
)
SUBSTITUTION_RE = re.compile(
    r"(revised,?\s+by-?law|attached\s+revised|revised,?\s+attached\s+by-?law"
    r"|revised\s+(map|schedule|site\s+plan))",
    re.IGNORECASE,
)
OPTION_RE = re.compile(r"Option\s*#?\s*(\d+)", re.IGNORECASE)
CASE_RE = re.compile(r"Case\s*#\s*(\d+)", re.IGNORECASE)
DOLLAR_RE = re.compile(r"\$\s?\d")


def has_wrapper_as_amended(text: str) -> bool:
    """True if `text` contains the corpus's recurring wrapper-motion "as
    amended" phrasing, after stripping out any bare Municipal Act statutory
    citation that would otherwise false-positive on the same two words."""
    return bool(AS_AMENDED_RE.search(MUNICIPAL_ACT_CITATION_RE.sub("", text)))


def dollar_signal(d: dict, entries: dict[str, dict]) -> bool:
    """True if a dollar figure appears in D's own text: its
    _all-motions.json motionText, or its verified-batch entry's `quote`
    (some divided business-case sub-motions -- e.g. 9ed992fb7625 -- have an
    EMPTY motionText with the dollar figure captured only in the verified
    quote). If NEITHER carries a dollar figure, and D itself names a
    specific "Case #N" (in its motionText or quote), the resolved full
    source text for D's item is checked too -- but SCOPED to the blob(s)
    naming that SAME case number, the same same-instrument identity
    principle the D/F pairing above already applies. An unscoped
    whole-item search would wrongly attribute a dollar figure belonging to
    a DIFFERENT, unrelated business case bundled in the same omnibus item
    (e.g. ca4acfc9e5bd's on-street-parking amendment sharing an item with
    an unrelated $3.1M construction-tender clause, or 5f323e30d9c5's
    genuinely-uncaptured procedural motion sharing an item with an
    unrelated $78,749.83 loan-forgiveness clause) to D, and wrongly
    exclude a motion that carries no dollar figure of its own."""
    entry = entries.get(d["id"])
    quote = (entry.get("quote") or "") if entry else ""
    own_text = (d.get("motionText") or "") + " " + quote
    if DOLLAR_RE.search(own_text):
        return True
    d_cases = set(CASE_RE.findall(own_text))
    if not d_cases:
        return False
    for t in lc.full_motion_texts(d["meetingSlug"], d["itemNumber"]):
        if set(CASE_RE.findall(t)) & d_cases and DOLLAR_RE.search(t):
            return True
    return False

# The 9 confirmed-legitimate budget levy amendment-pairs (gate round 3,
# distinct spending stances) -- kept ONLY as a printed cross-check that the
# principled dollar-signal rule still excludes them; the exclusion itself is
# the DOLLAR_RE test above, not this set (removing this set changes nothing
# about detection, only the sanity-count printout).
KNOWN_LEGIT_LEVY_IDS = {
    "47529b6bfd4b", "78a0f0a36c6d", "02b775d6fd9f", "532f9cf65fd9",
    "4b344c12d54b", "b12ec4b1e9f6", "0501e1ce7481", "a8bbf3d1b972",
    "9d5a329ad946",
}

# The 4 confirmed substitution BLOCKERS fixed so far (3 from round 3, plus
# round 4's 61e2cd83874e) -- printed as a cross-check that the sweep still
# finds them (not load-bearing for detection).
KNOWN_FIXED_SUBSTITUTION_IDS = {
    "95d5c6f299be", "c4cfc1e826ec", "d3f2b15062e0", "61e2cd83874e",
}


def load_reviewed() -> dict[str, dict]:
    if not REVIEWED_PATH.exists():
        return {}
    return {r["id"]: r for r in json.loads(REVIEWED_PATH.read_text())}


def load_era_ids() -> set[str]:
    ids: set[str] = set()
    for n in ERA_BATCH_RANGE:
        f = CLASSIFY_DIR / f"batch-{n}-verified.json"
        if not f.exists():
            continue
        for e in json.loads(f.read_text()):
            ids.add(e["id"])
    return ids


def find_candidates(all_motions: list[dict], era_ids: set[str]) -> list[tuple[dict, dict]]:
    by_item: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for m in all_motions:
        by_item[(m["meetingSlug"], m["itemNumber"])].append(m)

    pairs: list[tuple[dict, dict]] = []
    for group in by_item.values():
        if len(group) < 2:
            continue
        group_sorted = sorted(group, key=lambda m: m["rollCallOrdinal"])
        for i, d in enumerate(group_sorted):
            if d["id"] not in era_ids:
                continue
            if d.get("unanimous") or not d.get("passed"):
                continue
            if not d.get("nays"):
                continue
            if i + 1 >= len(group_sorted):
                continue
            # F must be the IMMEDIATE next roll call in the item -- not
            # merely some later unanimous vote in the same item number.
            # Real substitution-vs-final pairs (all three confirmed
            # BLOCKERS) have the wrapper "as amended" final vote directly
            # follow the amendment it absorbs, with nothing intervening; an
            # omnibus item number that bundles many INDEPENDENT roll calls
            # (e.g. a budget item voting on Case #2, #4, #6, #7... as
            # separate business cases one after another) can otherwise
            # produce a coincidental nays-subset-of-yeas match against a
            # LATER, unrelated case's own "as amended" vote -- not this D's
            # final vote at all.
            f = group_sorted[i + 1]
            # F is deliberately NOT required to be unanimous -- see the
            # round-4 docstring note above. The offset check below (every
            # D.nays name in F.yeas) is the actual, principled test; F's
            # own unanimity was incidental to the round-3 15-0 seeds.
            if not f.get("passed"):
                continue
            if not has_wrapper_as_amended(f.get("motionText") or ""):
                continue
            # Same-instrument identity check: adjacency alone still lets a
            # multi-case omnibus item (a budget SPPC item voting Case #6,
            # then Case #7, back to back) pair an unrelated case's "as
            # amended" wrapper with THIS case's divided vote just because
            # they're next to each other. If both D and F name a specific
            # "Case #N" and the numbers differ, they are provably two
            # different instruments, not an amendment-and-its-own-final.
            d_cases = set(CASE_RE.findall(d.get("motionText") or ""))
            f_cases = set(CASE_RE.findall(f.get("motionText") or ""))
            if d_cases and f_cases and d_cases.isdisjoint(f_cases):
                continue
            nays = set(d["nays"])
            yeas_f = set(f.get("yeas") or [])
            if nays and nays.issubset(yeas_f):
                pairs.append((d, f))
    return pairs


def classify(
    d: dict, group_by_item: dict[tuple[str, str], list[dict]], entries: dict[str, dict]
) -> str:
    text = d.get("motionText") or ""
    if dollar_signal(d, entries):
        return "dollar"

    if SUBSTITUTION_RE.search(text):
        return "substitution"

    # Option-swap shape: D names an Option #N, and an earlier motion (lower
    # rollCallOrdinal) in the SAME item FAILED while naming a DIFFERENT
    # Option #M.
    d_opts = set(OPTION_RE.findall(text))
    if d_opts:
        key = (d["meetingSlug"], d["itemNumber"])
        for other in group_by_item.get(key, []):
            if other["id"] == d["id"]:
                continue
            if other["rollCallOrdinal"] >= d["rollCallOrdinal"]:
                continue
            if other.get("passed"):
                continue
            other_opts = set(OPTION_RE.findall(other.get("motionText") or ""))
            if other_opts and other_opts != d_opts:
                return "substitution"

    return "ambiguous"


def run_sweep(corrections_override=None) -> tuple[int, list[str]]:
    all_motions = json.loads(ALL_MOTIONS_PATH.read_text())["motions"]
    by_item: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for m in all_motions:
        by_item[(m["meetingSlug"], m["itemNumber"])].append(m)

    era_ids = load_era_ids()
    pairs = find_candidates(all_motions, era_ids)

    entries = lc.load_verified_entries()
    corrections = (
        corrections_override if corrections_override is not None else lc.load_corrections()
    )
    # Post-correction axis/polarity view (id -> {axis, polarity}); ids with
    # no verified entry simply won't appear here.
    current = {eid: {"axis": e.get("axis"), "polarity": e.get("polarity")} for eid, e in entries.items()}
    for c in corrections:
        if c["id"] in current and c["field"] in ("axis", "polarity"):
            current[c["id"]][c["field"]] = c["now"]

    reviewed = load_reviewed()

    msgs = [
        f"Era universe (batches 40-65, 2018-2022 term): {len(era_ids)} classified motions",
        f"Divided-motion candidates with a same-item 'as amended' final offsetting every nay-voter onto its own yeas: {len(pairs)}",
    ]

    dollar_count = 0
    dollar_excluded: list[tuple[dict, dict]] = []
    substitution_hits: list[tuple[dict, dict, str]] = []
    ambiguous_hits: list[tuple[dict, dict]] = []
    resolved = []
    unresolved = []

    for d, f in pairs:
        klass = classify(d, by_item, entries)
        if klass == "dollar":
            dollar_count += 1
            dollar_excluded.append((d, f))
            continue
        if klass == "substitution":
            substitution_hits.append((d, f, "substitution"))
        else:
            ambiguous_hits.append((d, f))

    all_hits = [(d, f, "substitution") for d, f, _ in substitution_hits] + [
        (d, f, "ambiguous") for d, f in ambiguous_hits
    ]

    for d, f, klass in all_hits:
        mid = d["id"]
        cur = current.get(mid)
        if cur is not None and cur["axis"] is None and cur["polarity"] is None:
            resolved.append((mid, klass, "axis/polarity null via corrections.json"))
        elif mid in reviewed:
            resolved.append((mid, klass, "documented in reviewed-substitution-pairs.json"))
        else:
            unresolved.append((mid, d, f, klass, cur))

    msgs.append(f"  -> excluded as real spending stances (dollar figure in the amendment's own text): {dollar_count}")
    for d, f in sorted(dollar_excluded, key=lambda pair: pair[0]["id"]):
        mid = d["id"]
        cur = current.get(mid)
        msgs.append(
            f"       {mid}  [dollar, stays directional]  {d['meetingSlug']}#{d['itemNumber']}  "
            f"D.result={d.get('result')!r}  current={cur}"
        )
        msgs.append(f"         D.motionText: {(d.get('motionText') or '')[:80]!r}")
        entry = entries.get(mid)
        msgs.append(f"         D.quote:      {((entry or {}).get('quote') or '')[:120]!r}")
    msgs.append(f"  -> substitution-shaped hits: {len(substitution_hits)}")
    msgs.append(f"  -> structurally-flagged but text-ambiguous hits: {len(ambiguous_hits)}")
    msgs.append(f"  -> resolved (null or reviewed): {len(resolved)}")
    for mid, klass, how in sorted(resolved):
        msgs.append(f"       {mid}  [{klass}]  {how}")

    known_fixed_seen = {mid for mid, *_ in resolved} & KNOWN_FIXED_SUBSTITUTION_IDS
    msgs.append(
        f"  -> cross-check: {len(known_fixed_seen)}/{len(KNOWN_FIXED_SUBSTITUTION_IDS)} "
        f"known-fixed BLOCKER ids found and resolved by this sweep: {sorted(known_fixed_seen)}"
    )
    # Cross-check the 9 known-legitimate levy pairs specifically: each is
    # either (a) never a structural candidate at all (its own item has no
    # adjacent unanimous 'as amended' final absorbing its nays -- never at
    # risk of this defect class to begin with), or (b) a candidate that the
    # DOLLAR_RE guard correctly excludes. Either is fine; the one outcome
    # that is NOT fine -- one of these 9 becoming an unresolved substitution
    # or ambiguous HIT -- is a hard failure below (id_class_map), because it
    # would mean the principled rule just misclassified a confirmed real
    # spending stance as a bare document-version swap.
    candidate_ids = {d["id"] for d, _f in pairs}
    id_class_map = {d["id"]: classify(d, by_item, entries) for d, _f in pairs}
    never_candidates = KNOWN_LEGIT_LEVY_IDS - candidate_ids
    correctly_excluded = {i for i in KNOWN_LEGIT_LEVY_IDS if id_class_map.get(i) == "dollar"}
    wrongly_flagged = KNOWN_LEGIT_LEVY_IDS & candidate_ids - correctly_excluded
    msgs.append(
        f"  -> cross-check (9 known-legitimate levy pairs): "
        f"{len(never_candidates)} never structurally at risk, "
        f"{len(correctly_excluded)} correctly excluded as dollar-bearing, "
        f"{len(wrongly_flagged)} WRONGLY flagged as a hit: {sorted(wrongly_flagged)}"
    )

    msgs.append(f"\n{'=' * 60}")
    if unresolved or wrongly_flagged:
        if unresolved:
            msgs.append(f"FAIL: {len(unresolved)} unresolved substitution-vs-final hit(s):")
            for mid, d, f, klass, cur in unresolved:
                msgs.append(f"  {mid}  [{klass}]  {d['meetingSlug']}#{d['itemNumber']}  current={cur}")
                msgs.append(f"    D.motionText: {(d.get('motionText') or '')[:200]!r}")
                msgs.append(f"    D.nays: {d.get('nays')}")
                msgs.append(f"    F.result: {f.get('result')}  F.motionText: {(f.get('motionText') or '')[:120]!r}")
        if wrongly_flagged:
            msgs.append(
                f"FAIL: {len(wrongly_flagged)} known-legitimate levy-pair id(s) misclassified as a "
                f"substitution/ambiguous hit instead of dollar-excluded: {sorted(wrongly_flagged)}"
            )
        return 1, msgs

    msgs.append(
        f"PASS: {len(all_hits)} substitution-vs-final hit(s) corpus-wide, all resolved "
        f"(null or documented reviewed entry)."
    )
    return 0, msgs


# Negative test, both directions: revert one of this round's own confirmed
# fixes (95d5c6f299be's axis correction) to its pre-fix value and confirm
# the sweep catches it (exit 1, id present in the FAIL list), then confirm
# the real, unmutated corrections.json is exit 0.
_SELF_TEST_REVERT_ID = "95d5c6f299be"


def self_test() -> int:
    base = lc.load_corrections()
    idxs = [i for i, c in enumerate(base) if c["id"] == _SELF_TEST_REVERT_ID and c["field"] == "axis"]
    if not idxs:
        print(f"SELF-TEST FAILED: no axis correction found for {_SELF_TEST_REVERT_ID} -- proves nothing")
        return 1
    mutated = list(base)
    del mutated[idxs[-1]]  # drop the axis->null correction; axis reverts to its verified-batch value

    print(f"=== self-test direction 1: revert {_SELF_TEST_REVERT_ID}'s axis correction, expect exit 1 ===")
    code, msgs = run_sweep(corrections_override=mutated)
    print("\n".join(msgs))
    if code != 1:
        print(f"SELF-TEST FAILED: reverting {_SELF_TEST_REVERT_ID}'s axis correction did not produce exit 1")
        return 1
    if not any(_SELF_TEST_REVERT_ID in line for line in msgs):
        print(f"SELF-TEST FAILED: expected {_SELF_TEST_REVERT_ID} to appear in the unresolved list")
        return 1
    print(f" - reverted axis correction -> exit 1 (confirmed flagged)\n")

    print("=== self-test direction 2: restore (real corrections.json), expect exit 0 ===")
    code2, msgs2 = run_sweep()
    print("\n".join(msgs2))
    if code2 != 0:
        print("SELF-TEST FAILED: normal (unmutated) run did not exit 0")
        return 1
    print("\nSELF-TEST PASSED (both directions)")

    print(
        "\n=== self-test direction 3: dollar-carrying substitution-shaped "
        "mutant must classify as 'dollar', not 'substitution' ==="
    )
    # The docstring's DOLLAR-signal claim ("a dollar figure in D's own text
    # takes priority over a SUBSTITUTION match") was previously untested by
    # live data -- none of the 9 known-legitimate levy pairs ALSO matches
    # SUBSTITUTION_RE, so the priority rule itself was never exercised.
    # Plant a synthetic D that matches BOTH signals in its own motionText
    # and confirm DOLLAR wins.
    mutant = {
        "id": "SELF-TEST-DOLLAR-SUBSTITUTION-MUTANT",
        "meetingSlug": "months/2099-01/2099-01-01 Self-Test Meeting",
        "itemNumber": "0.0",
        "motionText": (
            "the proposed, revised, attached by-law BE INTRODUCED, at an "
            "increased cost of $500,000 to the capital budget"
        ),
        "rollCallOrdinal": 1,
    }
    klass = classify(mutant, {}, {})
    if klass != "dollar":
        print(
            f"SELF-TEST FAILED: a mutant matching both SUBSTITUTION_RE and "
            f"DOLLAR_RE classified as {klass!r}, not 'dollar' -- the DOLLAR "
            f"signal no longer takes priority as the docstring claims"
        )
        return 1
    print(" - dollar-carrying substitution-shaped mutant -> classified 'dollar' (confirmed priority)")
    print("\nSELF-TEST PASSED (all directions)")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    code, msgs = run_sweep()
    print("\n".join(msgs))
    return code


if __name__ == "__main__":
    sys.exit(main())
