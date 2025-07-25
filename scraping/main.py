import asyncio
from bs4 import BeautifulSoup
from datetime import datetime
from Meeting import Meeting
from download_meeting import get_minutes

# item_info(datetime(2025, 6, 24))
async def item_info(target_date):
  minutes = await get_minutes(target_date)
  soup = BeautifulSoup(minutes, "html.parser")
  meeting = Meeting(soup)
  markdown = meeting.format_markdown()
  with open("../content/meeting.md", "w") as f:
    f.write(markdown)

asyncio.run(item_info(datetime(2025, 6, 24)))
