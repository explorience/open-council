import json
import asyncio
import requests
from pprint import pprint
from datetime import datetime
from bs4 import BeautifulSoup, element

async def get_from_web(url: str) -> str:
  """Get a single file from its URL using curl"""
  process = await asyncio.create_subprocess_exec(
    "curl", url,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE
  )

  stdout, stderr = await process.communicate()
  return stdout

BASE_URL = "https://pub-london.escribemeetings.com/"

def get_meetings(meeting_type):
  url = BASE_URL + "MeetingsCalendarView.aspx/PastMeetings?MeetingViewId=1&Year=2025"
  data = {
    "type": meeting_type
  }
  print(f"Fetching {meeting_type} meetings...")
  x = requests.post(url, json=data)
  print(f"Data for {meeting_type} meetings retrieved")
  data = json.loads(x.text)
  return data["d"]

def meeting_name(m):
  if m["HasLinks"]:
    return m["MeetingLinks"][0]["MeetingName"]
  return f"{m['MeetingType']} {m['FormattedStart']}"

def meeting_date(m):
  return datetime.strptime(m["MeetingDate"], "%B %d, %Y")

def meeting_minutes(m):
  minutes_package = [link for link in m["AllCategorizedMeetingLinks"] if link["Name"] == "Minutes"][0]["Package"]
  return BASE_URL + [p["Url"] for p in minutes_package if p["Format"] == "HTML"][0]

TEXT_CLASS_NAMES = ["MotionVoters" , "MotionResult", "MovedBy", "SecondedBy"]

def is_text(n):
  if n.name == "p": return True
  if not n.has_attr("class"): return False
  for class_name in TEXT_CLASS_NAMES:
    if class_name in n["class"]: return True
  return False

def process_text_node(t):
  output = ""
  for e in t.contents:
    if type(e) is element.NavigableString:
      output += str(e)
    elif e.name in ["em", "span"]:
      output += str(e.contents[0])
    elif e.name == "br":
      output += "\n\n"

  return output

def process_movement_node(t):
  """
    <div class="MovedBy">
     <span class="Label">
      Motion made by:
     </span>
     <span class="Value">
      P. Cuddy
     </span>
    </div>
  """
  return f"{t.contents[0].contents[0]} {t.contents[1].contents[0]}"

def get_motion_result(e):
  if len(e.contents) == 1:
    if len(e.contents[0]) == 0:
      # <div class="MotionResult"><br/></div>
      return ""
    # <div class="MotionResult"><br>Motion Passed (15 to 0)</br></div>
    return str(e.contents[0].contents[0])

  # <div class="MotionResult"><br/>Motion Passed (15 to 0)</div>
  return str(e.contents[1])

def process_motion_result(e):
  return f"**{get_motion_result(e)}**"

class Content:
  def __init__(self, content_row=None):
    if not content_row:
      self.elts = []
      return

    self.elts = []
    relevant_elements = content_row.find_all(is_text)
    for e in relevant_elements:
      if e.has_attr("class") and "MotionVoters" in e["class"]:
        vote = VoteContent(e)
        if not vote.empty():
          self.elts.append(vote)
      elif e.name == "p" or any([class_name in e["class"] for class_name in TEXT_CLASS_NAMES]):
        self.elts.append(TextContent(e))

  def format_markdown(self):
    return "\n\n".join([e.format_markdown() for e in self.elts])

  def __str__(self):
    return "".join(map(str, self.elts))

class TextContent(Content):
  def __init__(self, e):
    if e.name == "p":
      self.string = process_text_node(e)
    elif "MotionResult" in e["class"]:
      self.string = process_motion_result(e)
    elif "MovedBy" in e["class"] or "SecondedBy" in e["class"]:
      self.string = process_movement_node(e)

    # make lists markdown-friendly
    self.string = self.string.replace("•", "-")
    self.string = self.string.replace("·", "-")

  def format_markdown(self):
    return self.string

  def __str__(self):
    return self.string

class VoteContent(Content):
  def __init__(self, motion_voters):
    self.rows = []
    for row in motion_voters.contents:
      if len(row.contents) == 2:

        # "Yeas:  (15)" -> "Yeas:"
        vote = row.contents[0].contents[0].split(" ")[0]

        voters = row.contents[1].contents[0].replace(" and ", "").split(", ")
        self.rows.append({
          "vote": vote,
          "voters": voters
        })

  def format_markdown(self):
    table_header = f"|{'|'.join([col['vote'] for col in self.rows])}|"
    header_divider = "|-" * len(self.rows) + "|"

    max_len = max([len(row["voters"]) for row in self.rows])
    table_body = ""
    for i in range(max_len):
      current_row = "|"
      for row in self.rows:
        voters = row["voters"]
        item = voters[i] if i < len(voters) else " "
        current_row += f"{item}|"
      table_body += current_row + "\n"

    return f"{table_header}\n{header_divider}\n{table_body}".strip()

  def empty(self):
    return len(self.rows) == 0

  def __str__(self):
    return str(self.rows)

def get_agenda_info(agenda_item):
  title = str(agenda_item.find(class_="AgendaItemTitle").contents[0].contents[0])
  content_row = agenda_item.find(class_="AgendaItemContentRow")

  number_str = agenda_item.find(class_="AgendaItemCounter").contents[0]
  if number_str[-1] == ".": number_str = number_str[:-1]
  number = int(number_str.split(".")[-1])

  return {
    "title": title,
    "number": number,
    "content": Content(content_row),
    "children": {}
  }

def treeify(agenda_item_container, subheadings=None):
  node = {
    "title": None,
    "number": 0,
    "content": Content(),
    "children": {},
  }

  if not subheadings:
    agenda_item = agenda_item_container.contents[0]
    node = get_agenda_info(agenda_item)

  for child in subheadings or agenda_item_container.contents[1]:
    tree = treeify(child)
    node["children"][tree["number"]] = tree

  return node

# level = 1, 2, 3, etc for headings
def markdown(item, level=0, number_prefix=""):

  output = ""

  # 0 is empty node
  if level != 0:

    # "" -> "1." -> "1.1" -> "1.1.1" etc
    empty_prefix = not number_prefix
    if number_prefix and number_prefix[-1] != ".": number_prefix += "."
    number_prefix += str(item["number"])
    if empty_prefix: number_prefix += "."

    # use non-breaking space because markdown collapses other whitespace into a single space
    output += f"{'#'*level} {number_prefix}&nbsp;&nbsp;&nbsp;{item['title']}\n\n"
    contents = item["content"].format_markdown()
    if contents: output += contents + "\n\n"

  for a in item["children"].values():
    output += markdown(a, level+1, number_prefix)

  return output

def get_tree(soup):
  agenda_items = soup.find(class_="AgendaItems")
  tree = treeify(None, agenda_items)
  return tree

# item_info(datetime(2025, 6, 24), "8.4.5")
async def item_info(target_date, item_number):
  meetings = get_meetings("Council")
  right_dates = [m for m in meetings if meeting_date(m) == target_date]
  if len(right_dates) == 0:
    print("Meeting not found")
    return

  m = right_dates[0]
  print(f"Found meeting: {meeting_name(m)}")

  minutes = meeting_minutes(m)
  print(f"Found minutes: {minutes}")

  print(f"Downloading minutes...")
  page = await get_from_web(minutes)
  print(f"Downloaded minutes")

  soup = BeautifulSoup(page, "html.parser")
  agenda = get_tree(soup)
  m = markdown(agenda)
  print(m)
  with open("content/meeting.md", "w") as f:
    f.write(m)

asyncio.run(item_info(datetime(2025, 6, 24), "8.4.2"))
