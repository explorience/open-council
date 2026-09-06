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

  (D) ENACT-SEMANTICS ON A NON-THIRD READING (gate round 3 item C): any
      whatAYeaDid containing "enact"/"enacted"/"enacting" — regardless of
      whether it also contains a stage WORD, which is what (A) requires —
      whose roll call's own AUTHORITATIVE stage is first or second reading.
      "Supported enacting the by-law adopting ..." carries no literal stage
      word at all, so (A)'s "enacted (introduction and )?(first|second)
      reading" pattern never fires on it, but it still overstates what a
      first/second-reading roll call did: nothing is enacted before third
      reading, stage word or not. Stage is derived from _all-motions.json's
      OWN `motionText` (keyed by this row's `rollCallOrdinal`) — NOT the
      batch's `quote` field, which can be cross-referenced to a *different*
      item's clause for context (see 396aeea2ac8c/a248a2530653: `quote` is
      the rezoning application's own text at a different item; `motionText`
      is the authoritative "Introduction and First Reading of Bill No.
      327..." / "Second Reading of Bill No. 327..." for THIS roll call) and
      can silently disagree with it (see b82df9a301b6: `quote` reads
      "Introduction and First Reading..." while `motionText`/rollCallOrdinal
      confirm this specific roll call really is the third reading — a
      `quote`-field defect, not a (D) hit, correctly NOT flagged here). A
      NEGATED use ("without enacting ...", "not enacting ...") is a
      correctly-hedged disclaimer, not an enactment claim, and is excluded
      from (D) entirely (see f303ed387f89: "...without enacting any
      restriction itself").

  (E) UNDIFFERENTIATED ACROSS READING STAGES (gate round 3 item F1, minor):
      not a wrong-stage claim like (A)/(D), and not stage-less like (C) —
      the label doesn't even try to name enactment, e.g. "Approved the
      by-law authorizing ...". The defect is that the SAME byte-identical
      whatAYeaDid is published on 2+ DISTINCT roll calls (different
      rollCallOrdinal, different motionText) that are themselves different
      reading stages of the same bill (First/Second/Third), with nothing to
      tell a reader which roll call a given row is for (see Bill 157:
      691ae2ebf06d/7f52f9d63ae8/6e90419d5680, all three "Approved the
      by-law authorizing the City to enter the Ontario Renovates Home
      Repair Loan Agreement ..." verbatim). Two rows sharing text because
      they're the SAME single decision at its committee and council stages
      (one recorded vote each, not a reading sequence) are NOT a hit — that
      pairing is the corpus's own established "one decision, two stages"
      convention and describing them identically is accurate, not a
      differentiation defect.

A hit's suggested fix is generated mechanically: (A)/(C)-first/second and
(D) become "Gave {stage} reading to ...", (B)/(C)-third becomes "Gave third
reading and enacted ...". This sweep only PRINTS suggested fixes — it never
writes corrections.json itself (see the channel's "never edit
batch-*-verified.json content, corrections.json only" rule) — a human/fixer
step applies them, then reruns this sweep to confirm zero.

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
RE_D = re.compile(r"\benact(ed|ing)?\b", re.I)
# A negated "without enacting"/"not enacting" is a correctly-hedged claim
# that the motion did NOT enact anything (e.g. a report-back directive
# explicitly disclaiming enactment) -- never a (D) candidate at all.
RE_D_NEGATED = re.compile(r"\b(without|not|never)\s+enact\w*\b", re.I)

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


def stage_from_motion_text(motion_text: str) -> str | None:
    """Same three-way stage classification as stage_from_quote, but run
    against _all-motions.json's own `motionText` for THIS roll call
    (keyed by rollCallOrdinal) — the authoritative source for which reading
    stage a specific vote is, independent of whatever a batch's `quote`
    field happens to say (which is sometimes a cross-referenced excerpt
    from a *different* item entirely — see class (D)'s docstring)."""
    if RE_STAGE_THIRD.search(motion_text):
        return "third"
    if RE_STAGE_FIRST.search(motion_text):
        return "first"
    if RE_STAGE_SECOND.search(motion_text):
        return "second"
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
    if kind == "D" and stage in ("first", "second"):
        m = re.match(r"^Supported enacting ", what, re.I)
        if not m:
            return None
        return re.sub(r"^Supported enacting ", f"Gave {stage} reading to ", what, count=1, flags=re.I)
    return None


def main() -> int:
    entries, motions = load_merged()

    hits_a = []
    hits_b = []
    hits_c = []
    hits_d = []
    unresolved = []
    unresolved_d = []

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
        elif RE_D.search(what) and not RE_D_NEGATED.search(what):
            # Class D (gate round 3 item C): enact-semantics wording with no
            # stage word for (A) to catch. Stage comes from the AUTHORITATIVE
            # motionText for this exact roll call (rollCallOrdinal), never
            # from `quote`, which can be a cross-referenced excerpt from a
            # different item (see docstring). A motion missing from
            # _all-motions.json, or whose own motionText names none of the
            # three stages, is left unresolved rather than guessed at.
            motion_text = m.get("motionText") or ""
            stage = stage_from_motion_text(motion_text) if m else None
            if stage is None:
                unresolved_d.append((e, m))
            elif stage in ("first", "second"):
                fix = fixed_text(what, "D", stage)
                if fix is None:
                    unresolved_d.append((e, m))
                else:
                    hits_d.append((e, fix))
            # stage == "third": enact-semantics wording on an actual third
            # reading is correct, not a hit.

    # Class E (gate round 3 item F1, minor): group every direction-bearing
    # entry by its byte-identical whatAYeaDid text, then flag any group
    # whose members resolve (via motionText, never `quote`) to 2+ DIFFERENT
    # reading stages — the corpus-established "same decision, two stages"
    # convention only covers a group whose members are all the SAME single
    # roll call's stage-pair (committee+council); a group spanning distinct
    # First/Second/Third reading roll calls with no differentiation at all
    # is the real defect.
    by_text: dict[str, list] = {}
    for e in entries.values():
        if e.get("axis") is None or e.get("polarity") is None:
            continue
        what = e.get("whatAYeaDid") or ""
        if not what:
            continue
        by_text.setdefault(what, []).append(e)

    hits_e = []
    for what, group in by_text.items():
        if len(group) < 2:
            continue
        stages = set()
        members = []
        for e in group:
            m = motions.get(e["id"], {})
            stage = stage_from_motion_text(m.get("motionText") or "") if m else None
            stages.add(stage)
            members.append((e, m, stage))
        if len(stages - {None}) >= 2:
            hits_e.append((what, members))

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
    report("D (enact-semantics, no stage word, source is first/second reading)", hits_d)

    print("\nClass E (byte-identical label across distinct reading-stage roll calls):")
    if not hits_e:
        print("  PASS: none.")
    else:
        ok = False
        print(f"  FAIL: {len(hits_e)} group(s):")
        for what, members in hits_e:
            print(f"    {what!r}")
            for e, m, stage in members:
                print(f"      {e['id']} {m.get('date')} rollCallOrdinal={m.get('rollCallOrdinal')} stage={stage}")

    print("\nUnresolved 'Gave a reading' rows (no stage derivable from quote, or quote not verbatim in source — needs manual review, not auto-fixed):")
    if unresolved:
        ok = False
        for e, m, stage, verbatim in unresolved:
            print(f"    {e['id']} {m.get('date')} {m.get('meetingSlug')}#{m.get('itemNumber')} stage={stage} verbatim={verbatim}")
            print(f"      quote: {e.get('quote')!r}")
    else:
        print("  none.")

    print("\nUnresolved class-D rows (enact-semantics wording, but no stage derivable from this roll call's own motionText, or no auto-fix pattern matched — needs manual review, not auto-fixed):")
    if unresolved_d:
        ok = False
        for e, m in unresolved_d:
            print(f"    {e['id']} {m.get('date')} {m.get('meetingSlug')}#{m.get('itemNumber')}")
            print(f"      whatAYeaDid: {e['whatAYeaDid']!r}")
            print(f"      motionText:  {m.get('motionText')!r}")
    else:
        print("  none.")

    total = (
        len(hits_a)
        + len(hits_b)
        + len(hits_c)
        + len(hits_d)
        + sum(len(members) for _, members in hits_e)
        + len(unresolved)
        + len(unresolved_d)
    )
    print(f"\n{'=' * 60}\nTotal reading-stage-label hits: {total}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
