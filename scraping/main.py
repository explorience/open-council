import sys
from datetime import datetime
from process_meeting import process_meeting, get_processing_stats
from download_meeting import get_meetings, meeting_date, meeting_local_copy, meeting_minutes, get_meeting_types

target_meetings = [] # { meeting_type, date }

if len(sys.argv) == 3:
  target_meetings = [{ "meeting_type": sys.argv[1], "date": datetime.strptime(sys.argv[2], "%Y-%m-%d") }]
else:
  current_year = datetime.now().year
  # check last year as well (for ex. if it's january, we might have some missed meetings in december)
  council_meetings = get_meetings("Council", current_year) + get_meetings("Council", current_year-1)
  sorted_meetings = sorted(council_meetings, key=meeting_date, reverse=True)
  meetings_w_minutes = [m for m in sorted_meetings if meeting_minutes(m)]

  meetings_to_process = []
  for m in meetings_w_minutes:
    if meeting_local_copy("Council", meeting_date(m)): break
    # prepend. this way, earlier meetings are processed first, and later ones can properly link to them
    target_meetings.insert(0, { "meeting_type": "Council", "date": meeting_date(m) })

if target_meetings == []:
  print("\nAlready up to date!")
  exit()

for m in target_meetings:
  print("Processing", m)
  process_meeting(m["meeting_type"], m["date"])
(processed_num, error_list) = get_processing_stats()
print(f"\nFinished processing {processed_num} meeting(s).")
if len(error_list) > 0:
  print(f"{len(error_list)} meeting(s) could not be processed:")
  for m in error_list:
    date = m["date"]
    meeting_type = m["meeting_type"]
    print(f"- {date.strftime('%Y-%m-%d')} {meeting_type}")
