#!/usr/bin/env python3
"""Debug the Vote parsing."""

from bs4 import BeautifulSoup

html_2018 = """
<table class='MotionVoters'>
  <tr>
    <td class='VoterVote' colspan='1'>Yeas:  (15)</td>
    <td colspan='1'>Mayor E. Holder, M. van Holst, S. Lewis</td>
  </tr>
</table>
"""

soup = BeautifulSoup(html_2018, 'html.parser')
table = soup.find(class_='MotionVoters')

print("Table:", table.name if table else None)
print("\nTRs found:", len(table.find_all('tr')) if table else 0)

for tr in table.find_all('tr'):
    print(f"\nTR contents count: {len(tr.contents)}")
    print(f"TR contents: {tr.contents}")
    print(f"TR children (tags only): {list(tr.children)}")

    tds = tr.find_all('td')
    print(f"TDs found: {len(tds)}")
    for i, td in enumerate(tds):
        print(f"  TD {i}: class={td.get('class')}, text={td.get_text().strip()[:50]}")
