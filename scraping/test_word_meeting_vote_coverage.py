#!/usr/bin/env python3
"""Regression tests for the pre-2018 WordMeeting.py vote-coverage fixes
(issue #199, PR stacked on fix/historical-rescrape).

Ground truth for the four "roll calls dropped" dates comes directly from
counting YEAS:/NAYS: occurrences in the raw eSCRIBE source HTML (see the
investigation on issue #199 for the methodology). 2015-11-09 SPPC is the
known-good committee baseline ("parsed clean" pre-fix) and must stay at
its already-correct 23/7 - a regression there would mean the section-key
disambiguation or the document-order walk broke a case that never needed
fixing.

Run: uv run test_word_meeting_vote_coverage.py
(or: python3 test_word_meeting_vote_coverage.py)
"""

import re
import sys
from datetime import datetime

from bs4 import BeautifulSoup

from WordMeeting import WordMeeting
from content import BARE_TITLE_TOKENS

failures = 0


def _vote_row_counts(meeting):
    yeas = nays = motions_with_vote = 0
    for item in meeting.items.values():
        for c in item.content:
            if hasattr(c, "vote") and c.vote.rows:
                motions_with_vote += 1
                for row in c.vote.rows:
                    label = row["vote"].lower()
                    if label.startswith("yea"):
                        yeas += 1
                    elif label.startswith("nay"):
                        nays += 1
    return yeas, nays, motions_with_vote


def check_coverage(label, filename, meeting_type, date, expected_yeas, expected_nays):
    """Full recovery: parsed Yeas/Nays rows must exactly equal the raw
    YEAS:/NAYS: occurrence counts in the source HTML - see issue #199 (d5)."""
    global failures
    path = f"test_samples/{filename}"
    html = open(path, encoding="utf-8", errors="replace").read()

    raw_yeas = len(re.findall(r"YEAS?:", html, re.IGNORECASE))
    raw_nays = len(re.findall(r"NAYS?:", html, re.IGNORECASE))
    assert raw_yeas == expected_yeas and raw_nays == expected_nays, (
        f"{label}: fixture's raw YEAS/NAYS counts changed ({raw_yeas}/{raw_nays}, "
        f"expected {expected_yeas}/{expected_nays}) - update the expectation only if "
        f"the fixture file itself was deliberately replaced"
    )

    soup = BeautifulSoup(html, "html.parser")
    try:
        meeting = WordMeeting(soup, "test_url", meeting_type, fallback_date=date)
    except Exception as e:
        failures += 1
        print(f"FAIL: {label}: WordMeeting() raised: {e}")
        return

    yeas, nays, motions_with_vote = _vote_row_counts(meeting)
    try:
        assert yeas == expected_yeas, f"expected {expected_yeas} Yeas rows, got {yeas}"
        assert nays == expected_nays, f"expected {expected_nays} Nays rows, got {nays}"
        print(f"PASS: {label} -> {motions_with_vote} motions, {yeas} Yeas rows, {nays} Nays rows")
    except AssertionError as e:
        failures += 1
        print(f"FAIL: {label}: {e}")


def check_no_guardrail_exception(label, filename, meeting_type, date):
    """The scrape-time coverage guardrail (issue #199 guardrail a) must not
    fire once the parser genuinely captures every roll call."""
    global failures
    path = f"test_samples/{filename}"
    html = open(path, encoding="utf-8", errors="replace").read()
    soup = BeautifulSoup(html, "html.parser")
    try:
        WordMeeting(soup, "test_url", meeting_type, fallback_date=date)
        print(f"PASS: {label}: guardrail did not fire")
    except Exception as e:
        failures += 1
        print(f"FAIL: {label}: guardrail raised unexpectedly: {e}")


def check_motion_text_attached(label, filename, meeting_type, date, min_real_text_fraction):
    """d2: most vote-bearing motions must carry their real motion text, not
    the boilerplate "Motion Passed"/"Motion Failed"/"Motion Carried" echo
    that extractMotionText() in generate-votes.ts would otherwise see."""
    global failures
    boilerplate_re = re.compile(r'^Motion\s+(Passed|Failed|Carried)(\s*\([^)]*\))?\.?$', re.IGNORECASE)

    path = f"test_samples/{filename}"
    html = open(path, encoding="utf-8", errors="replace").read()
    soup = BeautifulSoup(html, "html.parser")
    meeting = WordMeeting(soup, "test_url", meeting_type, fallback_date=date)

    total = real = 0
    for item in meeting.items.values():
        for c in item.content:
            if hasattr(c, "vote") and c.vote.rows:
                total += 1
                text = " ".join(p.string for p in c.motion_texts).strip()
                if text and not boilerplate_re.match(text):
                    real += 1

    fraction = real / total if total else 0
    try:
        assert total > 0, "expected at least one vote-bearing motion"
        assert fraction >= min_real_text_fraction, (
            f"only {real}/{total} ({fraction:.0%}) vote-bearing motions have real motion "
            f"text, expected >= {min_real_text_fraction:.0%}"
        )
        print(f"PASS: {label} -> {real}/{total} ({fraction:.0%}) vote-bearing motions have real text")
    except AssertionError as e:
        global failures
        failures += 1
        print(f"FAIL: {label}: {e}")


def check_section_key_disambiguation():
    """A repeated section number (each embedded committee report restarts
    its own numbering at 1, 2, 3...) must get its own dict entry instead of
    overwriting - and discarding the votes of - the earlier section that
    number was already used for (issue #199, root cause of d5)."""
    global failures
    path = "test_samples/Council - May 20, 2014.html"
    html = open(path, encoding="utf-8", errors="replace").read()
    soup = BeautifulSoup(html, "html.parser")
    meeting = WordMeeting(soup, "test_url", "Council", fallback_date=datetime(2014, 5, 20))

    try:
        assert len(meeting.items) > 9, (
            f"expected more than 9 section entries (numbers 1-9 each repeat), got "
            f"{len(meeting.items)} - looks like repeated section numbers are overwriting again"
        )
        print(f"PASS: section-key disambiguation -> {len(meeting.items)} distinct section entries")
    except AssertionError as e:
        failures += 1
        print(f"FAIL: section-key disambiguation: {e}")


def check_guardrail_fires_on_genuine_overcount():
    """The guardrail (issue #199 guardrail a) must fail loudly on an
    OVERcount too, not just an undercount - the guardrail was originally
    one-sided (only `parsed < raw`), which let 2015-05-26 Council ship 48
    parsed Yeas rows against 45 raw 'YEAS:' occurrences silently (issue
    #199 verification). This is a real fixture, not synthetic: even after
    the same-meeting duplicate-vote-block dedupe (_dedupe_repeated_vote_
    blocks) removes the one genuine duplicate it can safely identify (a
    named-mover amendment attached under two different items), a residual
    overcount remains and must still raise rather than ship quietly."""
    global failures
    path = "test_samples/Council - May 26, 2015.html"
    html = open(path, encoding="utf-8", errors="replace").read()
    soup = BeautifulSoup(html, "html.parser")

    try:
        WordMeeting(soup, "test_url", "Council", fallback_date=datetime(2015, 5, 26))
        failures += 1
        print("FAIL: guardrail did not raise for the known 2015-05-26 overcount")
    except ValueError as e:
        if "guardrail" in str(e).lower() and "more" in str(e).lower():
            print("PASS: guardrail raised for the known 2015-05-26 overcount")
        else:
            failures += 1
            print(f"FAIL: guardrail raised the wrong kind of error: {e}")


def check_dedupe_removes_repeated_named_motion():
    """issue #199 d5/verification: a floor amendment moved and seconded by
    name gets attached as a vote-bearing Motion under TWO different items
    in 2015-05-26 Council (the same physical roll call, not two
    coincidentally-identical ones) - _dedupe_repeated_vote_blocks must
    remove the later duplicate."""
    global failures
    path = "test_samples/Council - May 26, 2015.html"
    html = open(path, encoding="utf-8", errors="replace").read()
    soup = BeautifulSoup(html, "html.parser")
    # This meeting still fails the (correct) guardrail on a residual,
    # unresolved overcount - construct without triggering __init__'s
    # guardrail call so the dedupe itself can be checked in isolation.
    meeting = WordMeeting.__new__(WordMeeting)
    meeting.url = "test_url"
    meeting.meeting_type = "Council"
    word_section = soup.find('div', class_=lambda x: x and 'WordSection' in str(x)) or soup.find('body')
    meeting.paragraphs = [p for p in word_section.find_all('p') if p.get_text().strip()]
    meeting.tables = word_section.find_all('table')
    meeting.items = meeting.parse_agenda_structure(word_section)

    pre_dedupe_yeas = sum(
        1
        for item in meeting.items.values()
        for c in item.content
        if hasattr(c, "vote") and c.vote.rows
        for row in c.vote.rows
        if row["vote"].lower().startswith("yea")
    )
    meeting._dedupe_repeated_vote_blocks()
    post_dedupe_yeas = sum(
        1
        for item in meeting.items.values()
        for c in item.content
        if hasattr(c, "vote") and c.vote.rows
        for row in c.vote.rows
        if row["vote"].lower().startswith("yea")
    )

    try:
        assert pre_dedupe_yeas == 48, f"expected 48 Yeas rows before dedupe, got {pre_dedupe_yeas}"
        assert post_dedupe_yeas == 47, f"expected 47 Yeas rows after dedupe (one genuine duplicate removed), got {post_dedupe_yeas}"
        print(f"PASS: dedupe removed the known duplicate ({pre_dedupe_yeas} -> {post_dedupe_yeas} Yeas rows)")
    except AssertionError as e:
        failures += 1
        print(f"FAIL: dedupe-removes-repeated-named-motion: {e}")


def check_bare_title_tokens_filtered_from_word_meeting():
    """Regression test for the phantom "Chair"/"Vice Chair" voter entries
    this branch's re-scrape introduced in 2011-11-21 and 2013-04-16 (issue
    #199 Blocker B): WordMeeting.py's voter-name path (parse_names, shared
    by PRESENT/ALSO PRESENT/ABSENT parsing AND the Yeas:/Nays: roll-call
    parsing) must apply the same BARE_TITLE_TOKENS filter content.py's
    Vote.add_row and Meeting.py's get_names already had from #201, not a
    second hand-rolled copy of it - so this test imports the token set
    from content.py rather than hardcoding "Chair" itself, guaranteeing it
    stays in lockstep if the shared set ever changes.

    parse_names doesn't touch `self`, so it's callable unbound - no need
    to construct a full WordMeeting/BeautifulSoup fixture for this.
    """
    global failures
    ok = True

    # Reproduces the actual 2011-11-21 pattern: the presiding officer's
    # titles rendered as bare appositives inside a comma-joined list.
    real_world_text = "A. Haidar, Chair, K. Parker, Vice Chair, Argyle Community Association (ACA)"
    names = WordMeeting.parse_names(None, real_world_text)
    for token in ("Chair", "Vice Chair"):
        if token in names:
            ok = False
            print(f"FAIL: bare-title-filtered (real-world text): {token!r} survived parse_names -> {names}")
    if "A. Haidar" not in names or "K. Parker" not in names:
        ok = False
        print(f"FAIL: bare-title-filtered (real-world text): a real name was dropped -> {names}")

    # Every token in the shared set, individually, in a YEAS:-style list -
    # covers Deputy Mayor/Acting Mayor/Acting Chair too, not just the two
    # tokens the two known-bad meetings happened to exercise.
    for token in BARE_TITLE_TOKENS:
        text = f"P. Squire, J. Morgan, {token}, A. Hopkins"
        names = WordMeeting.parse_names(None, text)
        if token in names:
            ok = False
            print(f"FAIL: bare-title-filtered ({token!r}): survived parse_names -> {names}")
        if "P. Squire" not in names or "J. Morgan" not in names or "A. Hopkins" not in names:
            ok = False
            print(f"FAIL: bare-title-filtered ({token!r}): a real name was dropped -> {names}")

    # Exact match only, post-trim - a real name that merely CONTAINS a
    # title token as a substring must never be dropped.
    names = WordMeeting.parse_names(None, "R. Chairperson, S. Mayoral, T. Vice Chairman")
    if len(names) != 3:
        ok = False
        print(f"FAIL: bare-title-filtered (substring guard): expected 3 names kept, got {names}")

    if ok:
        print("PASS: bare-title-filtered: BARE_TITLE_TOKENS applied in WordMeeting.parse_names")
    else:
        failures += 1


def check_narration_prefix_stripped_from_boilerplate_motion():
    """Regression test for issue #199 punch list item 4:
    _is_boilerplate_motion must recognize a narration sentence ("At H:MM
    PM Councillor X leaves the meeting.") and/or the "The motion ... is
    put." transition FUSED into the same paragraph as the boilerplate
    result echo, not just when they're their own standalone paragraphs.

    Fused this way, the plain BOILERPLATE_RESULT_TEXT_RE match fails (real
    non-boilerplate narration text is glued onto the front), so
    _attach_content's look-behind merge never fires and the fused
    narration ships as motionText instead of the real recommendation - the
    fixer's own cited example, 2012-04-10 item 15#3: "At 9:50 PM Councillor
    H.L. Usher leaves the meeting. The motion to Approve clauses 9 to 15 is
    put. Motion Passed".

    parse_names-style: _is_boilerplate_motion is a staticmethod that only
    reads motion.motion_texts, so a minimal fake object is enough - no
    need to construct a full WordMeeting/BeautifulSoup fixture.
    """
    global failures
    ok = True

    class FakeParagraph:
        def __init__(self, string):
            self.string = string

    class FakeMotion:
        def __init__(self, texts):
            self.motion_texts = [FakeParagraph(t) for t in texts]

    def is_boilerplate(text):
        return WordMeeting._is_boilerplate_motion(FakeMotion([text]))

    # THE fixer's own cited example - narration + "is put" + result, all
    # fused into one paragraph.
    fused_narration_and_is_put = (
        "At 9:50 PM Councillor H.L. Usher leaves the\n  meeting.\n\xa0\n"
        "The motion to Approve clauses 9 to 15 is\n  put.\n\xa0\nMotion Passed"
    )
    if not is_boilerplate(fused_narration_and_is_put):
        ok = False
        print(f"FAIL: narration-prefix-stripped: fused narration+is-put+result not recognized as boilerplate")

    # Narration alone, fused with the result, no "is put" clause.
    if not is_boilerplate("Councillor S.E. White enters the meeting at 7:54 PM. Motion Passed"):
        ok = False
        print("FAIL: narration-prefix-stripped: fused narration+result not recognized as boilerplate")

    # "is put" alone, fused with the result, no narration.
    if not is_boilerplate("The motion to Approve clauses 1 to 4 is put. Motion Passed"):
        ok = False
        print("FAIL: narration-prefix-stripped: fused is-put+result not recognized as boilerplate")

    # The plain, unfused case (no peeling needed) must still work.
    if not is_boilerplate("Motion Passed"):
        ok = False
        print("FAIL: narration-prefix-stripped: plain boilerplate regressed")

    # Controls: a REAL substantive motion must never be misclassified as
    # boilerplate just because peeling found nothing to strip.
    real_motions = [
        "That the following actions be taken with respect to the 2nd Report of the London Housing Advisory Committee.",
        # Contains "reconvene" ~90 chars in, mid-sentence - not narration.
        "Approve that the meeting of the Approval Authority be adjourned and that the City Council reconvene as the Municipal Council.",
        "That Block 73, Plan 33M-119, BE DECLARED SURPLUS, and the subject lands BE TRANSFERRED to Drewlo Holdings Limited.",
    ]
    for text in real_motions:
        if is_boilerplate(text):
            ok = False
            print(f"FAIL: narration-prefix-stripped: real motion misclassified as boilerplate -> {text!r}")

    # A narration clause fused onto a REAL (non-boilerplate) continuation
    # must NOT be classified as boilerplate either - only peel-then-match-
    # BOILERPLATE_RESULT_TEXT_RE counts, not "something was peeled".
    if is_boilerplate(
        "At 9:50 PM Councillor H.L. Usher leaves the meeting. "
        "That the report of the Managing Director BE RECEIVED for information."
    ):
        ok = False
        print("FAIL: narration-prefix-stripped: narration + real continuation wrongly classified as boilerplate")

    if ok:
        print("PASS: narration-prefix-stripped: fused narration/is-put clauses recognized as boilerplate")
    else:
        failures += 1


def check_guardrail_fires_on_genuine_undercount():
    """The guardrail (issue #199 guardrail a) must actually fail loudly,
    not just pass quietly, when parsing genuinely drops a roll call."""
    global failures
    from WordMeeting import MeetingItem
    from content import Motion

    class BrokenWordMeeting(WordMeeting):
        def parse_agenda_structure(self, word_section):
            # Deliberately parse only a section header, never the vote -
            # simulates a real undercount so the guardrail has something
            # genuine to catch.
            section = MeetingItem.from_plain_data("1", "Test section")
            return {"1": section}

    path = "test_samples/Council - May 20, 2014.html"
    html = open(path, encoding="utf-8", errors="replace").read()
    soup = BeautifulSoup(html, "html.parser")

    try:
        BrokenWordMeeting(soup, "test_url", "Council", fallback_date=datetime(2014, 5, 20))
        failures += 1
        print("FAIL: guardrail did not raise for a deliberately broken parse")
    except ValueError as e:
        assert "guardrail" in str(e).lower()
        print("PASS: guardrail raised for a deliberately broken parse")
    except AssertionError as e:
        failures += 1
        print(f"FAIL: guardrail raised the wrong kind of error: {e}")


print("Testing WordMeeting.py vote-coverage fixes (issue #199)")
print("=" * 60)

# The four Council dates named in issue #199 as losing 34-61% of roll
# calls pre-fix. Expected counts are the raw YEAS:/NAYS: occurrence counts
# in the source HTML, confirmed once by direct inspection.
check_coverage("2014-05-20 Council", "Council - May 20, 2014.html", "Council", datetime(2014, 5, 20), 31, 3)
check_coverage("2014-11-11 Council", "Council - November 11, 2014.html", "Council", datetime(2014, 11, 11), 18, 3)
check_coverage("2016-08-30 Council", "Council - August 30, 2016.html", "Council", datetime(2016, 8, 30), 41, 16)
check_coverage("2017-06-13 Council", "Council - June 13, 2017.html", "Council", datetime(2017, 6, 13), 32, 5)

# Known-good committee baseline - must stay byte-identical in vote coverage.
check_coverage(
    "2015-11-09 SPPC (committee baseline, must stay clean)",
    "Strategic Priorities and Policy Committee - November 09, 2015.html",
    "Strategic Priorities and Policy Committee",
    datetime(2015, 11, 9),
    23,
    7,
)

# Fixtures already covered by test_parsing.py (2011-2018 Council/committee
# meetings) - the guardrail must not fire on any of them now.
for filename, mtype, date in [
    ("Council - December 06, 2011.html", "Council", datetime(2011, 12, 6)),
    ("Planning and Environment Committee - September 24, 2012.html", "Planning and Environment Committee", datetime(2012, 9, 24)),
    ("Council - November 19, 2013.html", "Council", datetime(2013, 11, 19)),
    ("Council - December 18, 2014.html", "Council", datetime(2014, 12, 18)),
    ("Council - December 08, 2015.html", "Council", datetime(2015, 12, 8)),
    ("Council - December 19, 2016.html", "Council", datetime(2016, 12, 19)),
    ("Council - December 12, 2017.html", "Council", datetime(2017, 12, 12)),
]:
    check_no_guardrail_exception(f"guardrail clean on {filename}", filename, mtype, date)

# d2: real motion text attached to the vote-bearing Motion object.
check_motion_text_attached(
    "2014-05-20 Council motion-text attachment", "Council - May 20, 2014.html", "Council", datetime(2014, 5, 20), 0.85
)
check_motion_text_attached(
    "2015-11-09 SPPC motion-text attachment",
    "Strategic Priorities and Policy Committee - November 09, 2015.html",
    "Strategic Priorities and Policy Committee",
    datetime(2015, 11, 9),
    0.85,
)

check_section_key_disambiguation()
check_bare_title_tokens_filtered_from_word_meeting()
check_narration_prefix_stripped_from_boilerplate_motion()
check_guardrail_fires_on_genuine_undercount()
check_guardrail_fires_on_genuine_overcount()
check_dedupe_removes_repeated_named_motion()

print("\n" + "=" * 60)
if failures:
    print(f"{failures} test(s) FAILED")
    sys.exit(1)
else:
    print("All tests passed!")
