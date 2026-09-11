#!/usr/bin/env python3
"""
Gate round 3 item B (neutrality BLOCKER) CLASS guard: a motion downgraded to
issue=none/unclear because it turned out to have no real content of its own
(the wrapper_preamble trap, e.g. de0c7139026d/"That item 14, clause 3.9, as
amended, BE APPROVED.") can have SIBLING motions -- other readings, other
committee-stage recommendations, other amendments -- of the exact SAME
underlying planning application that were never checked and still carry a
direction claim. This sweep does not chase this round's specific ids; it
targets the CLAIM CLASS: any pair of motions that (a) reference the same
planning-file token and (b) sit within one meeting of each other in time,
where one of the pair has been corrected to unclear/none and the other still
asserts a direction.

DETECTION RULE (the whole rule, not a summary):

  1. ANCHOR universe: every verified-batch entry (verdict confirmed/
     corrected) whose CURRENT (post-corrections.json) axis is null OR
     polarity is null, AND which corrections.json has actually touched on
     field axis/polarity/issue (i.e. a motion the classify pipeline itself
     left unclear from the start is not an anchor -- only a motion that WAS
     given a direction and was subsequently corrected away from it, since
     that correction is exactly the kind of defect a sibling motion could
     silently share).

  2. TOKEN EXTRACTION, run on every anchor AND every candidate (step 3)
     alike: normalize the motion's own full text (needle-matched against
     the raw meeting JSON, not the truncated copy) plus its item's own
     `title` string (which routinely carries the case reference even when
     the operative clause itself does not -- see de0c7139026d, whose own
     text is a bare "BE APPROVED" but whose item title reads "(OZ-8709)
     (Relates to Bill No. 58 and Bill No. 71)"), through six patterns:
     OZ-\\d+, Z-\\d+, 39T-\\d+, H-\\d+, "Bill No[.]['s] N", "Case #[A-Z]?-?N".
     Case-insensitive, tokens normalized to uppercase. A motion's token set
     may be empty (most motions cite no planning-file number at all).

  3. CANDIDATE universe: every verified-batch entry that is currently
     direction-bearing (verdict confirmed/corrected, axis AND polarity both
     non-null).

  4. PAIRING: for every anchor with >=1 token and every candidate sharing
     >=1 of those tokens, the pair is FLAGGED if the two motions are in the
     SAME meeting (identical meetingSlug) OR within 60 days of each other
     (by each motion's own `date`).

  5. RESOLUTION: a flagged pair is resolved by EITHER (a) a corrections.json
     row on the candidate's id that also nulls its axis or polarity (i.e.
     the next sweep run no longer finds it in the candidate universe), OR
     (b) an entry in reviewed-planning-pairs.json naming this exact
     (anchor_id, candidate_id) pair with a reason quoting BOTH motions'
     own operative text, explaining why the candidate's direction is
     genuinely warranted despite sharing the anchor's token (e.g. a
     different, independently-evidenced clause of the same application).
     No blanket exemption by token, meeting, or applicant name -- every
     pair needs its own entry.

  6. PASS requires zero unresolved pairs. FAIL (exit 1) lists every one,
     with both motions' quotes, for a human or a follow-up correction to
     resolve.

Usage: python3 scripts/election/sweep-planning-token-siblings.py
"""
import json
import os
import re
import sys
import datetime

sys.path.insert(0, os.path.dirname(__file__))
import lib_corrections as lc  # noqa: E402

REVIEWED_PAIRS_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "data", "election", "classify", "reviewed-planning-pairs.json"
)

TOKEN_PATTERNS = [
    re.compile(r"\bOZ-\d+\b", re.IGNORECASE),
    re.compile(r"\bZ-\d+\b"),
    re.compile(r"\b39T-\d+\b", re.IGNORECASE),
    re.compile(r"\bH-\d+\b"),
    re.compile(r"\bBill No\.?'?s?\s*\d+\b", re.IGNORECASE),
    re.compile(r"\bCase\s*#\s*[A-Z]?-?\d+\b", re.IGNORECASE),
]

_meeting_cache: dict[str, object] = {}


def meeting_json(slug: str):
    if slug not in _meeting_cache:
        path = "data/" + slug[len("months/"):] + ".json"
        _meeting_cache[slug] = json.load(open(path)) if os.path.exists(path) else None
    return _meeting_cache[slug]


def item_node(slug: str, item_number: str):
    raw = meeting_json(slug)
    if raw is None:
        return None
    cur = raw["items"]
    node = None
    for p in item_number.split("."):
        node = cur.get(p)
        if node is None:
            return None
        cur = node.get("items", {})
    return node


def needle_text(slug: str, item_number: str, quote: str) -> str | None:
    node = item_node(slug, item_number)
    if node is None:
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


def extract_tokens(text: str) -> set[str]:
    text = lc.norm_ws(text)
    toks = set()
    for rx in TOKEN_PATTERNS:
        for m in rx.finditer(text):
            toks.add(re.sub(r"\s+", " ", m.group(0)).upper())
    return toks


def full_text_for(eid: str, entries: dict, motions: dict) -> str:
    e = entries[eid]
    parts = [e.get("quote", "")]
    m = motions.get(eid)
    if m:
        nt = needle_text(m["meetingSlug"], m["itemNumber"], e["quote"])
        if nt:
            parts.append(nt)
        node = item_node(m["meetingSlug"], m["itemNumber"])
        if node and node.get("title"):
            parts.append(node["title"])
    return " ".join(parts)


def get_date(eid: str, motions: dict) -> datetime.date | None:
    m = motions.get(eid)
    if not m:
        return None
    try:
        return datetime.date.fromisoformat(m.get("date"))
    except Exception:
        return None


def main():
    entries, motions = lc.load_merged()
    corrections = lc.load_corrections()

    touched_ids = {row["id"] for row in corrections if row["field"] in ("axis", "polarity", "issue")}
    anchor_ids = sorted(
        eid
        for eid in touched_ids
        if entries.get(eid)
        and entries[eid]["verdict"] in ("confirmed", "corrected")
        and (entries[eid]["axis"] is None or entries[eid]["polarity"] is None)
    )

    token_cache: dict[str, set[str]] = {}

    def tokens_for(eid):
        if eid not in token_cache:
            token_cache[eid] = extract_tokens(full_text_for(eid, entries, motions))
        return token_cache[eid]

    anchor_tokens = {eid: tokens_for(eid) for eid in anchor_ids if tokens_for(eid)}
    print(f"Anchors (corrected to unclear/none, verdict confirmed/corrected): {len(anchor_ids)}")
    print(f"Anchors carrying >=1 planning-file token: {len(anchor_tokens)}\n")

    candidate_ids = [
        eid
        for eid, e in entries.items()
        if e["verdict"] in ("confirmed", "corrected") and e["axis"] is not None and e["polarity"] is not None
    ]
    print(f"Direction-bearing candidates corpus-wide: {len(candidate_ids)}\n")

    reviewed = json.load(open(REVIEWED_PAIRS_PATH)) if os.path.exists(REVIEWED_PAIRS_PATH) else []
    reviewed_keys = {(r["anchor_id"], r["candidate_id"]) for r in reviewed}

    flagged = []
    for anchor_id, a_toks in anchor_tokens.items():
        a_date = get_date(anchor_id, motions)
        a_slug = motions[anchor_id]["meetingSlug"] if motions.get(anchor_id) else None
        for cand_id in candidate_ids:
            if cand_id == anchor_id:
                continue
            shared = a_toks & tokens_for(cand_id)
            if not shared:
                continue
            c_date = get_date(cand_id, motions)
            c_slug = motions[cand_id]["meetingSlug"] if motions.get(cand_id) else None
            same_meeting = a_slug is not None and a_slug == c_slug
            within_60 = a_date and c_date and abs((a_date - c_date).days) <= 60
            if same_meeting or within_60:
                flagged.append((anchor_id, cand_id, shared))

    print(f"Flagged pairs (shared token, same meeting or within 60 days): {len(flagged)}\n")

    unresolved = []
    for anchor_id, cand_id, shared in flagged:
        status = "REVIEWED" if (anchor_id, cand_id) in reviewed_keys else "UNRESOLVED"
        print(f"{status}: anchor={anchor_id} candidate={cand_id} tokens={sorted(shared)}")
        if status == "UNRESOLVED":
            unresolved.append((anchor_id, cand_id, shared))

    print(f"\n{'=' * 60}")
    print(f"Unresolved pairs: {len(unresolved)}")
    if unresolved:
        print("\nEach of these needs EITHER a corrections.json row nulling the candidate's")
        print("axis/polarity, OR a reviewed-planning-pairs.json entry (anchor_id, candidate_id,")
        print("token, reason quoting both motions' own text) explaining why direction is")
        print("genuinely warranted.")
        for anchor_id, cand_id, shared in unresolved:
            print(f"  -> {anchor_id} / {cand_id}  tokens={sorted(shared)}")
            print(f"     anchor quote:    {entries[anchor_id]['quote'][:150]!r}")
            print(f"     candidate quote: {entries[cand_id]['quote'][:150]!r}")
        sys.exit(1)

    print("\nZero unresolved pairs. PASS.")
    sys.exit(0)


if __name__ == "__main__":
    main()
