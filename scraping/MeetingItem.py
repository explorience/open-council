import re
import json
from pathlib import Path
from content import Content
from bs4 import NavigableString
from Attachment import Attachment

# find the link to the section in the report with this path
def get_section_link(report, section):
  path = Path(f"../data/{report}.json")
  if not path.exists(): return None

  text = path.read_text()
  data = json.loads(text)
  for num in section.split("."):
    if not "items" in data: return None
    if not num in data["items"]: return None
    data = data["items"][num]
  base_header = (section + data["title"]).strip()
  header_link = "".join([c for c in base_header.lower().replace(" ", "-") if c.isalnum() or c == "-"])
  return f"/{report}#{header_link}"

class MeetingItem:
  def __init__(self, agenda_item_container, datetime, report=None):
    self.title = None
    self.number = ""
    self.content = []
    self.items = {}
    self.datetime = datetime
    self.attachments = []
    self.report = report

    agenda_item = agenda_item_container.contents[0]
    self.set_attributes(agenda_item, report)

    if len(self.attachments) == 1 and self.attachments[0].local_page:
      report = self.attachments[0].local_page

    if len(agenda_item_container.contents) > 1:
      items = agenda_item_container.contents[1]
      for child in items:
        subitem = MeetingItem(child, datetime, report)
        self.items[subitem.number] = subitem


  def set_attributes(self, agenda_item, report):
    title_row = agenda_item.find(class_="AgendaItemTitleRow")
    self.set_title(title_row.find(class_="AgendaItemTitle"))

    attachments = title_row.find(class_="AgendaItemAttachmentsList")
    if attachments:
      agenda_item_attachments = attachments.find_all(class_="AgendaItemAttachment")
      for a in agenda_item_attachments:
        attachment = Attachment(a, self.datetime)
        if not attachment.is_empty():
          self.attachments.append(attachment)

    self.content = Content.parse_contents(agenda_item.find(class_="AgendaItemContentRow"))

    # "1." -> 1, "3.4" -> 4
    number_str = agenda_item.find(class_="AgendaItemCounter").contents[0]
    if number_str[-1] == ".": number_str = number_str[:-1]
    self.number = number_str.split(".")[-1]


  def set_title(self, agenda_item_title):
    if isinstance(agenda_item_title.contents[0], NavigableString):
      """
      <div class="AgendaItemTitle" style="width:auto;display:inline-block;">
       Deferred Matters/Additional Business
      </div>
      """
      self.title = agenda_item_title.contents[0]
      return

    """
    <div class="AgendaItemTitle" style="width:auto;display:inline-block;">
     <a href="javascript:SelectItem(1);" tabindex="0">
      Disclosures of Pecuniary Interest
     </a>
    </div>
    """
    self.title = agenda_item_title.contents[0].contents[0]


  def get_linked_title(self):
    if not self.report: return self.title

    num_match = re.search("\\((\\d+\\.\\d+)\\)", self.title)
    if not num_match: return self.title

    section = num_match.group(1)
    link = get_section_link(self.report, section)
    if not link: return self.title

    before = self.title[:num_match.start(0)]
    after = self.title[num_match.end(0):]
    return f"{before}[{num_match.group(0)}](<{link}>){after}"


  # level is the heading level (1 = #, 2 = ##, etc)
  def format_markdown(self, level, number_prefix):
    output = ""

    # "" -> "1." -> "1.1" -> "1.1.1" etc
    empty_prefix = number_prefix == ""
    if number_prefix and number_prefix[-1] != ".": number_prefix += "."
    number_prefix += self.number
    if empty_prefix: number_prefix += "."

    # use non-breaking space because markdown collapses other whitespace into a single space
    output += f"{'#'*level} {number_prefix}&nbsp;&nbsp;&nbsp;{self.get_linked_title()}\n\n"

    for a in self.attachments:
      output += a.format_markdown()

    contents = self.format_content_markdown()
    if contents: output += contents + "\n\n"

    for subitem in self.items.values():
      output += subitem.format_markdown(level+1, number_prefix)

    return output


  def format_content_markdown(self):
    return "\n\n".join([e.format_markdown() for e in self.content])
