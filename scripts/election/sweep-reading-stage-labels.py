#!/usr/bin/env python3
"""
Round-2 gate item 3: corpus-wide sweep for a reading-stage LABEL defect
class in VerifiedEntry.whatAYeaDid (post corrections.json merge — see
lib_corrections.load_merged), across every batch-*-verified.json entry, not
just what happens to be published on a hub page today. Detects three shapes
of the same underlying mistake — a by-law reading's own prose describing
the WRONG stage, or no stage at all when its own quote/source text names
one:

  (A) "Enacted (Introduction and )?First/Second Reading of ..." — nothing
      is enacted before THIRD reading (enactment is what third reading
      does); a first- or second-reading row using "Enacted" as its verb
      overstates what that specific roll call did.

  (B) "...Third Reading and Enactment Reading of ..." — a doubled "Reading"
      noun (garbled prose, distinct from a real duplicated word in the
      source), always at the tail of the "Third Reading and Enactment"
      phrase.

  (C) "Gave a reading to ..." — stage-LESS: doesn't say which reading this
      roll call was, even though the row's own `quote` field (the verbatim
      source clause for THIS SPECIFIC roll call, itself checked against the
      meeting JSON's full text — never trusted un-checked, since batch-36's
      own quotes have had transcription slips) names an explicit
      Introduction-and-First / Second / Third-Reading-and-Enactment stage.

A hit's suggested fix is generated mechanically from its own `quote` (never
from a hardcoded id table): (A)/(C)-first/second becomes "Gave {stage}
reading to ...", (B)/(C)-third becomes "Gave third reading and enacted
...". This sweep only PRINTS suggested fixes — it never writes
corrections.json itself (see the channel's "never edit batch-*-verified.json
content, corrections.json only" rule) — a human/fixer step applies them,
then reruns this sweep to confirm zero.

Usage: python3 scripts/election/sweep-reading-stage-labels.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_corrections import full_motion_texts, load_merged, norm_ws  # noqa: E402

RE_A = re.compile(r"\benacted (introduction and )?(first|second) reading\b", re.I)
RE_B = re.compile(r"third reading and enactment reading\b", re.I)
RE_C = re.compile(r"\bgave a reading\b", re.I)

RE_STAGE_FIRST = re.compile(r"introduction and first reading", re.I)
RE_STAGE_SECOND = re.compile(r"\bsecond reading\b", re.I)
RE_STAGE_THIRD = re.compile(r"third reading and enactment\b", re.I)


def stage_from_quote(quote: str) -> str | None:
    """Which reading stage this row's own verbatim quote names, or None if
    it names none of the three (should not happen for a real by-law
    reading's quote; treated as unresolved, never guessed at)."""
    if RE_STAGE_FIRST.search(quote):
        return "first"
    if RE_STAGE_SECOND.search(quote):
        return "second"
    if RE_STAGE_THIRD.search(quote):
        return "third"
    return None


def fixed_text(what: str, kind: str, stage: str | None) -> str | None:
    if kind == "A":
        m = re.match(r"^Enacted (?:Introduction and )?(First|Second) Reading of ", what, re.I)
        if not m:
            return None
        st = "first" if m.group(1).lower() == "first" else "second"
        return re.sub(
            r"^Enacted (?:Introduction and )?(First|Second) Reading of ",
            f"Gave {st} reading to ",
            what,
            count=1,
            flags=re.I,
        )
    if kind == "B":
        return re.sub(
            r"^(Supported )?Third Reading and Enactment Reading of ",
            "Gave third reading and enacted ",
            what,
            count=1,
            flags=re.I,
        )
    if kind == "C" and stage is not None:
        if stage in ("first", "second"):
            return re.sub(r"^Gave a reading to ", f"Gave {stage} reading to ", what, count=1)
        return re.sub(r"^Gave a reading to ", "Gave third reading and enacted ", what, count=1)
    return None


def main() -> int:
    entries, motions = load_merged()

    hits_a = []
    hits_b = []
    hits_c = []
    unresolved = []

    for e in entries.values():
        what = e.get("whatAYeaDid") or ""
        m = motions.get(e["id"], {})

        if RE_A.search(what):
            hits_a.append((e, fixed_text(what, "A", None)))
        elif RE_B.search(what):
            hits_b.append((e, fixed_text(what, "B", None)))
        elif RE_C.search(what):
            quote = e.get("quote") or ""
            stage = stage_from_quote(quote)
            texts = full_motion_texts(m.get("meetingSlug", ""), m.get("itemNumber", "")) if m else []
            verbatim = any(norm_ws(quote) == norm_ws(t) for t in texts)
            if stage is None or not verbatim:
                unresolved.append((e, m, stage, verbatim))
            else:
                hits_c.append((e, fixed_text(what, "C", stage)))

    ok = True

    def report(label, hits):
        nonlocal ok
        print(f"\nClass {label}:")
        if not hits:
            print("  PASS: none.")
            return
        ok = False
        print(f"  FAIL: {len(hits)} row(s):")
        for e, fix in hits:
            m = motions.get(e["id"], {})
            print(f"    {e['id']} {m.get('date')} issue={e.get('issue')} {m.get('meetingSlug')}#{m.get('itemNumber')}")
            print(f"      was: {e['whatAYeaDid']!r}")
            print(f"      fix: {fix!r}")

    report("A (Enacted first/second reading)", hits_a)
    report("B (duplicated-Reading garble)", hits_b)
    report("C (stage-less, source names a stage)", hits_c)

    print("\nUnresolved 'Gave a reading' rows (no stage derivable from quote, or quote not verbatim in source — needs manual review, not auto-fixed):")
    if unresolved:
        ok = False
        for e, m, stage, verbatim in unresolved:
            print(f"    {e['id']} {m.get('date')} {m.get('meetingSlug')}#{m.get('itemNumber')} stage={stage} verbatim={verbatim}")
            print(f"      quote: {e.get('quote')!r}")
    else:
        print("  none.")

    total = len(hits_a) + len(hits_b) + len(hits_c) + len(unresolved)
    print(f"\n{'=' * 60}\nTotal reading-stage-label hits: {total}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
