#!/usr/bin/env python3
"""
Gate round 5 item B: PERMANENT CLASS SWEEP for the reconsidered-vote-pair
claim class (item A's defect class, generalized).

THE RULE, implemented from scratch against the source meeting records
(never trusted from a prior gate's tally):

  1. Enumerate every motion in the 2023+ corpus (data/<YYYY-MM>/*.json)
     whose own text (pre_motion_texts + motion_texts + post_motion_texts)
     contains "RECONSIDER" in any inflection (reconsider/reconsidered/
     reconsideration/reconsidering) -- this catches s.13.x (Council) and
     s.35.x (committee/Budget Committee) reconsideration mechanisms alike,
     not just one procedure-bylaw section number.

  2. Group hits by (meetingSlug, itemNumber) -- one "episode" per item,
     since a single reconsideration frequently produces 2-3 RECONSIDER
     hits in the same item's content array (the request itself, plus a
     re-vote or amendment whose own text echoes "reconsideration"
     descriptively).

  3. For each episode, attempt MECHANICAL PAIRING: for every index whose
     match sits ONLY in pre_/post_motion_texts (an "additional votes" note
     appended to an already-recorded roll call -- the Budget Committee's
     general-consent s.35.10 pattern), that motion itself is the candidate
     SUPERSEDED vote. For every index whose match sits inside motion_texts
     itself (a standalone "...BE RECONSIDERED..." request), the candidate
     pair is searched for among ALL other motions in the item (not just
     immediate neighbors -- intervening unrelated motions, e.g. a delegation
     approval between the original vote and the re-vote, are common):
     the (X before the request, Y after the request) combination whose core
     motion_texts have the highest textual similarity. A best-match
     similarity >= 0.85 is accepted as a same-text re-vote pair
     (superseded=X or the embedded motion itself, final=Y).

  4. Every episode that mechanically pairs is checked against
     data/election/classify/reconsidered-pairs.json (the registry
     generate-stances.ts's ladder-handling fix reads, see
     RECONSIDERED_SUPERSEDED_TO_FINAL there): the pair must be listed with
     matching ids. If BOTH the superseded and final motion are published
     (non-null axis in the post-corrections verified view --
     lib_corrections.load_merged), the FINAL motion's whatAYeaDid must
     contain a recognized re-vote qualifier phrase (the corpus's own
     established conventions: "following a reconsideration vote" or
     "re-vote of the same amendment").

  5. Every episode that does NOT mechanically pair must appear in
     data/election/classify/reconsiderations-reviewed.json, keyed by
     (meetingSlug, itemNumber), with a non-empty reason and a quote that
     verbatim-matches (whitespace/quote-style normalized) the episode's
     own source text.

  6. Both registries are also checked in reverse: every entry in either
     file must correspond to an episode this sweep actually found in the
     source (catches a stale/orphaned entry after a future data refresh).

Zero unresolved episodes (rule 4 or rule 5 satisfied for every one found)
and zero unqualified published pairs -> exit 0. Any violation -> exit 1
with every violation printed.

Negative-test mode (--self-test): strips the round-5 item-A qualifier
in-memory (never touches the file), confirms this sweep would then exit 1,
then re-runs the normal check and confirms exit 0 -- proving the qualifier
check actually bites. Exit code of --self-test itself is 0 iff both halves
behaved as expected.

Usage:
  python3 scripts/election/sweep-reconsidered-pairs.py
  python3 scripts/election/sweep-reconsidered-pairs.py --self-test
"""
from __future__ import annotations

import difflib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

REPO_ROOT = lc.REPO_ROOT
CLASSIFY_DIR = lc.CLASSIFY_DIR
PAIRS_PATH = CLASSIFY_DIR / "reconsidered-pairs.json"
REVIEWED_PATH = CLASSIFY_DIR / "reconsiderations-reviewed.json"

RECON_RE = re.compile(r"RECONSIDER", re.IGNORECASE)
QUALIFIER_RE = re.compile(
    r"following a reconsideration vote|re-vote of the same amendment",
    re.IGNORECASE,
)
# Calibrated against the actual corpus: every genuine same-text re-vote
# found scores >= 0.887 (PEC 3.3's "0 metre"/"1.5 metre" setback correction
# is the lowest; most score 0.995-1.0). The one false-positive this sweep
# hit below that -- 0.8346, two DIFFERENT committee-appointment motions
# ("That Councillor J. Pribil BE APPOINTED to the Kettle Creek..." vs
# "...Councillor P. Van Meerbergen BE APPOINTED to the Lower Thames
# Valley...", 2023-06-27 Council 8.3.11) -- shares enough boilerplate
# template text to clear a lower bar despite naming different people and
# different conservation authorities. 0.85 sits in the gap between them.
SIMILARITY_THRESHOLD = 0.85


def get_text(t):
    return t.get("string") if isinstance(t, dict) else t


def all_texts(m: dict) -> list[str]:
    out = []
    for k in ("pre_motion_texts", "motion_texts", "post_motion_texts"):
        for t in m.get(k, []):
            s = get_text(t)
            if s:
                out.append(s)
    return out


def core_text(m: dict) -> str:
    parts = [get_text(t) for t in m.get("motion_texts", [])]
    return re.sub(r"\s+", " ", " ".join(p for p in parts if p)).strip()


def walk_items(node_dict, prefix, out):
    for leaf, node in (node_dict or {}).items():
        item_number = f"{prefix}.{leaf}" if prefix else leaf
        content = node.get("content", [])
        if content:
            out.append((item_number, content))
        walk_items(node.get("items", {}) or {}, item_number, out)


class Episode:
    def __init__(self, meeting_slug, item_number, content):
        self.meeting_slug = meeting_slug
        self.item_number = item_number
        self.content = content
        # request_idx: match lives inside motion_texts (a standalone
        # "...BE RECONSIDERED..." ask, or descriptive text mentioning
        # reconsideration -- either way, not itself a stable vote to pair).
        # embedded_idx: match lives ONLY in pre_/post_motion_texts -- this
        # motion IS a real recorded vote (the superseded one), just carrying
        # a trailing/leading note about the reconsideration.
        self.request_idx: list[int] = []
        self.embedded_idx: list[int] = []
        self.pair: tuple[int, int] | None = None  # (superseded_idx, final_idx)

    def key(self):
        return (self.meeting_slug, self.item_number)


def find_episodes() -> list[Episode]:
    episodes: list[Episode] = []
    months = sorted(p for p in REPO_ROOT.glob("data/202[3-6]-*") if p.is_dir())
    for month_dir in months:
        for f in sorted(month_dir.glob("*.json")):
            slug = f"months/{month_dir.name}/{f.stem}"
            data = json.loads(f.read_text())
            items = []
            walk_items(data.get("items", {}) or {}, "", items)
            for item_number, content in items:
                ep = None
                for idx, m in enumerate(content):
                    mt = " ".join(get_text(t) for t in m.get("motion_texts", []) if get_text(t))
                    full = " ".join(all_texts(m))
                    if not RECON_RE.search(full):
                        continue
                    if ep is None:
                        ep = Episode(slug, item_number, content)
                    if RECON_RE.search(mt):
                        ep.request_idx.append(idx)
                    else:
                        ep.embedded_idx.append(idx)
                if ep is not None:
                    episodes.append(ep)
    return episodes


def try_mechanical_pair(ep: Episode) -> None:
    n = len(ep.content)
    recon_idx = set(ep.request_idx) | set(ep.embedded_idx)

    def sim(a: str, b: str) -> float:
        if not a or not b:
            return 0.0
        # autojunk=False: SequenceMatcher's default autojunk heuristic
        # treats any character appearing in >1% of a long (200+) sequence
        # as "popular"/junk -- budget-amendment text repeats "-$100,000"
        # and "Operating Expenditures"/"Tax Levy" many times over, which
        # tanked PD1218's same-text pair (item 3.27) to a 0.51 ratio
        # instead of the real ~0.996 (one "received"->"referred" word
        # swap in ~700 chars) once autojunk is disabled.
        return difflib.SequenceMatcher(None, a.lower(), b.lower(), autojunk=False).ratio()

    best = (0.0, None, None)  # (similarity, superseded_idx, final_idx)

    for i in ep.embedded_idx:
        # This motion IS the candidate superseded vote; search forward only.
        ci = core_text(ep.content[i])
        for j in range(i + 1, n):
            if j in recon_idx:
                continue
            cj = core_text(ep.content[j])
            s = sim(ci, cj)
            if s > best[0]:
                best = (s, i, j)

    for r in ep.request_idx:
        for i in range(0, r):
            if i in recon_idx:
                continue
            ci = core_text(ep.content[i])
            for j in range(r + 1, n):
                if j in recon_idx:
                    continue
                cj = core_text(ep.content[j])
                s = sim(ci, cj)
                if s > best[0]:
                    best = (s, i, j)

    if best[0] >= SIMILARITY_THRESHOLD:
        ep.pair = (best[1], best[2])


def build_id_resolver(all_motions_by_key, meeting_slug, item_number, content):
    """A same-text re-vote pair is EXACTLY the case where two raw content
    entries share the identical core text — the one case a plain text-match
    would find ambiguous (2+ ids with the same motionText prefix) for
    precisely the rows this sweep most needs to resolve. Disambiguates by
    OCCURRENCE ORDER instead: data/votes/_all-motions.json preserves the
    same left-to-right, chronological order as the raw content array (both
    are produced by walking the same source top-to-bottom), so the Nth raw
    content index with a given normalized text corresponds to the Nth
    _all-motions.json id with that same text. Returns a function
    idx -> id-or-None."""
    candidates = all_motions_by_key.get((meeting_slug, item_number), [])
    text_to_ids: dict[str, list[str]] = {}
    for mid, mtext in candidates:
        if not mtext:
            continue
        key = lc.norm_ws(mtext)[:200]
        text_to_ids.setdefault(key, []).append(mid)

    text_to_indices: dict[str, list[int]] = {}
    for i, m in enumerate(content):
        ct = core_text(m)
        if not ct:
            continue
        key = lc.norm_ws(ct)[:200]
        text_to_indices.setdefault(key, []).append(i)

    def resolve(idx: int) -> str | None:
        ct = core_text(content[idx])
        if not ct:
            return None
        key = lc.norm_ws(ct)[:200]
        ids = text_to_ids.get(key, [])
        idxs = text_to_indices.get(key, [])
        if len(ids) != len(idxs) or idx not in idxs:
            return None
        rank = idxs.index(idx)
        return ids[rank]

    return resolve


def load_json_list(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text())


def run_check(corrections_override=None) -> tuple[int, list[str]]:
    """Returns (exit_code, messages). corrections_override lets --self-test
    substitute a mutated corrections list without touching the file."""
    errors: list[str] = []

    entries, motions = lc.load_verified_entries(), lc.load_all_motions()
    corrections = (
        corrections_override
        if corrections_override is not None
        else lc.load_corrections()
    )
    lc.apply_corrections(entries, motions, corrections)

    # Build (meetingSlug, itemNumber) -> [(id, motionText)] for id recovery.
    by_key: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for mid, m in motions.items():
        by_key.setdefault((m["meetingSlug"], m["itemNumber"]), []).append(
            (mid, m.get("motionText", ""))
        )

    episodes = find_episodes()
    pairs_registry = load_json_list(PAIRS_PATH)
    reviewed_registry = load_json_list(REVIEWED_PATH)
    registry_by_key = {(p["meetingSlug"], p["itemNumber"]): p for p in pairs_registry}
    reviewed_by_key = {(r["meetingSlug"], r["itemNumber"]): r for r in reviewed_registry}

    mechanical = 0
    published_pairs = 0
    unqualified = 0
    unresolved_ok = 0

    seen_keys: set[tuple[str, str]] = set()
    for ep in episodes:
        key = ep.key()
        seen_keys.add(key)
        try_mechanical_pair(ep)

        if ep.pair is not None:
            mechanical += 1
            s_idx, f_idx = ep.pair
            resolve = build_id_resolver(by_key, ep.meeting_slug, ep.item_number, ep.content)
            s_id = resolve(s_idx)
            f_id = resolve(f_idx)
            s_entry = entries.get(s_id) if s_id else None
            f_entry = entries.get(f_id) if f_id else None
            s_pub = bool(s_entry and s_entry.get("axis") is not None)
            f_pub = bool(f_entry and f_entry.get("axis") is not None)

            if s_pub or f_pub:
                published_pairs += 1
                reg = registry_by_key.get(key)
                if reg is None:
                    errors.append(
                        f"{key}: published re-vote pair (superseded={s_id}, final={f_id}) "
                        f"is not listed in {PAIRS_PATH.name}"
                    )
                else:
                    if reg.get("supersededId") != s_id or reg.get("finalId") != f_id:
                        errors.append(
                            f"{key}: {PAIRS_PATH.name} entry ids ({reg.get('supersededId')}, "
                            f"{reg.get('finalId')}) don't match re-derived ids ({s_id}, {f_id})"
                        )
                if f_entry is not None and f_pub:
                    if not QUALIFIER_RE.search(f_entry.get("whatAYeaDid", "")):
                        unqualified += 1
                        errors.append(
                            f"{key}: final motion {f_id} is published (axis="
                            f"{f_entry.get('axis')!r}) but its whatAYeaDid carries no "
                            "recognized re-vote qualifier"
                        )
        else:
            rv = reviewed_by_key.get(key)
            if rv is None:
                errors.append(
                    f"{key}: reconsideration found in source, no mechanical re-vote "
                    f"pair, and NOT in {REVIEWED_PATH.name}"
                )
                continue
            if not rv.get("reason", "").strip():
                errors.append(f"{key}: reviewed entry has an empty reason")
                continue
            quote = rv.get("quote", "")
            source_blob = lc.norm_ws(
                " ".join(t for m in ep.content for t in all_texts(m))
            )
            if lc.norm_ws(quote) not in source_blob:
                errors.append(
                    f"{key}: reviewed entry's quote does not verbatim-match this "
                    "episode's source text"
                )
                continue
            unresolved_ok += 1

    # Reverse check: no orphaned registry/reviewed entries.
    for key in registry_by_key:
        if key not in seen_keys:
            errors.append(f"{key}: {PAIRS_PATH.name} entry has no matching source episode")
    for key in reviewed_by_key:
        if key not in seen_keys:
            errors.append(f"{key}: {REVIEWED_PATH.name} entry has no matching source episode")

    msgs = [
        f"episodes found (2023+): {len(episodes)}",
        f"mechanically paired: {mechanical}",
        f"  of which published (axis-bearing on either side): {published_pairs}",
        f"  of which unqualified: {unqualified}",
        f"reviewed/unresolved (quote-backed, verified): {unresolved_ok}",
    ]
    return (1 if errors else 0, msgs + (["", f"{len(errors)} CHECK(S) FAILED:"] + [f" - {e}" for e in errors] if errors else ["", "ALL CHECKS PASSED"]))


def self_test() -> int:
    print("=== self-test: mutate item A's qualifier out, expect exit 1 ===")
    base = lc.load_corrections()
    mutated = []
    for c in base:
        if c["id"] == "bcdc340f73a8" and c["field"] == "whatAYeaDid":
            c = dict(c)
            c["now"] = c["now"].replace(", following a reconsideration vote to correct a councillor's vote.", ".")
        mutated.append(c)
    code, msgs = run_check(corrections_override=mutated)
    print("\n".join(msgs))
    if code != 1:
        print("SELF-TEST FAILED: stripping the qualifier did not produce exit 1")
        return 1
    print("\n=== self-test: restore, expect exit 0 ===")
    code2, msgs2 = run_check()
    print("\n".join(msgs2))
    if code2 != 0:
        print("SELF-TEST FAILED: normal (unmutated) run did not exit 0")
        return 1
    print("\nSELF-TEST PASSED")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    code, msgs = run_check()
    print("\n".join(msgs))
    return code


if __name__ == "__main__":
    sys.exit(main())
