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

    output = Path(f"../content/months/{meeting.yyyy_mm()}/{meeting.format_title().replace('/', '-')}.md")
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


def create_placeholder_meeting(meeting_type, target_date):
  """
  Create a placeholder meeting file when minutes aren't available yet.
  This allows the transcript sync to still find the meeting and search for coverage.
  """
  from download_meeting import get_meetings, meeting_date, meeting_minutes

  yyyy_mm = target_date.strftime("%Y-%m")
  date_str = target_date.strftime("%Y-%m-%d")
  title = f"{date_str} - {meeting_type}"

  # Try to get meeting info from eScribe
  try:
    meetings = get_meetings(meeting_type, target_date.year)
    meeting_data = None
    for m in meetings:
      if meeting_date(m) == target_date:
        meeting_data = m
        break

    if meeting_data:
      # Build minimal meeting info from eScribe data
      # Must match format expected by server/embeddings.ts
      meeting_info = {
        "meeting_type": meeting_type,
        "datetime": date_str,
        "title": title,
        "url": meeting_data.get("MeetingUrl", ""),
        "present": [],
        "absent": [],
        "also_present": [],
        "remote_attendance": [],
        "items": [],
        "bills": [],
        "content": "",
        "__class__": "Placeholder",
        "placeholder": True,
        "note": "Minutes not yet published - placeholder created for transcript sync"
      }

      output_json = Path(f"../data/{yyyy_mm}/{title.replace('/', '-')}.json")
      output_json.parent.mkdir(parents=True, exist_ok=True)
      output_json.write_text(json.dumps(meeting_info, indent=2))

      # Generate a basic markdown page
      create_basic_markdown(meeting_info, output_json)

      print(f"  → Created placeholder: {title}")
      return f"{yyyy_mm}/{title}"
  except Exception as e:
    print(f"  → Error creating placeholder for {meeting_type} {date_str}: {e}")

  return None


def create_basic_markdown(meeting_data, json_path):
  """
  Create a basic markdown page for a meeting without official minutes.
  Used for placeholder meetings and transcript-only meetings so they
  appear on the static site.
  """
  json_path = Path(json_path)
  date_str = meeting_data.get('datetime', '').split()[0]  # "YYYY-MM-DD"
  meeting_type = meeting_data.get('meeting_type', '')
  title = meeting_data.get('title', f"{date_str} - {meeting_type}")

  # Parse date for display
  try:
    dt = datetime.strptime(date_str, '%Y-%m-%d')
    date_display = dt.strftime('%B %-d, %Y')
  except ValueError:
    date_display = date_str

  # Use the meeting title if it's descriptive, otherwise build one
  if title == f"{date_str} - {meeting_type}" or title == f"{meeting_type} Meeting":
    page_title = meeting_type
  else:
    page_title = title

  md = f"---\ntitle: \"{page_title}\"\ndate: {date_str}\n---\n"
  md += f"{date_display}\n\n"

  # Link to original if available
  url = meeting_data.get('url')
  if url:
    md += f"[Original link]({url})\n\n"

  # Note about minutes status
  has_transcript = bool(meeting_data.get('transcript'))
  has_news = bool(meeting_data.get('news_coverage'))

  if not meeting_data.get('items') and not has_transcript:
    md += "> [!info] Official minutes have not been published yet for this meeting.\n\n"
  elif not meeting_data.get('items'):
    md += "> [!info] Official minutes have not been published yet. A meeting transcript is available below.\n\n"

  # Transcript section
  if has_transcript:
    transcript = meeting_data['transcript']
    duration = meeting_data.get('transcript_duration', '')
    source_url = meeting_data.get('transcript_source_url', '')

    md += "## Meeting Transcript\n\n"
    if duration:
      md += f"Duration: {duration}\n\n"
    if source_url:
      md += f"Source: [Lillian Skinner's London Council Archive]({source_url})\n\n"
    md += f"> [!example]- Full Transcript\n"
    for line in transcript.split('\n'):
      md += f"> {line}\n"
    md += "\n"

  # News coverage section
  if has_news:
    md += "## News Coverage\n\n"
    for article in meeting_data['news_coverage']:
      article_title = article.get('title', 'Article')
      article_url = article.get('url', '')
      summary = article.get('summary', '')
      if article_url:
        md += f"- [{article_title}]({article_url})"
      else:
        md += f"- {article_title}"
      if summary:
        md += f" — {summary}"
      md += "\n"
    md += "\n"

  # Write markdown file
  # Resolve the project root: json_path is under data/YYYY-MM/, so go up to project root
  yyyy_mm = date_str[:7]
  project_root = Path(__file__).parent.parent
  content_dir = project_root / 'content' / 'months' / yyyy_mm
  content_dir.mkdir(parents=True, exist_ok=True)

  # Use the JSON filename stem for the markdown filename
  md_path = content_dir / f"{json_path.stem}.md"
  md_path.write_text(md)
  print(f"  → Created markdown page: {md_path.relative_to(project_root)}")
