#!/usr/bin/env python3
"""
Shared corrections-merge library for the election-hub Python sweeps/verifiers.

generate-stances.ts is the canonical source of the correction-application
semantics (data/election/classify/corrections.json applied over
data/election/classify/batch-*-verified.json, in file order, with a
staleness check against each row's `was`). Several Python checks need the
POST-correction view of a verified entry's fields (not the raw batch file,
which corrections.json deliberately never touches — see the "NEVER edit
batch-*-verified.json content" rule) to avoid re-flagging a defect that a
correction already fixed, or missing one a correction just introduced.
Rather than each script re-deriving that merge ad hoc, this module
replicates it once, field-for-field, including "issue" and "quote" (added
alongside axis/polarity/whatAYeaDid/decisionKey/motionText in the
channel-extension gate item — see generate-stances.ts's Correction type and
applyCorrections/applyMotionTextCorrections for the authoritative version
this mirrors).

Only load_full_motion_text below reaches into the source meeting JSON; the
rest of this module is pure in-memory merging of the two JSON files.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
CLASSIFY_DIR = REPO_ROOT / "data" / "election" / "classify"
CORRECTIONS_PATH = CLASSIFY_DIR / "corrections.json"
ALL_MOTIONS_PATH = REPO_ROOT / "data" / "votes" / "_all-motions.json"

# Fields a corrections.json row may patch on a VerifiedEntry (i.e. every
# field except "motionText", which patches _all-motions.json's own
# extraction instead — see applyMotionTextCorrections in generate-stances.ts).
ENTRY_FIELDS = {"issue", "axis", "polarity", "whatAYeaDid", "decisionKey", "quote"}


def load_verified_entries() -> dict[str, dict[str, Any]]:
    """id -> verified entry, from every batch-*-verified.json, uncorrected."""
    entries: dict[str, dict[str, Any]] = {}
    for f in sorted(CLASSIFY_DIR.glob("batch-*-verified.json")):
        if not re.match(r"^batch-(\d+|returning)-verified\.json$", f.name):
            continue
        for e in json.loads(f.read_text()):
            if e["id"] in entries:
                raise ValueError(f"duplicate verified classification id {e['id']} (in {f.name})")
            e.setdefault("decisionKey", None)
            entries[e["id"]] = e
    return entries


def load_corrections() -> list[dict[str, Any]]:
    if not CORRECTIONS_PATH.exists():
        return []
    return json.loads(CORRECTIONS_PATH.read_text())


def load_all_motions() -> dict[str, dict[str, Any]]:
    data = json.loads(ALL_MOTIONS_PATH.read_text())
    return {m["id"]: m for m in data["motions"]}


def apply_corrections(
    entries: dict[str, dict[str, Any]],
    motions: dict[str, dict[str, Any]] | None,
    corrections: list[dict[str, Any]],
) -> tuple[int, int]:
    """Apply corrections.json in file order onto `entries` (VerifiedEntry
    fields) and, when `motions` is given, onto `motions[*]['motionText']`
    (the motionText correction target). Mirrors generate-stances.ts's
    staleness check: a `was` mismatch against the CURRENT value raises,
    same as a stale correction would fail the real build. Returns
    (entry_corrections_applied, motion_text_corrections_applied)."""
    entry_applied = 0
    text_applied = 0
    for c in corrections:
        if c["field"] == "motionText":
            if motions is None:
                continue
            m = motions.get(c["id"])
            if m is None:
                raise ValueError(f"corrections.json: motion {c['id']} (motionText) not in _all-motions.json")
            if m["motionText"] != c["was"]:
                raise ValueError(f"corrections.json: {c['id']}.motionText stale")
            m["motionText"] = c["now"]
            text_applied += 1
            continue
        if c["field"] not in ENTRY_FIELDS:
            raise ValueError(f"corrections.json: unknown field {c['field']!r} on {c['id']}")
        entry = entries.get(c["id"])
        if entry is None:
            raise ValueError(f"corrections.json references {c['id']} (field {c['field']}) with no verified entry")
        current = entry.get(c["field"])
        if current != c["was"]:
            raise ValueError(
                f"corrections.json: expected {c['id']}.{c['field']} to be {c['was']!r}, found {current!r} (stale)"
            )
        entry[c["field"]] = c["now"]
        entry_applied += 1
    return entry_applied, text_applied


def load_merged() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Convenience: verified entries + all-motions, both with
    corrections.json applied. This is the view every corpus-wide Python
    sweep/verifier should read from, so a correction landing in
    corrections.json is picked up the same way generate-stances.ts picks it
    up, without a script re-flagging (or missing) a row a correction already
    touched."""
    entries = load_verified_entries()
    motions = load_all_motions()
    apply_corrections(entries, motions, load_corrections())
    return entries, motions


_MEETING_CACHE: dict[str, Any] = {}


def _meeting_path(meeting_slug: str) -> Path:
    # "months/2026-02/2026-02-10 3rd Council Meeting" -> data/2026-02/2026-02-10 3rd Council Meeting.json
    assert meeting_slug.startswith("months/"), meeting_slug
    rest = meeting_slug[len("months/") :]
    return REPO_ROOT / "data" / (rest + ".json")


def load_meeting_json(meeting_slug: str) -> Any:
    if meeting_slug not in _MEETING_CACHE:
        p = _meeting_path(meeting_slug)
        _MEETING_CACHE[meeting_slug] = json.loads(p.read_text())
    return _MEETING_CACHE[meeting_slug]


def find_item_node(meeting: Any, item_number: str) -> Any | None:
    """A meeting's `items` dict is a recursive tree keyed by each item's OWN
    LEAF number (not its full dotted path) at every level — e.g. the
    Municipal Accommodation Tax item, whose full item number in the source
    (and in RawMotion.itemNumber / bill descriptions like "(2.2/3/CPSC)") is
    "2.2", lives at meeting['items']['2']['items']['2'], not at a top-level
    "2.2" key. Walk the dotted path one leaf at a time to find it; returns
    None if any leaf along the path is missing (a bare top-level number like
    "13" is a one-part path and resolves directly)."""
    node_dict = meeting.get("items", {})
    node = None
    for part in item_number.split("."):
        node = node_dict.get(part)
        if node is None:
            return None
        node_dict = node.get("items", {})
    return node


def iter_item_motions(meeting_slug: str, item_number: str):
    """Yield every Motion dict (content-array entry) under the item found by
    find_item_node for this meeting/item_number."""
    meeting = load_meeting_json(meeting_slug)
    item = find_item_node(meeting, item_number)
    if item is None:
        return
    for m in item.get("content", []):
        yield m


def full_motion_texts(meeting_slug: str, item_number: str) -> list[str]:
    """Every motion_texts/pre_motion_texts/post_motion_texts string under
    this item, across all its recorded motions — the full, untruncated
    source text a classify/correction quote must be checked against."""
    out: list[str] = []
    for m in iter_item_motions(meeting_slug, item_number):
        for key in ("pre_motion_texts", "motion_texts", "post_motion_texts"):
            for t in m.get(key, []):
                s = t.get("string") if isinstance(t, dict) else t
                if s:
                    out.append(s)
    return out


_QUOTE_TRANSLATION = str.maketrans(
    {
        "’": "'",  # RIGHT SINGLE QUOTATION MARK
        "‘": "'",  # LEFT SINGLE QUOTATION MARK
        "“": '"',  # LEFT DOUBLE QUOTATION MARK
        "”": '"',  # RIGHT DOUBLE QUOTATION MARK
    }
)


def norm_ws(s: str) -> str:
    """Whitespace- and punctuation-style-normalize for verbatim comparison:
    collapse all runs of whitespace (including \\xa0 non-breaking space, a
    recurring eScribe extraction artifact — see rekey-classify-ids.py's own
    NBSP handling) to a single ascii space, fold curly quotes/apostrophes to
    their straight ASCII equivalent, and strip. The source itself is
    internally inconsistent about which it uses (the SAME 2025-11-25 item 13
    sentence has both "Bill No.'s 403" (straight) and "Bill No.'s 411 and
    425" (curly, \\u2019) back to back), so a verbatim check that didn't fold
    this would flag six genuinely-correct batch-36 quotes (112a41ddc412,
    b9b3dd047303, 92862cab40bd, c53e853071d0, 8f813a32a083, a27293e0332d) as
    mismatches over a punctuation-style choice the source doesn't even apply
    consistently — a real word-level transcription slip is what this
    normalization is meant to still catch, not typographic quote variants."""
    s = s.translate(_QUOTE_TRANSLATION)
    return re.sub(r"[\s\xa0]+", " ", s).strip()
