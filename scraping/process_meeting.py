# process_meeting finds, downloads, and formats a meeting

import json
import traceback
from pathlib import Path
from Meeting import Meeting
from bs4 import BeautifulSoup
from datetime import datetime
from download_meeting import get_minutes

def format_json(x):
  if hasattr(x, "__dict__"):
    # it's a custom class, add it and its name
    return { **x.__dict__, "__class__": x.__class__.__name__ }
  return str(x)

meetings_processed = 0
meetings_processed_errors = []

# process_meeting(datetime(2025, 6, 24), meeting_type)
# returns None (meeting not found) or a path
def process_meeting(target_date, meeting_type):
  global meetings_processed, meetings_processed_errors

  try:
    download_data = get_minutes(target_date, meeting_type)
    if not download_data: return None

    minutes = download_data["minutes"]
    url = download_data["url"]
    soup = BeautifulSoup(minutes, "html.parser")
    meeting = Meeting(soup, url)
    markdown = meeting.format_markdown()

    output = Path(f"../content/{meeting.yyyy_mm()}/{meeting.format_title()}.md")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(markdown)

    output_json = Path(f"../data/{meeting.yyyy_mm()}/{meeting.format_title()}.json")
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(meeting, default=format_json))

    meetings_processed += 1
    return f"{meeting.yyyy_mm()}/{meeting.format_title()}"
  except Exception as e:
    print(f"Error processing meeting {meeting_type} ({target_date})", e)
    traceback.print_exc()
    meetings_processed_errors.append({ "date": target_date, "meeting_type": meeting_type })
    return None

def get_processing_stats():
  return (meetings_processed, meetings_processed_errors)
