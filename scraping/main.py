from datetime import datetime
from process_meeting import process_meeting, get_processing_stats
from download_meeting import get_meetings, meeting_date, council_meeting_local_copy, meeting_minutes

council_meetings = get_meetings("Council")
sorted_meetings = sorted(council_meetings, key=meeting_date, reverse=True)

# find most recent meeting with minutes published
latest_meeting = None
for m in sorted_meetings:
  if meeting_minutes(m):
    latest_meeting = m
    break

latest_meeting_date = meeting_date(latest_meeting)
if council_meeting_local_copy(latest_meeting_date):
  print("\nAlready up to date!")
  exit()

process_meeting(latest_meeting_date, "Council")
(processed_num, error_list) = get_processing_stats()
print(f"\nFinished processing {processed_num} meetings.")
if len(error_list) > 0:
  print(f"{len(error_list)} meetings could not be processed:")
  for m in error_list:
    date = m["date"]
    meeting_type = m["meeting_type"]
    print(f"- {date} {meeting_type}")
