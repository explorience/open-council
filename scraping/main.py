import sys
from datetime import datetime, timedelta
from process_meeting import process_meeting, get_processing_stats
from download_meeting import get_meetings, meeting_date, meeting_local_copy, meeting_minutes, get_meeting_types, get_meetings

target_meetings = [] # { meeting_type, date }
without_minutes = [] # { meeting_type, date }

if len(sys.argv) == 3:
  # special option to test all meetings from a certain year
  # mostly to test parsing with random edge cases and inconsistencies
  if sys.argv[1] == "TEST_ALL_MEETINGS":
    year = int(sys.argv[2])
    for meeting_type in get_meeting_types(year):
      for m in get_meetings(meeting_type, year):
        target_meetings.append({ "meeting_type": meeting_type, "date": meeting_date(m) })

  # process specific meeting
  else: target_meetings = [{ "meeting_type": sys.argv[1], "date": datetime.strptime(sys.argv[2], "%Y-%m-%d") }]

# stay up to date on council meetings (check from last 6 months)
else:
  now = datetime.now()
  six_months_ago = now - timedelta(weeks=26) # 26 = 52 / 2
  years = list(set([now.year, six_months_ago.year]))

  for meeting_type in get_meeting_types():
    meetings = [meeting for year in years for meeting in get_meetings(meeting_type, year)]
    for m in meetings:
      d = meeting_date(m)
      meeting_info = { "meeting_type": meeting_type, "date": d }
      if not meeting_minutes(m):
        without_minutes.append(meeting_info)
        continue
      if meeting_local_copy(meeting_type, d): continue
      target_meetings.append(meeting_info)

if target_meetings == []:
  print("\nAlready up to date!")
else:
  # sort so that we process oldest meetings first
  # this means that newer meetings will be able to link to the already-processed older meetings
  for m in sorted(target_meetings, key=lambda m: m["date"]):
    process_meeting(m["meeting_type"], m["date"])

def print_processing_results(text, meeting_list):
  if len(meeting_list) > 0:
    print(f"\n{len(meeting_list)} meeting{'' if len(meeting_list) == 1 else 's'} {text}:")
    for m in meeting_list:
      date = m["date"]
      meeting_type = m["meeting_type"]
      print(f"- '{meeting_type}' '{date.strftime('%Y-%m-%d')}'")

(processed_list, error_list) = get_processing_stats()
print_processing_results("successfully processed", processed_list)
print_processing_results("could not be processed", error_list)
print_processing_results("without minutes", without_minutes)
