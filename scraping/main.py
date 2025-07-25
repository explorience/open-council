import asyncio
from bs4 import BeautifulSoup
from datetime import datetime
from MeetingItem import MeetingItem
from download_meeting import get_minutes

# item_info(datetime(2025, 6, 24))
async def item_info(target_date):
  minutes = await get_minutes(target_date)
  soup = BeautifulSoup(minutes, "html.parser")
  items = MeetingItem(None, soup)
  m = items.format_markdown()
  with open("../content/meeting.md", "w") as f:
    f.write(m)

asyncio.run(item_info(datetime(2025, 6, 24)))
