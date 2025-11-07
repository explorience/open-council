#!/usr/bin/env python3
"""
Debug script to test any meeting by date
Usage: uv run debug_any_meeting.py YYYY-MM-DD [committee-name]
Example: uv run debug_any_meeting.py 2019-05-06
Example: uv run debug_any_meeting.py 2019-05-06 "Planning and Environment Committee"
"""

import sys
from datetime import datetime
from bs4 import BeautifulSoup
from download_meeting import get_meetings, get_from_web, BASE_URL
from process_meeting import process_meeting

if len(sys.argv) < 2:
    print("Usage: uv run debug_any_meeting.py YYYY-MM-DD [committee-name]")
    print("Example: uv run debug_any_meeting.py 2019-05-06")
    print("Example: uv run debug_any_meeting.py 2019-05-06 'Planning and Environment Committee'")
    sys.exit(1)

date_str = sys.argv[1]
test_date = datetime.strptime(date_str, "%Y-%m-%d")
committee = sys.argv[2] if len(sys.argv) > 2 else "Planning and Environment Committee"

print(f"\n🔍 Testing meetings for {committee} on {date_str}\n")
print("=" * 70)

# Get meetings for that year
year = test_date.year
month = test_date.month

meetings = get_meetings(committee, year)

# Look for meetings in the target month
found_meetings = []
for meeting in meetings:
    meeting_date = datetime.strptime(meeting['MeetingDate'], "%B %d, %Y")
    
    # Check if it's in the same month
    if meeting_date.month == month:
        found_meetings.append(meeting_date)

if not found_meetings:
    print(f"❌ No meetings found in {year}-{month:02d}")
    print(f"\nAll available meetings in {year}:")
    for meeting in meetings[:10]:  # Show first 10
        print(f"  - {meeting['MeetingDate']}")
    if len(meetings) > 10:
        print(f"  ... and {len(meetings) - 10} more")
else:
    print(f"Found {len(found_meetings)} meeting(s) in {year}-{month:02d}:")
    for meeting_date in found_meetings:
        print(f"  📅 {meeting_date.strftime('%B %d, %Y')}")
    print()
    
    # Try to process the first one
    print(f"Testing first meeting: {found_meetings[0].strftime('%Y-%m-%d')}")
    print("-" * 70)
    result = process_meeting(committee, found_meetings[0])
    
    if result:
        print(f"\n✅ Successfully parsed and saved to: {result}")
    else:
        print(f"\n❌ Failed to parse (check error messages above)")
