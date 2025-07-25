from content import Content

class MeetingItem:
  # call with soup to create root node,
  # otherwise call with agenda_item_container
  def __init__(self, agenda_item_container, soup=None):
    self.root = True
    self.title = None
    self.number = 0
    self.content = []
    self.subitems = {}

    if not soup:
      self.root = False
      agenda_item = agenda_item_container.contents[0]
      self.set_attributes(agenda_item)
    else:
      # root node
      pass

    content = soup.find(class_="AgendaItems") if soup else agenda_item_container.contents[1]
    for child in content:
      subitem = MeetingItem(child)
      self.subitems[subitem.number] = subitem


  def set_attributes(self, agenda_item):
    self.set_title(agenda_item.find(class_="AgendaItemTitle"))
    self.content = Content.parse_content(agenda_item.find(class_="AgendaItemContentRow"))

    # "1." -> 1, "3.4" -> 4
    number_str = agenda_item.find(class_="AgendaItemCounter").contents[0]
    if number_str[-1] == ".": number_str = number_str[:-1]
    self.number = int(number_str.split(".")[-1])


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
  def format_markdown(self, level=0, number_prefix=""):
    output = ""

    if not self.root:
      # "" -> "1." -> "1.1" -> "1.1.1" etc
      empty_prefix = number_prefix == ""
      if number_prefix and number_prefix[-1] != ".": number_prefix += "."
      number_prefix += str(self.number)
      if empty_prefix: number_prefix += "."

      # use non-breaking space because markdown collapses other whitespace into a single space
      output += f"{'#'*level} {number_prefix}&nbsp;&nbsp;&nbsp;{self.title}\n\n"
      contents = self.format_content_markdown()
      if contents: output += contents + "\n\n"

    for subitem in self.subitems.values():
      output += subitem.format_markdown(level+1, number_prefix)

    return output


  def format_content_markdown(self):
    return "\n\n".join([e.format_markdown() for e in self.content])
