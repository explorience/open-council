import re
import process_meeting # don't use from to resolve circular dependency
from pathlib import Path
from datetime import datetime
from download_meeting import get_meeting_types, get_minutes, council_meeting_local_copy

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

class Attachment:
  def __init__(self, agenda_item_attachment, orig_datetime):
    attrs = agenda_item_attachment.find("a").attrs
    self.url = f"https://pub-london.escribemeetings.com/{attrs['href']}"

    # remove extension (like .pdf)
    self.title = Path(attrs["data-original-title"]).stem

    meeting_type = get_meeting_type(self.title)

    match_str = DATE_PAT.search(self.title)
    self.date = datetime.strptime(match_str.group(0), "%Y-%m-%d") if match_str else None

    self.local_page = None
    d1 = self.date
    d2 = orig_datetime
    # make sure that we don't recursively process the same meeting
    # this can occur if another document from the same day is miscategorized
    if self.date and ((d1.day, d1.month, d1.year) != (d2.day, d2.month, d2.year)) and meeting_type:
      if meeting_type == "Council":
        # only create council meetings if they don't exist
        # otherwise, we would recursively create every single council meeting (since they link back to the previous)
        exists = council_meeting_local_copy(self.date)
        self.local_page = exists or process_meeting.process_meeting(self.date, meeting_type)
      else:
        self.local_page = process_meeting.process_meeting(self.date, meeting_type)

      # the path ends in .md, remove it
      # can't use stem here because there might be a folder that we want to keep
      if self.local_page and self.local_page[-3:] == ".md": self.local_page = self.local_page[:-3]

  def format_markdown(self):
    url = f"/{self.local_page}" if self.local_page else self.url
    # surround url in angle brackets to handle spaces
    return f"[{self.title}](<{url}>)\n\n"
