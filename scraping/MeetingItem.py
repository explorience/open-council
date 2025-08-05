from content import Content
from Attachment import Attachment

class MeetingItem:
  def __init__(self, agenda_item_container, datetime):
    self.title = None
    self.number = ""
    self.content = []
    self.subitems = {}
    self.datetime = datetime

    agenda_item = agenda_item_container.contents[0]
    self.set_attributes(agenda_item)

    if len(agenda_item_container.contents) > 1:
      subitems = agenda_item_container.contents[1]
      for child in subitems:
        subitem = MeetingItem(child, datetime)
        self.subitems[subitem.number] = subitem


  def set_attributes(self, agenda_item):
    title_row = agenda_item.find(class_="AgendaItemTitleRow")
    self.set_title(title_row.find(class_="AgendaItemTitle"))

    self.attachments = []
    attachments = title_row.find(class_="AgendaItemAttachmentsList")
    if attachments:
      agenda_item_attachments = attachments.find_all(class_="AgendaItemAttachment")
      for a in agenda_item_attachments:
        self.attachments.append(Attachment(a, self.datetime))

    self.content = Content.parse_contents(agenda_item.find(class_="AgendaItemContentRow"))

    # "1." -> 1, "3.4" -> 4
    number_str = agenda_item.find(class_="AgendaItemCounter").contents[0]
    if number_str[-1] == ".": number_str = number_str[:-1]
    self.number = number_str.split(".")[-1]


  def set_title(self, agenda_item_title):
    """
    <div class="AgendaItemTitle" style="width:auto;display:inline-block;">
     <a href="javascript:SelectItem(1);" tabindex="0">
      Disclosures of Pecuniary Interest
     </a>
    </div>
    """
    self.title = agenda_item_title.contents[0].contents[0]


  # level is the heading level (1 = #, 2 = ##, etc)
  def format_markdown(self, level, number_prefix):
    output = ""

    # "" -> "1." -> "1.1" -> "1.1.1" etc
    empty_prefix = number_prefix == ""
    if number_prefix and number_prefix[-1] != ".": number_prefix += "."
    number_prefix += self.number
    if empty_prefix: number_prefix += "."

    # use non-breaking space because markdown collapses other whitespace into a single space
    output += f"{'#'*level} {number_prefix}&nbsp;&nbsp;&nbsp;{self.title}\n\n"

    for a in self.attachments:
      output += a.format_markdown()

    contents = self.format_content_markdown()
    if contents: output += contents + "\n\n"

    for subitem in self.subitems.values():
      output += subitem.format_markdown(level+1, number_prefix)

    return output


  def format_content_markdown(self):
    return "\n\n".join([e.format_markdown() for e in self.content])
