import sys
from datetime import datetime
from process_meeting import process_meeting, get_processing_stats
from download_meeting import get_meetings, meeting_date, meeting_local_copy, meeting_minutes, get_meeting_types, get_meetings

target_meetings = [] # { meeting_type, date }

if len(sys.argv) == 3:
  # special option to test all meetings from a certain year
  # mostly to test parsing with random edge cases and inconsistencies
  if sys.argv[1] == "TEST_ALL_MEETINGS":
    for meeting_type in get_meeting_types():
      for m in get_meetings(meeting_type, int(sys.argv[2])):
        target_meetings.append({ "meeting_type": meeting_type, "date": meeting_date(m) })
    target_meetings.sort(key=lambda m: m["date"])

  # process specific meeting
  else: target_meetings = [{ "meeting_type": sys.argv[1], "date": datetime.strptime(sys.argv[2], "%Y-%m-%d") }]

# stay up to date on council meetings
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

def print_processing_results(text, meeting_list):
  if len(meeting_list) > 0:
    print(f"\n{len(meeting_list)} meeting{'' if len(meeting_list) == 1 else 's'} {text}:")
    for m in meeting_list:
      date = m["date"]
      meeting_type = m["meeting_type"]
      print(f"- '{meeting_type}' '{date.strftime('%Y-%m-%d')}'")
    print("")

for m in target_meetings:
  process_meeting(m["meeting_type"], m["date"])

(processed_list, error_list) = get_processing_stats()
print_processing_results("successfully processed", processed_list)
print_processing_results("could not be processed", error_list)
