#!/usr/bin/env python3
"""Test the Vote parsing fix for 2018-2019 format, plus regression tests for
the "and"-fusion bug (see content.py Vote.add_row).

eSCRIBE joins the last voter in a multi-voter row with "and", with 0-2
spaces around it and with or without an Oxford comma depending on
era/rendering:
  - pre-2023ish: "A, B, and C"   (single space before "and")
  - 2024+:       "A, B,  and C"  (double space before "and")
The old code (`.replace(" and ", "")`) fused the last two names together
whenever the row used a single space (e.g. "B,C" instead of "B", "C") -
9,904 fused entries across 526 files, March 2018-May 2023, silently
dropped by downstream name normalization. It was accidentally dormant
since eSCRIBE started rendering the double space. A later "fix" of
`.replace(" and ", ", ")` looks plausible but is ALSO wrong: it leaves a
trailing comma on the double-space format ("B,  and C" -> "B,, C" ->
split gives "" between them) and on the single-space format leaves a
comma stuck to the wrong side. Run this file after any change to
Vote.add_row's voter-splitting logic.
"""

import sys
from bs4 import BeautifulSoup
from content import Vote

failures = 0


def check(label, html, expected_voters):
    global failures
    soup = BeautifulSoup(html, "html.parser")
    vote = Vote(soup.find(class_="MotionVoters"))
    try:
        assert len(vote.rows) == 1, f"expected 1 row, got {len(vote.rows)}"
        actual = vote.rows[0]["voters"]
        assert actual == expected_voters, f"expected {expected_voters!r}, got {actual!r}"
        print(f"PASS: {label} -> {actual}")
    except AssertionError as e:
        failures += 1
        print(f"FAIL: {label}: {e}")


def row_html(vote_label, voters_td, with_class=True):
    td_open = "<td class='VotesUsers' colspan='1' headers=''>" if with_class else "<td colspan='1'>"
    return f"""
<table class='MotionVoters'>
  <tr>
    <td class='VoterVote' colspan='1' headers=''>{vote_label}</td>
    {td_open}{voters_td}</td>
  </tr>
</table>
"""


print("Testing Vote Parsing")
print("=" * 60)

check(
    "2020+ format (VotesUsers class), 3 voters, no 'and'",
    row_html("Yeas:  (15)", "Mayor J. Morgan, A. Hopkins, S. Lewis"),
    ["Mayor J. Morgan", "A. Hopkins", "S. Lewis"],
)

check(
    "2018-2019 format (no VotesUsers class)",
    row_html("Yeas:  (15)", "Mayor E. Holder, M. van Holst, S. Lewis", with_class=False),
    ["Mayor E. Holder", "M. van Holst", "S. Lewis"],
)

# --- Regression: "and"-fusion bug ---

check(
    "Oxford comma, SINGLE space before 'and' (pre-2023 format - the bug trigger)",
    row_html("Yeas:  (13)", "S. Franke, D. Ferreira, and C. Rahman"),
    ["S. Franke", "D. Ferreira", "C. Rahman"],
)

check(
    "Oxford comma, DOUBLE space before 'and' (current live eSCRIBE format)",
    row_html("Absent:  (2)", "S. Hillier,  and S. Trosow"),
    ["S. Hillier", "S. Trosow"],
)

check(
    "Two voters, single space before 'and'",
    row_html("Absent:  (2)", "S. Hillier, and S. Trosow"),
    ["S. Hillier", "S. Trosow"],
)

check(
    "Long 14-voter row, double space before 'and' (real 2023-03-07 Council row)",
    row_html(
        "Yeas:  (14)",
        "Mayor J. Morgan, A. Hopkins, S. Lewis, S. Hillier, E. Peloza, "
        "P. Van Meerbergen, S. Lehman, H. McAlister, P. Cuddy, S. Stevenson, "
        "J. Pribil, S. Trosow, S. Franke,  and D. Ferreira",
    ),
    [
        "Mayor J. Morgan", "A. Hopkins", "S. Lewis", "S. Hillier", "E. Peloza",
        "P. Van Meerbergen", "S. Lehman", "H. McAlister", "P. Cuddy", "S. Stevenson",
        "J. Pribil", "S. Trosow", "S. Franke", "D. Ferreira",
    ],
)

# --- Regression: presiding-officer appositive ("phantom title") bug ---
# eSCRIBE renders the chair as an appositive inline with the voter list
# rather than attaching the title to a name, e.g.
# "P. Squire, J. Morgan, Acting Mayor, A. Hopkins, S. Lewis, S. Hillier,
#  and S. Lehman" - the chair's real name (J. Morgan) is already in the
# list, "Acting Mayor" is not a second voter. The comma-splitting logic
# has no way to tell a title apposition from a list separator, so it
# produced "Acting Mayor" as an eighth (phantom) entry in a row the
# minutes recorded as a 6-0 division. Real string, from the current
# corpus, 2021-08-30 Planning and Environment Committee, item 2.2:

check(
    "Real appositive string: 'Acting Mayor' dropped, minuted (6 to 0) reproduced",
    row_html(
        "Yeas:  (6)",
        "P. Squire, J. Morgan, Acting Mayor, A. Hopkins, S. Lewis, S. Hillier,  and S. Lehman",
    ),
    ["P. Squire", "J. Morgan", "A. Hopkins", "S. Lewis", "S. Hillier", "S. Lehman"],
)

check(
    "Bare 'Chair' appositive dropped, real name with 'Chair' substring survives",
    row_html("Yeas:  (2)", "J. Chair, Chair, S. Hillier"),
    ["J. Chair", "S. Hillier"],
)

print("\n" + "=" * 60)
if failures:
    print(f"{failures} test(s) FAILED")
    sys.exit(1)
else:
    print("All tests passed!")
