import json
import asyncio
import requests
from datetime import datetime

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

# item_info(datetime(2025, 6, 24))
async def get_minutes(target_date):
  meetings = get_meetings("Council")
  right_dates = [m for m in meetings if meeting_date(m) == target_date]
  if len(right_dates) == 0:
    print("Meeting not found")
    return

  m = right_dates[0]
  print(f"Found meeting: {meeting_name(m)}")

  minutes_url = meeting_minutes(m)
  print(f"Found minutes: {minutes_url}")

  print(f"Downloading minutes...")
  minutes = await get_from_web(minutes_url)
  print(f"Downloaded minutes")

  return minutes
