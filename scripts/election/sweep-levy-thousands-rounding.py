#!/usr/bin/env python3
"""
Gate round 9 item A: corpus-wide sweep for the THOUSANDS-UNDERSTATEMENT
defect class -- a source item whose own title states a rounding convention
("... (rounded to the closest $1,000)" / "(... totals rounded to the
closest $1,000)") prints its dollar figures in the underlying thousands
unit (e.g. "$521" meaning $521,000), and a whatAYeaDid that copies the bare
digits without scaling understates the true fiscal magnitude of that vote
by a factor of 1,000. The round's own exhibit is 2d989f0d676e (batch 42,
2019-02-12 Council item 8.4.4, 9-6): "a net decrease of $521 to the 2019 tax
levy" from a source clause reading "Net Impact $(521)" under an item titled
"(4.1) Review of Operating Budget Amendments (rounded to the closest
$1,000)" -- the true figure is $521,000, not $521. Sibling 74069de95545 (SAME
item, same meeting) correctly renders its own three business-case figures
as full dollars ($408,000/$161,000/$285,000) from the identically-rounded
"$408"/"$161"/"$285" source figures, proving the corpus's own established
convention for items under this rounding note is to scale, not copy.

DETECTION RULE (the whole rule, not a summary):

  1. UNIVERSE: every verified-batch entry in batches 66-95 (this branch's
     era, 2014-2018 -- same ERA_BATCH_RANGE convention as
     sweep-substitution-vs-final.py) whose `issue` is "budget" OR `axis` is
     "levy-size" (post corrections.json merge), with a non-empty
     whatAYeaDid.

  2. Extract every dollar figure from whatAYeaDid via
     `\\$\\(?(\\d{1,3}(?:,\\d{3})*)\\)?` (parenthesized-negative tolerant).
     A figure with NO comma and 1-3 digits (i.e. bare, under $1,000 as
     written) is SUSPICIOUS -- a real under-$1,000 fiscal effect is
     vanishingly rare in a City operating/capital budget line, and is
     exactly the shape a copied-not-scaled thousands figure takes.

  3. For each row with >=1 suspicious figure, look up its own source
     item's `title` (data/<meetingSlug>.json, via
     lib_corrections.find_item_node) and test it against
     ROUNDED_TO_THOUSANDS_RE ("rounded to the (closest|nearest) $1,000").
     A MATCH is a hit: this row's whatAYeaDid carries a bare figure from a
     source that states everything in it is in thousands.

  4. This sweep only PRINTS hits (same "never writes corrections.json
     itself" convention as every other sweep-*.py in this directory) -- a
     human/fixer applies the correction, then reruns this sweep to confirm
     zero. It also prints every DISTINCT rounded-to-$1,000 source item
     found in scope (whether or not it produced a hit), so a reviewer can
     see the sweep actually exercised the whole rounding-note universe, not
     just the one already-known instance.

Usage: python3 scripts/election/sweep-levy-thousands-rounding.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
CLASSIFY_DIR = REPO_ROOT / "data" / "election" / "classify"
ALL_MOTIONS_PATH = REPO_ROOT / "data" / "votes" / "_all-motions.json"

ERA_BATCH_RANGE = range(66, 96)  # batches 66-95, the 2014-2018 term -- this branch's remit

DOLLAR_RE = re.compile(r"\$\(?(\d{1,3}(?:,\d{3})*)\)?(?!,\d{3}|\d)")
ROUNDED_TO_THOUSANDS_RE = re.compile(r"rounded to the (closest|nearest) \$1,000", re.IGNORECASE)

_title_cache: dict[tuple[str, str], str | None] = {}


def item_title(meeting_slug: str, item_number: str) -> str | None:
    key = (meeting_slug, item_number)
    if key not in _title_cache:
        try:
            meeting = lc.load_meeting_json(meeting_slug)
            node = lc.find_item_node(meeting, item_number)
            _title_cache[key] = node.get("title") if node else None
        except Exception:
            _title_cache[key] = None
    return _title_cache[key]


def load_era_entries() -> dict[str, dict]:
    entries: dict[str, dict] = {}
    for n in ERA_BATCH_RANGE:
        f = CLASSIFY_DIR / f"batch-{n}-verified.json"
        if not f.exists():
            continue
        for e in json.loads(f.read_text()):
            entries[e["id"]] = e
    return entries


def run_sweep(corrections_override=None) -> tuple[int, list[str]]:
    entries = load_era_entries()
    motions = {m["id"]: m for m in json.loads(ALL_MOTIONS_PATH.read_text())["motions"]}
    corrections = corrections_override if corrections_override is not None else lc.load_corrections()

    # Post-correction whatAYeaDid/axis/issue view, era-scoped.
    cur = {eid: dict(e) for eid, e in entries.items()}
    for c in corrections:
        if c["id"] in cur and c["field"] in ("whatAYeaDid", "axis", "issue"):
            cur[c["id"]][c["field"]] = c["now"]

    in_scope = [
        eid
        for eid, e in cur.items()
        if (e.get("issue") == "budget" or e.get("axis") == "levy-size") and e.get("whatAYeaDid")
    ]
    print(f"Era entries (batches 66-95): {len(entries)}")
    print(f"budget/levy-size whatAYeaDid rows in scope: {len(in_scope)}\n")

    rounded_titles_seen: set[tuple[str, str, str]] = set()
    hits = []
    for eid in in_scope:
        e = cur[eid]
        m = motions.get(eid)
        if not m:
            continue
        dollar_figs = DOLLAR_RE.findall(e["whatAYeaDid"])
        suspicious = [d for d in dollar_figs if "," not in d]
        title = item_title(m["meetingSlug"], m["itemNumber"])
        if title and ROUNDED_TO_THOUSANDS_RE.search(title):
            rounded_titles_seen.add((m["meetingSlug"], m["itemNumber"], title))
            if suspicious:
                hits.append((eid, m["meetingSlug"], m["itemNumber"], title, e["whatAYeaDid"], suspicious))

    msgs = [
        f"Distinct rounded-to-$1,000 source items found in scope: {len(rounded_titles_seen)}",
    ]
    for slug, item, title in sorted(rounded_titles_seen):
        msgs.append(f"  {slug}#{item}: {title}")

    msgs.append(f"\nHits (bare 1-3-digit $ figure in whatAYeaDid, from a rounded-to-$1,000 source): {len(hits)}")
    for eid, slug, item, title, wayd, sus in hits:
        msgs.append(f"  {eid}  {slug}#{item}")
        msgs.append(f"    title: {title}")
        msgs.append(f"    whatAYeaDid: {wayd}")
        msgs.append(f"    suspicious figures: {sus}")

    msgs.append(f"\n{'=' * 60}")
    if hits:
        msgs.append(f"FAILED: {len(hits)} unresolved thousands-understatement hit(s).")
        return 1, msgs
    msgs.append("PASS: zero unresolved hits.")
    return 0, msgs


# Fixer round 1 (era-range class fix): negative-test BOTH directions --
# revert this branch's own fix (30823f9db4dc, batch 66-95 / 2014-2018 era)
# to its genuine pre-fix bare-digit text and confirm it's caught (exit 1),
# then confirm the restored (real) state is exit 0. The 2018-2022 era's own
# seed fix (2d989f0d676e, batch 42) this self-test used to target is out of
# this era's ERA_BATCH_RANGE universe entirely -- reverting it would never
# surface as a hit here, the same vacuous-check shape the hard-coded range
# produced corpus-wide (see the ERA_BATCH_RANGE fix above).
_SELF_TEST_REVERT_KEY = ("30823f9db4dc", "whatAYeaDid")
_SELF_TEST_REVERT_TEXT = "Adopted the portion of part 2e)i) of the Neighbourhood and Recreation Services 2016-2019 Multi-Year Operating Budget pertaining to municipal golf, in the net amount of $1 for 2016-2019."


def self_test() -> int:
    base = lc.load_corrections()
    last_idx = max(
        idx for idx, c in enumerate(base) if (c["id"], c["field"]) == _SELF_TEST_REVERT_KEY
    )
    if base[last_idx]["now"] == _SELF_TEST_REVERT_TEXT:
        print("SELF-TEST FAILED: already at the revert text -- proves nothing")
        return 1
    mutated = list(base)
    mutated[last_idx] = dict(mutated[last_idx])
    mutated[last_idx]["now"] = _SELF_TEST_REVERT_TEXT

    print(f"=== self-test: revert {_SELF_TEST_REVERT_KEY[0]} to its pre-fix bare-digit text, expect exit 1 ===")
    code, msgs = run_sweep(corrections_override=mutated)
    print("\n".join(msgs))
    if code != 1:
        print("SELF-TEST FAILED: reverting to the bare-digit '$521' text did not produce exit 1")
        return 1
    if not any(_SELF_TEST_REVERT_KEY[0] in line for line in msgs):
        print(f"SELF-TEST FAILED: expected {_SELF_TEST_REVERT_KEY[0]} to appear in the hit list")
        return 1
    print(f" - reverted to {_SELF_TEST_REVERT_TEXT!r} -> exit 1 (confirmed flagged)")

    print("\n=== self-test: restore (real corrections.json), expect exit 0 ===")
    code2, msgs2 = run_sweep()
    print("\n".join(msgs2))
    if code2 != 0:
        print("SELF-TEST FAILED: normal (unmutated) run did not exit 0")
        return 1
    print("\nSELF-TEST PASSED")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    code, msgs = run_sweep()
    print("\n".join(msgs))
    return code


if __name__ == "__main__":
    sys.exit(main())
