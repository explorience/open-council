#!/usr/bin/env python3
"""
Backfill script to download all historical meeting minutes.

Usage:
  python backfill.py              # Download all meetings from 2010 to present
  python backfill.py 2015         # Download all meetings from 2015 to present
  python backfill.py 2018 2020    # Download meetings from 2018 to 2020 (inclusive)
"""

import sys
from datetime import datetime
from process_meeting import process_meeting, get_processing_stats
from download_meeting import get_meetings, meeting_date, meeting_local_copy, meeting_minutes, get_meeting_types

# Configuration
DEFAULT_START_YEAR = 2010  # Adjust this if you want to go further back

target_meetings = []
without_minutes = []
already_downloaded = []

# Parse command line arguments
if len(sys.argv) == 1:
    # No arguments - download from DEFAULT_START_YEAR to present
    start_year = DEFAULT_START_YEAR
    end_year = datetime.now().year
elif len(sys.argv) == 2:
    # One argument - download from specified year to present
    start_year = int(sys.argv[1])
    end_year = datetime.now().year
elif len(sys.argv) == 3:
    # Two arguments - download from start_year to end_year
    start_year = int(sys.argv[1])
    end_year = int(sys.argv[2])
else:
    print(__doc__)
    sys.exit(1)

print(f"\n🔍 Scanning for meeting minutes from {start_year} to {end_year}...")
print(f"📋 This will check all meeting types for each year.\n")

# Collect all meetings across all years
years = range(start_year, end_year + 1)
total_meetings_found = 0

for year in years:
    print(f"Checking {year}...", end=" ", flush=True)
    year_count = 0
    
    for meeting_type in get_meeting_types():
        meetings = get_meetings(meeting_type, year)
        
        for m in meetings:
            d = meeting_date(m)
            meeting_info = {"meeting_type": meeting_type, "date": d}
            
            # Skip if no minutes available
            if not meeting_minutes(m):
                without_minutes.append(meeting_info)
                continue
            
            # Skip if already downloaded
            if meeting_local_copy(meeting_type, d):
                already_downloaded.append(meeting_info)
                continue
            
            # Add to processing queue
            target_meetings.append(meeting_info)
            year_count += 1
    
    total_meetings_found += year_count
    if year_count > 0:
        print(f"found {year_count} new meetings to download")
    else:
        print("no new meetings")

print(f"\n📊 Summary:")
print(f"   • Found {len(target_meetings)} meetings to download")
print(f"   • Skipped {len(already_downloaded)} already downloaded")
print(f"   • Skipped {len(without_minutes)} without published minutes")

if target_meetings == []:
    print("\n✅ All historical meetings are already downloaded!")
else:
    print(f"\n⬇️  Starting download of {len(target_meetings)} meetings...")
    print("   (Processing oldest meetings first for better cross-referencing)\n")
    
    # Sort by date - oldest first
    # This ensures newer meetings can link to already-processed older meetings
    for i, m in enumerate(sorted(target_meetings, key=lambda m: m["date"]), 1):
        print(f"[{i}/{len(target_meetings)}] Processing {m['meeting_type']} from {m['date'].strftime('%Y-%m-%d')}...")
        process_meeting(m["meeting_type"], m["date"])

# Print final statistics
def print_processing_results(text, meeting_list):
    if len(meeting_list) > 0:
        print(f"\n{len(meeting_list)} meeting{'' if len(meeting_list) == 1 else 's'} {text}:")
        for m in meeting_list[:10]:  # Show first 10
            date = m["date"]
            meeting_type = m["meeting_type"]
            print(f"   • '{meeting_type}' '{date.strftime('%Y-%m-%d')}'")
        
        if len(meeting_list) > 10:
            print(f"   ... and {len(meeting_list) - 10} more")

print("\n" + "="*70)
print("📈 BACKFILL COMPLETE")
print("="*70)

(processed_list, error_list) = get_processing_stats()
print_processing_results("✅ successfully processed", processed_list)
print_processing_results("❌ could not be processed", error_list)

print()
