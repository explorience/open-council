import re
import process_meeting # don't use from to resolve circular dependency
from pathlib import Path
from content import Content
from datetime import datetime
from download_meeting import get_meeting_types, get_minutes, meeting_local_copy

def meeting_type_part(s):
  if not s[0].isupper(): return False
  if "minutes" in s.lower(): return False
  if "report" in s.lower(): return False
  return True

non_meeting_keywords = ["Presentation", "Submision", "Staff Report"]
def get_meeting_type(title):
  for word in non_meeting_keywords:
    if word in title: return None

  # parts of the title that could be a meeting type
  meeting_type_parts = [word for word in title.split() if meeting_type_part(word)]
  for meeting_type in get_meeting_types():
    for part in meeting_type_parts:
      if part in meeting_type: return meeting_type

      # check acronym (like PEC for Planning and Environment Committee)
      acronym = "".join(c for c in meeting_type if c.isupper())
      if part == acronym: return meeting_type

  return None


DATE_PAT = re.compile("\\d{4}\\-\\d{2}\\-\\d{2}")

class Attachment(Content):
  def __init__(self, agenda_item_attachment, orig_datetime):
    a = agenda_item_attachment.find("a")
    self.nothing_here = not a
    if not a: return

    attrs = a.attrs
    self.url = f"https://pub-london.escribemeetings.com/{attrs['href']}"

    # remove extension (like .pdf)
    self.title = Path(attrs["data-original-title"]).stem

    meeting_type = get_meeting_type(self.title)

    match_str = DATE_PAT.search(self.title)
    self.date = datetime.strptime(match_str.group(0), "%Y-%m-%d") if match_str else None

    self.local_page = self.date and meeting_local_copy(meeting_type, self.date)

  def is_empty(self):
    return self.nothing_here

  def format_markdown(self):
    url = f"/{self.local_page}" if self.local_page else self.url
    # surround url in angle brackets to handle spaces
    return f"[{self.title}](<{url}>)\n\n"
