#!/usr/bin/env python3
"""Debug script to test a specific failed meeting and see the actual error."""

from datetime import datetime
from process_meeting import process_meeting

# Test one of the failed meetings from 2015
meeting_type = "Planning and Environment Committee"
date = datetime(2015, 1, 5)

print(f"\n🔍 Testing failed meeting: {meeting_type} on {date.strftime('%Y-%m-%d')}\n")
print("="*70)

result = process_meeting(meeting_type, date)

if result:
    print(f"\n✅ Success! Saved to: {result}")
else:
    print(f"\n❌ Failed - check error output above")
