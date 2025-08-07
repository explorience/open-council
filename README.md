# Open Council

Open Council scrapes London council meetings, nicely formats them, and parses the data into an easy-to-work-with JSON format.

## Folders

- `scraping/`: Python scraping scripts
- `data/`: outputted JSON data
- `content/`: formatted markdown

## Scripts

To serve the site, run `npm run dev` in this directory.

To scrape, run `uv run main.py` in the `scraping/` directory. This will find all new meetings in the past 6 months, and process them. It determines which meetings have already been scraped from the `data/` folder.

You can also run something like
```
uv run main.py 'Community and Protective Services Committee' '2025-05-20'
```
to scrape a specific meeting from its meeting type and date. The name of the meeting comes from the [eScribe's meeting types](https://pub-london.escribemeetings.com/?MeetingViewId=1) (the name of the collapsible)