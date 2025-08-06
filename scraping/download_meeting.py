import json
import requests
import functools
from pathlib import Path
from bs4 import BeautifulSoup
from datetime import datetime

def get_from_web(url: str) -> str:
  response = requests.get(url, verify=False)
  return response.content

BASE_URL = "https://pub-london.escribemeetings.com/"

def is_meeting_name(e):
  if not e.has_attr("class"): return False
  if "MeetingTypeMeetingCount" in e["class"]: return False
  return "MeetingTypeNameText" in e["class"]

@functools.cache
def get_meeting_type(year):
  html = get_from_web(f"{BASE_URL}?MeetingViewId=1&Year={year}")
  soup = BeautifulSoup(html, "html.parser")
  name_spans = soup.find_all(is_meeting_name)
  return [span.contents[0].strip() for span in name_spans]

@functools.cache
def get_meeting_types():
  year = datetime.now().year
  this_year = get_meeting_type(year)
  last_year = get_meeting_type(year-1)
  return list(set(this_year + last_year))

@functools.cache
def get_meetings(meeting_type, year):
  url = f"{BASE_URL}MeetingsCalendarView.aspx/PastMeetings?MeetingViewId=1&Year={year}"
  data = {
    "type": meeting_type
  }
  print(f"Fetching {year} {meeting_type} meetings...")
  x = requests.post(url, json=data, verify=False)
  print(f"Data for {year} {meeting_type} meetings retrieved")
  data = json.loads(x.text)
  return data["d"]

def meeting_name(m):
  if m["HasLinks"]:
    return m["MeetingLinks"][0]["MeetingName"]
  return f"{m['MeetingType']} {m['FormattedStart']}"

def meeting_date(m):
  return datetime.strptime(m["MeetingDate"], "%B %d, %Y")

def meeting_minutes(m):
  minutes = [link for link in m["AllCategorizedMeetingLinks"] if link["Name"] == "Minutes"]
  if len(minutes) == 0: return None
  minutes_package = minutes[0]["Package"]
  return BASE_URL + [p["Url"] for p in minutes_package if p["Format"] == "HTML"][0]

# get_minutes(datetime(2025, 6, 24), meeting_type)
def get_minutes(target_date, meeting_type):
  meetings = get_meetings(meeting_type, target_date.year)
  right_dates = [m for m in meetings if meeting_date(m) == target_date]
  if len(right_dates) == 0:
    print("Meeting not found")
    return None

  print(f"Found meeting possibilities: {', '.join([meeting_name(m) for m in right_dates])}")

  minutes_urls = [meeting_minutes(m) for m in right_dates if meeting_minutes(m)]
  if minutes_urls == []:
    print("Minutes not found")
    return None

  minutes_url = minutes_urls[0]
  print(f"Found minutes: {minutes_url}")

  print(f"Downloading minutes...")
  minutes = get_from_web(minutes_url)
  print(f"Downloaded minutes")

  return {
    "minutes": minutes,
    "url":     minutes_url
  }

# do we already have a copy of this meeting?
def meeting_local_copy(meeting_type, target_date):
  yyyy_mm = target_date.strftime("%Y-%m")
  folder = Path(f"../data/{yyyy_mm}/")
  if not folder.exists(): return None

  yyyy_mm_dd = target_date.strftime("%Y-%m-%d")
  for path in folder.iterdir():
    if not yyyy_mm_dd in path.name: continue
    data = json.loads(path.read_text())
    if not "meeting_type" in data: continue
    if data["meeting_type"] == meeting_type:
      return f"{yyyy_mm}/{path.stem}"
  return None
