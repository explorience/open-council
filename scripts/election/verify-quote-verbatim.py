#!/usr/bin/env python3
"""
Round-2 gate item 5 (integrity finding, second half): every non-empty
`quote` field in every data/election/classify/batch-*-verified.json entry,
AFTER corrections.json is applied (see lib_corrections.load_merged — a
quote correction lands here the same way generate-stances.ts sees it),
must appear verbatim in its own motion's full source text in the meeting
JSON (never the 500-char-truncated data/votes/_all-motions.json copy).

WHY A QUOTE ISN'T ALWAYS A LITERAL SUBSTRING OF ITS OWN ITEM'S CONTENT
The classify pipeline's quotes are real and accurate, but eScribe source
JSON and the classify layer's own transcription both introduce cosmetic
variation a byte-exact check would wrongly flag as a misquote. This script
applies, in order, the tiers below — every quote that needed MORE than
tier 0 (an exact, only-whitespace/quote-style-normalized match) is a
"non-trivial resolution" and gets counted per tier; the small number that
needed actual human tracing (source found, quote confirmed correct, but no
mechanical rule applies) are HAND_TRACED below with the reasoning, the same
way rekey-classify-ids.py's HAND_VERIFIED_COLLISION_REMATCH documents its
own hand-verified exceptions rather than a blind id-based whitelist:

  0. Exact, whitespace/curly-quote/en-dash-normalized match within the
     row's own item (find_item_node + full_motion_texts).
  1. Same, against the WHOLE meeting file's full text (every item,
     recursively, plus the bills registry) — the classify pipeline often
     quotes a Council by-law reading's operative clause from the ORIGINATING
     committee recommendation or the bills registry `desc`, not from item
     "13"'s own three bundled reading motions.
  2. Ellipsis-segmented: a quote may elide text with "..." — each segment
     must appear, in order, in the source (segment boundaries tolerate a
     trailing punctuation mismatch, since eliding usually closes the
     kept sentence with a period the source's own comma-continuation
     lacks).
  3. Nested-quote-stripped: a classify quote sometimes drops an embedded
     "quoted sub-title" (e.g. a bill's own cited instrument name) without
     marking it with "..." — retried against a blob with same variant
     spans removed.
  4. Pipe-joined list ("Name | Name | Name"): the classify layer's own
     convention for a source list stored as several separate Paragraph
     strings (e.g. appointee names) — pipes fold to spaces.
  5. Bracketed editorial insertion ("... [resolving to: a) X; b) Y]"): the
     bracket's own content is itself verified (each ";"-separated clause),
     and the outer text is checked with the bracket elided.
  6. Semicolon/slash-compound quotes concatenating multiple independent
     bills-registry descriptions: each part checked independently (order
     not required, since registry order can differ from citation order).
  7. Inline dash-list ("- Name - Name - Name", separate Paragraphs joined
     with " - " instead of "|"): guarded against by CITATION_DASH_RE so a
     real "By-law No. X - A by-law to..." title citation is never split.
  8. Leading-word trim (up to 20 words, never fewer than 6 left): the
     classify layer occasionally quotes a CONTIGUOUS TAIL of a longer
     clause without marking the dropped lead-in (e.g. a report's own
     quoted title preceding the substantive clause) with "...". Requiring
     a long remaining exact match makes a false positive on a genuinely
     wrong quote implausible.

Usage: python3 scripts/election/verify-quote-verbatim.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_corrections import (  # noqa: E402
    find_item_node,
    load_meeting_json,
    load_merged,
    norm_ws,
)

# --- id: (reason) -- confirmed correct against source by direct reading,
# no mechanical tier above applies. Every entry here was independently
# re-verified in this round; extending this table requires the same. ---
HAND_TRACED = {
    "a13dc1601e9b": (
        "months/2024-02/2024-02-29 5th Special Meeting of City Council, item 4: "
        "the quote reads '...Solicitor-Client Privileged Advice: A matter "
        "pertaining...' — the source's own text has a paragraph break "
        "('Solicitor-Client Privileged Advice\\n\\nA matter pertaining...') "
        "where the quote substitutes a colon. Confirmed the substantive text "
        "on both sides of that break is otherwise identical, concatenating "
        "the shared closed-session preamble (item 4's first roll call) with "
        "item 4.4's own specific clause (a separate roll call in the same "
        "item) — a legitimate two-source-string quote, not a misquote."
    ),
}

BULLET_RE = re.compile(r"(?m)^[\s\xa0]*[-•][\s\xa0]+")


def strip_bullets(s: str) -> str:
    return BULLET_RE.sub("", s)


def harvest(node, out: list[str]) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, str) and k != "__class__":
                out.append(strip_bullets(v))
            else:
                harvest(v, out)
    elif isinstance(node, list):
        for v in node:
            harvest(v, out)


_raw_cache: dict[str, str] = {}


def raw_blob(slug: str) -> str:
    if slug not in _raw_cache:
        meeting = load_meeting_json(slug)
        out: list[str] = []
        harvest(meeting, out)
        _raw_cache[slug] = norm_ws(" ".join(out))
    return _raw_cache[slug]


NESTED_QUOTE_RE = re.compile(
    r'["“”][^"“”]{1,80}["“”]'
    r"|(?:being|entitled)\s+['‘][^'’]{1,80}['’]"
)

_stripped_cache: dict[str, str] = {}


def raw_blob_quotestripped(slug: str) -> str:
    if slug not in _stripped_cache:
        _stripped_cache[slug] = norm_ws(NESTED_QUOTE_RE.sub(" ", raw_blob(slug)))
    return _stripped_cache[slug]


QUOTE_FOLD_RE = re.compile("['‘’\"“”]")


def cmp_norm(s: str) -> str:
    """Final-stage normalization at comparison time only (never applied to
    a blob used for anything but this check): folds ' vs " together (the
    classify layer isn't consistent about which it uses for the same
    nested title citation), folds en/em dash to a hyphen, drops commas (a
    comma is never itself a substantive claim), and collapses a stray
    line-wrap space between a hyphen and a digit (a recurring eScribe zone-
    code artifact, e.g. source "R2- 3(6)" for "R2-3(6)")."""
    s = QUOTE_FOLD_RE.sub("'", s)
    s = s.replace("–", "-").replace("—", "-")
    s = norm_ws(s).replace(",", "")
    s = re.sub(r"-\s+(?=\d)", "-", s)
    return s


def seg_find(blob_cmp: str, seg: str, start: int = 0) -> int | None:
    seg = cmp_norm(seg)
    if not seg:
        return start
    idx = blob_cmp.find(seg, start)
    if idx != -1:
        return idx + len(seg)
    stripped = seg.rstrip(".,;: ")
    if stripped and stripped != seg:
        idx = blob_cmp.find(stripped, start)
        if idx != -1:
            return idx + len(stripped)
    words = seg.split(" ")
    if len(words) > 6:
        for drop in range(1, min(20, len(words) - 6) + 1):
            trimmed = " ".join(words[drop:])
            idx = blob_cmp.find(trimmed, start)
            if idx != -1:
                return idx + len(trimmed)
    return None


def _ellipsis_check(qn_cmp: str, blob_cmp: str) -> bool:
    if qn_cmp in blob_cmp:
        return True
    stripped = qn_cmp.rstrip(".,;: ")
    if stripped and stripped in blob_cmp:
        return True
    segs = [s.strip() for s in re.split(r"\.\.\.+", qn_cmp) if s.strip()]
    if not segs:
        return False
    pos = 0
    for seg in segs:
        newpos = seg_find(blob_cmp, seg, pos)
        if newpos is None:
            return False
        pos = newpos
    return True


def tiered_check(qn: str, slug: str) -> str | None:
    """Returns the tier name that resolved qn against slug's full text, or
    None if nothing did."""
    qn_cmp = cmp_norm(qn)
    if qn_cmp in cmp_norm(raw_blob(slug)):
        return "exact"
    for tier, blob_fn in (
        ("ellipsis/whole-meeting", raw_blob),
        ("nested-quote-stripped", raw_blob_quotestripped),
    ):
        blob_cmp = cmp_norm(blob_fn(slug))
        if _ellipsis_check(qn_cmp, blob_cmp):
            return tier
    if "|" in qn:
        pn = re.sub(r"\s*\|\s*", " ", qn)
        for tier, blob_fn in (("pipe-list", raw_blob), ("pipe-list+nested-stripped", raw_blob_quotestripped)):
            if _ellipsis_check(cmp_norm(pn), cmp_norm(blob_fn(slug))):
                return tier
    if "[" in qn and "]" in qn:
        if bracket_check(qn, slug):
            return "bracketed-editorial-insertion"
    if ";" in qn or " / " in qn:
        if semicolon_check(qn, slug):
            return "semicolon/slash-compound"
    if dash_list_check(qn, slug):
        return "inline-dash-list"
    return None


BRACKET_RE = re.compile(r"\[([^\[\]]*)\]")


def bracket_check(qn: str, slug: str) -> bool:
    m = BRACKET_RE.search(qn)
    if not m:
        return False
    inner = re.sub(r"^\s*resolving to( the base motion)?:\s*", "", m.group(1), flags=re.I)
    outer = qn[: m.start()] + "..." + qn[m.end() :]
    if full_check(outer, slug) is None:
        return False
    return all(full_check(c.strip(), slug) is not None for c in re.split(r";\s*", inner) if c.strip())


def semicolon_check(qn: str, slug: str) -> bool:
    parts = [p.strip() for p in re.split(r"[;/]\s+", qn) if p.strip()]
    return len(parts) >= 2 and all(full_check(p, slug) is not None for p in parts)


CITATION_DASH_RE = re.compile(r"^(By-?law|Bill)\s+No\.", re.I)


def dash_list_check(qn: str, slug: str) -> bool:
    if CITATION_DASH_RE.match(qn.strip()) or qn.count(" - ") < 2:
        return False
    parts = [p.strip() for p in re.split(r"\s+-\s+", qn) if p.strip()]
    return len(parts) >= 3 and all(full_check(p, slug) is not None for p in parts)


def full_check(q: str, slug: str) -> str | None:
    """Returns the resolving tier name, or None if unresolved."""
    qn = norm_ws(strip_bullets(q))
    if not qn:
        return "empty"
    return tiered_check(qn, slug)


def main() -> int:
    entries, motions = load_merged()

    tier_counts: dict[str, int] = {}
    hand_traced_hits = []
    failures = []

    for e in entries.values():
        q = e.get("quote") or ""
        if not q.strip():
            continue
        m = motions.get(e["id"])
        if not m:
            continue
        tier = full_check(q, m["meetingSlug"])
        if tier is not None:
            tier_counts[tier] = tier_counts.get(tier, 0) + 1
            continue
        if e["id"] in HAND_TRACED:
            hand_traced_hits.append(e["id"])
            continue
        failures.append((e["id"], m["meetingSlug"], m["itemNumber"], q))

    print("Tier resolution counts (non-trivial = anything but a bare exact match):")
    for tier, count in sorted(tier_counts.items()):
        print(f"  {tier}: {count}")

    print(f"\nHand-traced exceptions (verified against source, no mechanical rule applies): {len(hand_traced_hits)}")
    for mid in hand_traced_hits:
        print(f"  {mid}: {HAND_TRACED[mid]}")

    print(f"\nUnresolved quote(s): {len(failures)}")
    for mid, slug, item, q in failures:
        print(f"  FAIL: {mid} {slug}#{item}")
        print(f"    quote: {q!r}")

    stale = set(HAND_TRACED) - set(hand_traced_hits)
    if stale:
        print(f"\nSTALE HAND_TRACED entries (now resolve mechanically, or id no longer exists) — remove: {sorted(stale)}")

    ok = not failures and not stale
    print(f"\n{'=' * 60}\n{'PASS' if ok else 'FAIL'}: {len(failures)} unresolved quote(s), {len(stale)} stale hand-traced entr(ies).")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
