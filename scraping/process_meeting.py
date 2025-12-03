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


def merge_official_minutes(existing_path: Path, meeting, url: str) -> bool:
  """
  Merge official minutes data into an existing transcript-only meeting file.

  Preserves transcript data while adding official minutes content.

  Args:
    existing_path: Path to existing JSON file
    meeting: Parsed Meeting object with official minutes data
    url: URL of the official minutes

  Returns:
    True if merge was successful
  """
  try:
    with open(existing_path, 'r') as f:
      existing_data = json.load(f)

    # Check if this is a transcript-only file that needs merging
    if existing_data.get('data_sources', {}).get('official_minutes', True):
      # Already has official minutes, skip
      print(f"  → Already has official minutes, skipping merge")
      return False

    # Preserve transcript data
    transcript = existing_data.get('transcript', [])
    transcript_source = existing_data.get('transcript_source')
    transcript_source_url = existing_data.get('transcript_source_url')
    transcript_duration = existing_data.get('transcript_duration')

    # Convert meeting to JSON format
    meeting_json = json.loads(json.dumps(meeting, default=format_json))

    # Merge: use official minutes data but keep transcript
    merged_data = {
      **meeting_json,
      "url": url,
      "data_sources": {
        "official_minutes": True,
        "transcript": bool(transcript)
      },
      "transcript": transcript,
      "transcript_source": transcript_source,
      "transcript_source_url": transcript_source_url,
      "transcript_duration": transcript_duration,
    }

    # Save merged file
    with open(existing_path, 'w') as f:
      json.dump(merged_data, f, default=format_json)

    print(f"  ✓ Merged official minutes into existing transcript-only file")
    return True

  except Exception as e:
    print(f"  Error merging: {e}")
    return False

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

    # Check if a transcript-only file already exists
    if output_json.exists():
      # Try to merge official minutes into existing file
      merged = merge_official_minutes(output_json, meeting, url)
      if not merged:
        # Either already has minutes or error - write fresh anyway
        output_json.write_text(json.dumps(meeting, default=format_json))
    else:
      # No existing file, write new one
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
