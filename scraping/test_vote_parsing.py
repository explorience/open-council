#!/usr/bin/env python3
"""Test the Vote parsing fix for 2018-2019 format."""

from bs4 import BeautifulSoup
from content import Vote

# Test case 1: 2020+ format with VotesUsers class
html_2020 = """
<table class='MotionVoters'>
  <tr>
    <td class='VoterVote' colspan='1' headers=''>Yeas:  (15)</td>
    <td class='VotesUsers' colspan='1' headers=''>Mayor J. Morgan, A. Hopkins, S. Lewis</td>
  </tr>
</table>
"""

# Test case 2: 2018-2019 format WITHOUT VotesUsers class
html_2018 = """
<table class='MotionVoters'>
  <tr>
    <td class='VoterVote' colspan='1'>Yeas:  (15)</td>
    <td colspan='1'>Mayor E. Holder, M. van Holst, S. Lewis</td>
  </tr>
</table>
"""

print("Testing Vote Parsing Fix")
print("=" * 60)

# Test 2020+ format
print("\n=== Test 1: 2020+ format (with VotesUsers class) ===")
try:
    soup = BeautifulSoup(html_2020, 'html.parser')
    vote = Vote(soup.find(class_='MotionVoters'))
    print(f"✅ SUCCESS: Parsed {len(vote.rows)} vote row(s)")
    print(f"   Vote type: {vote.rows[0]['vote']}")
    print(f"   Voters: {vote.rows[0]['voters']}")
except Exception as e:
    print(f"❌ FAILED: {e}")

# Test 2018-2019 format
print("\n=== Test 2: 2018-2019 format (without VotesUsers class) ===")
try:
    soup = BeautifulSoup(html_2018, 'html.parser')
    vote = Vote(soup.find(class_='MotionVoters'))
    print(f"✅ SUCCESS: Parsed {len(vote.rows)} vote row(s)")
    print(f"   Vote type: {vote.rows[0]['vote']}")
    print(f"   Voters: {vote.rows[0]['voters']}")
except Exception as e:
    print(f"❌ FAILED: {e}")

print("\n" + "=" * 60)
print("Both formats should parse successfully!")
