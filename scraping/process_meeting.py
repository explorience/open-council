# process_meeting finds, downloads, and formats a meeting

import json
import traceback
from pathlib import Path
from Meeting import Meeting
from WordMeeting import WordMeeting
from bs4 import BeautifulSoup
from datetime import datetime
from download_meeting import get_minutes

def format_json(x):
  if hasattr(x, "__dict__"):
    # it's a custom class, add it and its name
    return { **x.__dict__, "__class__": x.__class__.__name__ }
  return str(x)

def is_word_format(soup):
  """Detect if this is a Word HTML export (2011-2017) vs eScribe format (2018+)."""
  # Word format has MsoNormal classes and WordSection divs
  has_mso = soup.find(class_='MsoNormal') is not None
  has_word_section = soup.find('div', class_=lambda x: x and 'WordSection' in str(x)) is not None

  # eScribe format has these specific classes
  has_escribe = soup.find(class_='AgendaItems') is not None

  # If it has MsoNormal or WordSection and doesn't have eScribe classes, it's Word format
  return (has_mso or has_word_section) and not has_escribe

meetings_processed = []
meetings_processed_errors = []

# process_meeting("Council", datetime(2025, 6, 24))
# returns None (meeting not found) or a path
def process_meeting(meeting_type, target_date):
  global meetings_processed, meetings_processed_errors

  try:
    download_data = get_minutes(target_date, meeting_type)
    if not download_data: return None

    minutes = download_data["minutes"]
    url = download_data["url"]
    soup = BeautifulSoup(minutes, "html.parser")

    # Detect format and use appropriate parser
    if is_word_format(soup):
      print(f"  → Detected Word format (2011-2017)")
      meeting = WordMeeting(soup, url, meeting_type, fallback_date=target_date)
    else:
      meeting = Meeting(soup, url, meeting_type, fallback_date=target_date)
    markdown = meeting.format_markdown()

    output = Path(f"../content/{meeting.yyyy_mm()}/{meeting.format_title().replace('/', '-')}.md")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(markdown)

    output_json = Path(f"../data/{meeting.yyyy_mm()}/{meeting.format_title().replace('/', '-')}.json")
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(meeting, default=format_json))

    meetings_processed.append({ "date": target_date, "meeting_type": meeting_type })
    return f"{meeting.yyyy_mm()}/{meeting.format_title()}"
  except Exception as e:
    print(f"Error processing meeting {meeting_type} ({target_date})", e)
    traceback.print_exc()
    meetings_processed_errors.append({ "date": target_date, "meeting_type": meeting_type })
    return None

def get_processing_stats():
  return (meetings_processed, meetings_processed_errors)
