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
check_guardrail_fires_on_genuine_undercount()

print("\n" + "=" * 60)
if failures:
    print(f"{failures} test(s) FAILED")
    sys.exit(1)
else:
    print("All tests passed!")
