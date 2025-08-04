import re
from datetime import datetime
from download_meeting import get_meeting_types, get_minutes

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


date_p = re.compile("\\d{4}\\-\\d{2}\\-\\d{2}")
class Attachment:
  def __init__(self, agenda_item_attachment):
    attrs = agenda_item_attachment.find("a").attrs
    self.document_id = (attrs["href"].split("=")[-1])
    self.title = attrs["data-original-title"]
    self.meeting_type = get_meeting_type(self.title)

    match_str = date_p.search(self.title)
    self.date = datetime.strptime(match_str.group(0), "%Y-%m-%d") if match_str else None

    if self.date and self.meeting_type:
      if not get_minutes(self.date, self.meeting_type):
        # attachment was miscategorized, not from a meeting
        self.meeting_type = None
    # print(self.title, " -- ", self.meeting_type, self.date)

  def format_markdown(self):
    return f"[{self.title}](https://pub-london.escribemeetings.com/filestream.ashx?DocumentId={self.document_id})\n\n"
