import json
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

# item_info(datetime(2025, 6, 24), meeting_type)
def item_info(target_date, meeting_type):
  download_data = get_minutes(target_date, meeting_type)
  if not download_data: return False

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

  return True

item_info(datetime(2025, 4, 1), "Council")
