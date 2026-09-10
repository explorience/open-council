#!/usr/bin/env python3
"""
Round-7 gate item A (re-anchored round-8, item B): corpus-wide guard that NO
verified entry's whatAYeaDid (post corrections.json merge -- see
lib_corrections.load_merged), once any corpus HEDGE PREFIX is stripped from
its front, opens with a voter-STANCE verb -- a verb that describes what the
VOTER FELT about a motion (agreement/endorsement) rather than what the
MOTION ITSELF did.

ROUND-8 FIX (hedge-blind anchor): round-7's check anchored the stance-verb
regex to the literal string start, so a stance verb hiding behind this
corpus's own Failed-motion hedge passed undetected -- "Would have supported
X" reads exactly as agreement-flavored as "Supported X" once the hedge is
stripped, and on a header-less ladder-exclusion bullet paired with a
non-Yea vote it still asserts the opposite of that vote (round-8's own
exhibit: a-hopkins.md L446, "- Nay: Would have supported excluding
Business Case No. P-2 (Middlesex-London Health Unit Debt Retirement)...
reducing the 2026 tax levy by $2,366,000." reads as Hopkins supporting a
cut to Health Unit funding her recorded Nay opposed). Fixed by stripping
every enumerated HEDGE_PREFIXES entry from the front of the label (if
present) before running the same STANCE_VERB_RE match against whatever
remains, so "Would have Supported X" is caught exactly like "Supported X".

ENUMERATED HEDGE PREFIXES: a full corpus scan (every whatAYeaDid, post
corrections.json merge, grouped by first two words) turns up exactly one
hedge construction in current use -- "Would have " (277 rows, all of them
Failed-motion labels; see sweep-failed-motion-yea.py). No other hedge
variant ("Had ... passed", "If approved, ...", etc.) exists in the corpus
today. HEDGE_PREFIXES is still a list, not a single constant, so a future
Failed-motion phrasing sweep can add a new hedge to this one place with a
self-test to prove it strips correctly, per this repo's established
sweep-script convention.

WHY THIS MATTERS (the actual defect, not just a style nit): whatAYeaDid is
rendered for every voter on a motion, not just its Yea voters -- both in
the main evidence table (behind a "What a yea did" column header) and, for
a same-decision-group collision, as a header-LESS ladder-exclusion bullet:
"- <Vote>: <whatAYeaDid> -- <link> (...)". A stance verb reads as a claim
about voter agreement regardless of which column/context it sits in, so on
a header-less bullet paired with a non-Yea vote it asserts the opposite of
that vote standing alone -- round-6's own exhibit was
"- Nay: Supported final enactment of the added by-laws..." (a-hopkins.md
L34, 801 Sarnia Road), which reads as Hopkins supporting exactly what his
recorded Nay opposed. The header-bearing evidence-table cells aren't exempt
either: the corpus's own established convention describes what the MOTION
DID ("Gave first reading to...", "Approved...", "Directed...", "Adopted...",
or the hedged "Would have..." construction on a Failed motion) precisely so
the same text is unambiguously true regardless of context or vote -- a
stance verb breaks that invariant by construction, everywhere it appears,
which is why this check is corpus-wide and unconditional rather than scoped
to header-less bullets only.

ENUMERATED STANCE-VERBS (the whole list, not just this round's strings --
per the gate brief's own instruction to enumerate the CLASS, not just the
instances found this round): "Supported", "Backed", "Endorsed" -- each
checked case-insensitively, anchored to the start of the label. "Endorsed"
is included even though a motion's own operative clause sometimes literally
reads "BE ENDORSED": the corpus's established action-voice vocabulary
(Approved/Adopted/Directed/Gave, etc.) already covers every real
council action, "Endorsed" included, without needing a
personal-agreement-flavored verb at all -- see round-7 item A's own fixes,
which reworded every "Endorsed ..." row to "Adopted ..." or "Approved ..."
per what each motion's own quote showed Council actually did.

This list is deliberately a literal, maintained enumeration (not a broader
heuristic like "any verb that can mean agreement") so it stays auditable and
extending it to a genuinely new observed stance-verb is a one-line change
with a self-test to prove it bites, per this repo's own established
sweep-script convention (see e.g. sweep-outcome-verb-inversion.py's
OUTCOME_VERBS list).

KNOWN ACCURATE VOICE VARIANTS -- deliberately NOT flagged by this check
(round-7 gate explicitly deferred these, round-8 gate leaves them
untouched): a minority-but-accurate voice describes what a *specific vote*
did rather than the motion in the abstract, and neither family opens with
an enumerated stance verb --
  - "In final vote, approved ..." (68 rows) -- names the vote explicitly
    (distinguishing it from an earlier procedural vote on the same item),
    then uses the same motion-action voice as everything else.
  - "A yea ..." (55 rows) -- e.g. "A yea restored/kept/added ...", third-
    person-conditional phrasing that states what a yea vote's effect was,
    not what the voter felt; reads the same regardless of context.
Both are accurate under the same "true regardless of which vote/context it
renders into" test this check enforces; they're a distinct wording
convention, not a stance-verb defect, so this guard has no rule for them.

GATE ROUND 9 ITEM B (mid-sentence COORDINATED stance-verb predicate): every
case above is about the OPENING word of whatAYeaDid. A stance verb can also
appear as a SECOND predicate of the same subject, coordinated onto a first,
already-correct action-voice predicate -- "Approved introducing a by-law
..., and supported draft approval of ..." (960505d7bb80) is exactly as much
a personal-agreement claim as an opening "Supported draft approval of ..."
would be; it just isn't the first word, so the round-7/8 anchor-at-start
check waved it through.

DETECTION RULE for the mid-sentence class (the whole rule, not a summary):
a stance verb is flagged when it is BOTH --

  1. COORDINATOR-PRECEDED: the verb is the very next word after one of
     three literal boundary tokens -- "and " / ", " / "; " (case-
     insensitive, any run of whitespace after the token) -- immediately
     to its left. This is what distinguishes a genuine second PREDICATE
     ("..., and supported draft approval of a 30-lot subdivision") from
     every other way these three verbs occur mid-string in the corpus: as
     an ADJECTIVE/NOUN-MODIFIER preceded by an article ("the endorsed
     safety programs"), a bare noun ("Development Charges supported"), a
     negation ("were not supported"), a relative pronoun ("which endorsed
     it"), or as half of a hyphenated compound ("supported-housing",
     "tax-supported") -- a full corpus scan (every whatAYeaDid, post
     corrections.json merge, every mid-string occurrence of the three
     verbs) turns up exactly zero of those incidental shapes immediately
     preceded by "and "/", "/"; ", so this boundary alone already
     separates every current genuine hit from every current incidental
     one. Not "e.g." -- this is the full, literal set, same enumerated-
     list convention as STANCE_VERBS/HEDGE_PREFIXES above; extending it to
     a genuinely new observed coordinator is a one-line change with a
     self-test, per this repo's convention (see 35d6a5473517's
     corrections.json entry for one such case -- "plus endorsed ..." --
     resolved by hand rather than added here, since it was a single
     instance rather than an established corpus pattern).

  2. TRANSITIVE-OBJECT FOLLOWS (the POS-ish part, defense in depth beyond
     #1 -- not load-bearing against any hit in today's corpus, since #1
     alone already separates today's genuine/incidental rows, but kept as
     an independent, principled check rather than relying solely on the
     coordinator boundary holding forever): a stance verb used as a real
     predicate is transitive and takes a direct-object noun phrase --
     "supported/endorsed/backed X". So it is NOT flagged when nothing that
     could be an object follows:
       (a) the very next character is a hyphen with no space ("and
           supported-housing spaces") -- a hyphenated compound modifier is
           one lexical unit, not verb+object;
       (b) the following text, after leading whitespace, is empty or
           starts with a closing/terminal punctuation mark (. , ; )) --
           "..., and Development Charges supported." has nothing to its
           right to be an object, so "supported" here is a POSTPOSED
           ADJECTIVE modifying "Development Charges", not a predicate.
     Neither shape occurs in the corpus immediately after a coordinator
     today, but a future row could combine both signals in a way #1 alone
     wouldn't safely rule out, which is why this check exists as a second,
     independent gate rather than being folded away.

This is a DIFFERENT defect than the KNOWN ACCURATE VOICE VARIANTS section
above ("In final vote, approved ...", "A yea ..."): neither of those opens
OR coordinates a stance verb at all.

Usage: python3 scripts/election/verify-no-stance-verb-whataeadid.py
       python3 scripts/election/verify-no-stance-verb-whataeadid.py --self-test
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_corrections as lc  # noqa: E402

STANCE_VERBS = ["Supported", "Backed", "Endorsed"]
STANCE_VERB_RE = re.compile(
    r"^(" + "|".join(re.escape(v) for v in STANCE_VERBS) + r")\b", re.IGNORECASE
)

# Round-9 gate item B: coordinated mid-sentence stance-verb predicate --
# the verb immediately preceded by one of these three literal boundary
# tokens is a candidate second predicate (see module docstring for the
# full rule and why this list is complete, not illustrative).
COORD_MARKERS = ["and ", ", ", "; "]
MID_COORD_STANCE_RE = re.compile(
    r"(?:\band\s+|,\s+|;\s+)(" + "|".join(re.escape(v) for v in STANCE_VERBS) + r")\b",
    re.IGNORECASE,
)
# Round-9 gate item B: following-token discriminator (rule #2 in the module
# docstring) -- a genuine transitive predicate must be followed by
# something that can be its object; a hyphenated compound or a
# postposed/no-object tail is not a predicate use.
_NO_OBJECT_LEADING_CHARS = set(".,;)")


def _is_transitive_predicate_use(text: str, match: re.Match) -> bool:
    following = text[match.end():]
    if following.startswith("-"):
        return False  # hyphenated compound modifier, e.g. "supported-housing"
    stripped = following.lstrip()
    if not stripped or stripped[0] in _NO_OBJECT_LEADING_CHARS:
        return False  # nothing that could be a direct object follows
    return True


def find_mid_sentence_violations(entries: dict) -> list[tuple[str, str, str]]:
    violations = []
    for mid, e in entries.items():
        text = e.get("whatAYeaDid", "") or ""
        if not text:
            continue
        for m in MID_COORD_STANCE_RE.finditer(text):
            if _is_transitive_predicate_use(text, m):
                violations.append((mid, text, m.group(0)))
                break  # one flagged hit per row is enough
    return violations

# Round-8 gate item B: corpus-wide hedge prefixes that must be stripped from
# the front of whatAYeaDid BEFORE testing for a stance verb, so "Would have
# Supported X" is caught exactly like "Supported X" rather than passing
# because the check anchored past the hedge. Enumerated by scanning every
# whatAYeaDid in the corpus (post corrections.json merge) grouped by its
# first two words -- see this module's docstring for the scan result.
HEDGE_PREFIXES = ["Would have "]


def strip_hedge(text: str) -> str:
    for prefix in HEDGE_PREFIXES:
        if text.startswith(prefix):
            return text[len(prefix):]
    return text


def find_violations(entries: dict) -> list[tuple[str, str]]:
    """Opening-position stance-verb hits only (round-7/8 rule). Kept
    separate from the mid-sentence rule (find_mid_sentence_violations)
    because the self-test below needs to prove each rule independently."""
    violations = []
    for mid, e in entries.items():
        text = e.get("whatAYeaDid", "") or ""
        if not text:
            continue
        if STANCE_VERB_RE.match(strip_hedge(text)):
            violations.append((mid, text))
    return violations


def find_all_violations(entries: dict) -> list[tuple[str, str, str]]:
    """Union of both rules: opening-position (round-7/8) and mid-sentence
    coordinated-predicate (round-9 item B). Each tuple is (id, text, kind)."""
    combined = [(mid, text, "opening") for mid, text in find_violations(entries)]
    combined += [(mid, text, "mid-sentence") for mid, text, _verb in find_mid_sentence_violations(entries)]
    return combined


def run_check(corrections_override=None) -> tuple[int, list[str]]:
    entries = lc.load_verified_entries()
    motions = lc.load_all_motions()
    corrections = (
        corrections_override
        if corrections_override is not None
        else lc.load_corrections()
    )
    lc.apply_corrections(entries, motions, corrections)

    violations = find_all_violations(entries)

    msgs = [
        f"Scanned {len(entries)} verified entries (post corrections.json merge).",
        f"whatAYeaDid rows with a stance verb ({', '.join(STANCE_VERBS)}), opening or mid-sentence coordinated: {len(violations)}",
    ]
    if violations:
        msgs.append("\nFAILED — stance-verb whatAYeaDid rows found:")
        for mid, text, kind in sorted(violations):
            msgs.append(f" - {mid} [{kind}]: {text}")
        return 1, msgs
    msgs.append("\nALL CHECKS PASSED")
    return 0, msgs


# Round-8 gate item B: negative-test PER VERB, hedged AND unhedged -- six
# reverts total (2 forms x 3 verbs), each applied ALONE (never touches
# corrections.json) and required to independently produce exit 1, to prove
# HEDGE_PREFIXES-stripping actually changes what this check catches rather
# than merely not regressing the round-7 unhedged cases. The unhedged three
# are round-7's own reverts (still required to keep failing on their own).
# The hedged three revert real round-8 corrections.json ids to their PRE-
# round-8 "Would have <stance-verb> ..." text where a real one exists
# (917b3609658b, 06f690a36f3c); no real "Would have Backed ..." row has ever
# existed in the corpus (mirroring the unhedged "Backed" case below), so
# cb38db322931's hedged fixed text is mutated to a synthetic "Would have
# backed ..." to prove the regex bites that verb hedged too.
_SELF_TEST_REVERTS = {
    # -- unhedged (round-7 forms; must keep failing) --
    ("ed87fe805530", "whatAYeaDid"): "Supported final enactment of the by-law redividing the City of London's wards.",
    ("af8a22f08328", "whatAYeaDid"): "Endorsed London's Highly Supportive Housing Plan (Schedule 1) as the city's approach to its Health & Homelessness Whole of Community System Response.",
    ("6d5fac41d698", "whatAYeaDid"): "Backed the finding that the 2nd Report of the Strategic Opportunities Review Working Group had already been considered by Council on July 23, 2024.",
    # -- hedged (round-8 forms; the actual defect class this round fixes) --
    ("917b3609658b", "whatAYeaDid"): "Would have supported referring the Community Encampment Response Plan buffer-distance guidelines (proximity limits from schools, playgrounds, residences, and sports fields) back to Civic Administration to report back with additional distance options, rather than adopting final guidelines.",
    ("06f690a36f3c", "whatAYeaDid"): "Would have endorsed a 25-metre setback requirement for the Community Encampment Response Plan from any private residential property line with a habitable dwelling, per the Building Code.",
    ("cb38db322931", "whatAYeaDid"): "Would have backed the Whole of Community System Response Hubs Implementation Plan to a future special meeting that would include a public participation meeting, rather than deciding it that day.",
}

# Round-9 gate item B: mid-sentence coordinated-predicate negative tests,
# BOTH directions --
#   (1) revert each of the two real corrections.json fixes for this defect
#       (960505d7bb80, f6361a61d337) back to its genuine pre-fix "... and
#       supported/endorsed ..." text -- this IS "plant 'and supported X'",
#       using the corpus's own real defect text rather than a synthetic
#       string, and each must independently produce exit 1;
#   (2) separately (not a revert -- these ids were never wrong) confirm the
#       three ids matching the brief's own named incidental-usage examples
#       stay UNFLAGGED at their real, current (post-corrections) text:
#       5df56cf1e54e ("... 10 supported-housing spaces ..."), b57d09343f08
#       ("... the endorsed safety and security programs ..."),
#       7c2d6c2f7bc8 ("... Development Charges supported.").
_SELF_TEST_MID_SENTENCE_REVERTS = {
    ("960505d7bb80", "whatAYeaDid"): "Approved introducing a by-law to rezone 355 Marconi Boulevard from Restricted Service Commercial to Holding Residential R1, and supported draft approval of a 30-lot single-detached residential subdivision on the property.",
    ("f6361a61d337", "whatAYeaDid"): "Approved Official Plan and zoning amendments for 323 Oxford Street West and 92/825 Proudfoot Lane permitting building heights up to 18 storeys, and endorsed a draft plan of subdivision with medium- and high-density residential blocks.",
}
_SELF_TEST_NOUN_PHRASE_IDS_STAY_CLEAN = ["5df56cf1e54e", "b57d09343f08", "7c2d6c2f7bc8"]


def _revert_one(base: list[dict], key: tuple[str, str], revert_text: str) -> list[dict]:
    """Return a copy of `base` with the LAST correction matching `key`
    (an id may be corrected more than once in file order, e.g. 917b3609658b
    picked up its 'Would have ' hedge in one entry and its stance-verb fix
    in a later one -- only the last entry in the chain determines the
    field's final value) mutated so its `now` equals `revert_text` (raises
    if not found, or if it's already at the revert value, since that would
    prove nothing)."""
    last_idx = None
    for idx, c in enumerate(base):
        if (c["id"], c["field"]) == key:
            last_idx = idx
    if last_idx is None:
        raise AssertionError(f"no corrections.json entry found for {key}")
    if base[last_idx]["now"] == revert_text:
        raise AssertionError(f"{key} is already at the revert text -- self-test proves nothing")
    mutated = list(base)
    mutated[last_idx] = dict(mutated[last_idx])
    mutated[last_idx]["now"] = revert_text
    return mutated


def self_test() -> int:
    base = lc.load_corrections()
    print(f"=== self-test: {len(_SELF_TEST_REVERTS)} reverts, each applied alone, each must exit 1 ===")
    for key, revert_text in _SELF_TEST_REVERTS.items():
        mutated = _revert_one(base, key, revert_text)
        code, msgs = run_check(corrections_override=mutated)
        if code != 1:
            print("\n".join(msgs))
            print(f"SELF-TEST FAILED: reverting {key} to {revert_text!r} did not produce exit 1")
            return 1
        entries = lc.load_verified_entries()
        lc.apply_corrections(entries, lc.load_all_motions(), mutated)
        flagged_ids = {mid for mid, _ in find_violations(entries)}
        if key[0] not in flagged_ids:
            print(f"SELF-TEST FAILED: expected {key[0]} flagged, got {flagged_ids}")
            return 1
        print(f" - {key}: reverted to {revert_text!r} -> exit 1 (confirmed flagged)")

    print(f"\n=== self-test: {len(_SELF_TEST_MID_SENTENCE_REVERTS)} mid-sentence reverts (round-9 item B), each applied alone, each must exit 1 ===")
    for key, revert_text in _SELF_TEST_MID_SENTENCE_REVERTS.items():
        mutated = _revert_one(base, key, revert_text)
        code, msgs = run_check(corrections_override=mutated)
        if code != 1:
            print("\n".join(msgs))
            print(f"SELF-TEST FAILED: reverting {key} to {revert_text!r} did not produce exit 1")
            return 1
        entries = lc.load_verified_entries()
        lc.apply_corrections(entries, lc.load_all_motions(), mutated)
        flagged_ids = {mid for mid, _text, _verb in find_mid_sentence_violations(entries)}
        if key[0] not in flagged_ids:
            print(f"SELF-TEST FAILED: expected {key[0]} flagged by the mid-sentence rule, got {flagged_ids}")
            return 1
        print(f" - {key}: reverted to {revert_text!r} -> exit 1 (confirmed flagged, mid-sentence rule)")

    print(f"\n=== self-test: {len(_SELF_TEST_NOUN_PHRASE_IDS_STAY_CLEAN)} known incidental noun-phrase ids (real, current text) must stay UNFLAGGED ===")
    entries_now = lc.load_verified_entries()
    lc.apply_corrections(entries_now, lc.load_all_motions(), lc.load_corrections())
    mid_flagged_now = {mid for mid, _text, _verb in find_mid_sentence_violations(entries_now)}
    for eid in _SELF_TEST_NOUN_PHRASE_IDS_STAY_CLEAN:
        if eid not in entries_now:
            print(f"SELF-TEST FAILED: {eid} not found in verified entries -- can't confirm it stays clean")
            return 1
        if eid in mid_flagged_now:
            print(f"SELF-TEST FAILED: {eid} ({entries_now[eid]['whatAYeaDid']!r}) was incorrectly flagged by the mid-sentence rule")
            return 1
        print(f" - {eid}: {entries_now[eid]['whatAYeaDid']!r} -> correctly NOT flagged")

    print("\n=== self-test: restore (no mutations), expect exit 0 ===")
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
