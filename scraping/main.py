import asyncio
from pathlib import Path
from Meeting import Meeting
from bs4 import BeautifulSoup
from datetime import datetime
from download_meeting import get_minutes

# item_info(datetime(2025, 6, 24))
async def item_info(target_date):
  download_data = await get_minutes(target_date)
  minutes = download_data["minutes"]
  url = download_data["url"]
  soup = BeautifulSoup(minutes, "html.parser")
  meeting = Meeting(soup, url)
  markdown = meeting.format_markdown()

  output = Path(f"../content/{meeting.yyyy_mm()}/{meeting.format_title()}.md")
  output.parent.mkdir(parents=True, exist_ok=True)
  output.write_text(markdown)

asyncio.run(item_info(datetime(2025, 6, 24)))
