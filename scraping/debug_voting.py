#!/usr/bin/env python3
"""
Debug script to examine voting HTML structure
Usage: uv run debug_voting.py URL
Example: uv run debug_voting.py "https://pub-london.escribemeetings.com/Meeting.aspx?Id=09f9f1eb-890f-43d1-9aa8-274eb2a22fef&Agenda=PostMinutes&lang=English"
"""

import sys
from download_meeting import get_from_web
from bs4 import BeautifulSoup

if len(sys.argv) < 2:
    # Default to May 2019 meeting
    url = 'https://pub-london.escribemeetings.com/Meeting.aspx?Id=09f9f1eb-890f-43d1-9aa8-274eb2a22fef&Agenda=PostMinutes&lang=English'
    print(f"No URL provided, using default May 2019 meeting")
else:
    url = sys.argv[1]

print(f"\n🔍 Examining voting HTML structure\n")
print(f"URL: {url}\n")
print("=" * 70)

html = get_from_web(url)
soup = BeautifulSoup(html, 'html.parser')

# Find all motions with votes
motions = soup.find_all(class_='MotionVoters')

if not motions:
    print('❌ No MotionVoters found in this meeting')
else:
    print(f'✅ Found {len(motions)} motion(s) with votes\n')
    
    for i, motion in enumerate(motions[:3], 1):  # Show first 3
        print(f"Motion {i}:")
        print("-" * 70)
        print(motion.prettify()[:1500])
        print("...\n")
        
        # Check for specific classes
        print(f"  Has .VotesUsers class: {motion.find(class_='VotesUsers') is not None}")
        print(f"  Has .MotionVotersLabel class: {motion.find(class_='MotionVotersLabel') is not None}")
        print(f"  Has table: {motion.find('table') is not None}")
        print()
