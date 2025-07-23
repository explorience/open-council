import json
import asyncio
import requests
from pprint import pprint
from datetime import datetime
from bs4 import BeautifulSoup

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

def get_agenda_info(agenda_item):
  title = str(agenda_item.find(class_="AgendaItemTitle").contents[0].contents[0])
  contents = agenda_item.contents[1] if len(agenda_item.contents) > 1 else None

  number_str = agenda_item.find(class_="AgendaItemCounter").contents[0]
  if number_str[-1] == ".": number_str = number_str[:-1]
  number = int(number_str.split(".")[-1])

  return {
    "title": title,
    "number": number
    #"contents": contents
  }

def treeify(agenda_item_container):
  agenda_item = agenda_item_container.contents[0]
  node = {
    "item": get_agenda_info(agenda_item),
    "children": {}
  }
  for child in agenda_item_container.contents[1]:
    tree = treeify(child)
    node["children"][tree["item"]["number"]] = tree

  return node

def print_order(items, level):
  for k, a in items.items():
    print(f"{' '*(level*4)}{k}: {a['item']['title']}")
    print_order(a["children"], level+1)

def get_agenda(soup):
  agenda_items = soup.find(class_="AgendaItems")
  tree = {}
  tree = {i+1: treeify(a) for i, a in enumerate(agenda_items)}
  print_order(tree, 0)

  return agenda_items

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
  agenda = get_agenda(soup)

asyncio.run(item_info(datetime(2025, 6, 24), "8.4.2"))
