import json
import requests
import functools
import time
from pathlib import Path
from bs4 import BeautifulSoup
from datetime import datetime

# Browser-like headers to avoid bot detection
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0'
}

def get_from_web(url: str, max_retries=3) -> str:
  """Fetch URL with retry logic and realistic browser headers"""
  for attempt in range(max_retries):
    try:
      # Add a small delay to be respectful to the server
      if attempt > 0:
        wait_time = 2 ** attempt  # Exponential backoff: 2, 4, 8 seconds
        print(f"  Retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})...")
        time.sleep(wait_time)

      response = requests.get(url, verify=False, headers=HEADERS, timeout=30)

      # Check for access denied
      if response.status_code == 403:
        print(f"  ⚠️  Access denied (403) - attempt {attempt + 1}/{max_retries}")
        if attempt < max_retries - 1:
          continue
        else:
          raise Exception(f"Access denied after {max_retries} attempts")

      response.raise_for_status()
      return response.content

    except requests.exceptions.Timeout:
      print(f"  ⚠️  Timeout - attempt {attempt + 1}/{max_retries}")
      if attempt == max_retries - 1:
        raise
    except requests.exceptions.RequestException as e:
      print(f"  ⚠️  Request error: {e} - attempt {attempt + 1}/{max_retries}")
      if attempt == max_retries - 1:
        raise

  raise Exception(f"Failed to fetch {url} after {max_retries} attempts")

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
def get_meeting_types(year=datetime.now().year):
  this_year = get_meeting_type(year)
  last_year = get_meeting_type(year-1)
  return list(set(this_year + last_year))

@functools.cache
def get_meetings(meeting_type, year):
  url = f"{BASE_URL}MeetingsCalendarView.aspx/PastMeetings?MeetingViewId=1&Year={year}&Expanded={meeting_type}"
  data = {
    "type": meeting_type
  }
  print(f"Fetching {year} {meeting_type} meetings...")

  # Use POST request with proper headers
  post_headers = HEADERS.copy()
  post_headers['Content-Type'] = 'application/json'

  max_retries = 3
  for attempt in range(max_retries):
    try:
      if attempt > 0:
        wait_time = 2 ** attempt
        print(f"  Retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})...")
        time.sleep(wait_time)

      x = requests.post(url, json=data, verify=False, headers=post_headers, timeout=30)

      if x.status_code == 403:
        print(f"  ⚠️  Access denied (403) - attempt {attempt + 1}/{max_retries}")
        if attempt < max_retries - 1:
          continue
        else:
          raise Exception(f"Access denied after {max_retries} attempts")

      x.raise_for_status()
      print(f"Data for {year} {meeting_type} meetings retrieved")
      data = json.loads(x.text)
      return data["d"]

    except Exception as e:
      if attempt == max_retries - 1:
        print(f"  ❌ Failed to fetch meetings: {e}")
        raise

  return []

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
  htmlLink = [p["Url"] for p in minutes_package if p["Format"] == "HTML"]
  if len(htmlLink) == 0: return None # no HTML minutes available (probably only PDF minutes)

  return BASE_URL + htmlLink[0]

# get_minutes(datetime(2025, 6, 24), meeting_type)
def get_minutes(target_date, meeting_type):
  meetings = get_meetings(meeting_type, target_date.year)
  right_dates = [m for m in meetings if meeting_date(m) == target_date]
  if len(right_dates) == 0:
    print(f"Meeting {meeting_type} ({target_date.strftime('%Y-%m-%d')}) not found")
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
