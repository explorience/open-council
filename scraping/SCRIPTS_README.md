# Meeting Scraper Scripts

This directory contains scripts for downloading and processing London City Council meeting minutes.

## Scripts Overview

### `main.py` - Stay Up-to-Date (Default)
**Purpose:** Keep your local copy current by downloading new meetings from the past 6 months.

**When to use:** Run this regularly (daily/weekly) to stay current with new meetings.

**Usage:**
```bash
# Download new meetings from the past 6 months
uv run main.py

# Process a specific meeting
uv run main.py "Council" "2025-01-15"

# Test parsing for a specific year
uv run main.py TEST_ALL_MEETINGS 2024
```

**What it does:**
- Checks meetings from the past 6 months
- Only downloads meetings you don't already have
- Perfect for keeping your database current

---

### `backfill.py` - Download Historical Data
**Purpose:** Download all historical meeting minutes going back many years.

**When to use:** 
- First time setup - get all historical data
- Fill gaps in your collection
- Recover from data loss

**Usage:**
```bash
# Download everything from 2010 to present (default)
uv run backfill.py

# Download everything from 2015 to present
uv run backfill.py 2015

# Download a specific year range (e.g., 2018-2020)
uv run backfill.py 2018 2020
```

**What it does:**
- Scans all specified years for meetings
- Shows progress as it goes
- Skips meetings you already have
- Processes oldest meetings first (for better cross-referencing)
- Provides detailed statistics at the end

**Expected behavior:**
- ✅ Most meetings will download successfully
- ⚠️ 2016 meetings will likely fail with "server errors" (this is an eScribe server issue, not your code)
- 📝 Some meetings may not have published minutes yet

---

## Typical Workflow

### Initial Setup
```bash
# Download all historical data
uv run backfill.py

# This might take a while! Get a coffee ☕
```

### Regular Maintenance
```bash
# Run daily or weekly to get new meetings
uv run main.py
```

### Fill Gaps
```bash
# If you know you're missing a specific year
uv run backfill.py 2023 2023

# Or just run the full backfill again
# (it will skip what you already have)
uv run backfill.py
```

---

## Output

Both scripts create:
- **Markdown files:** `../content/YYYY-MM/YYYY-MM-DD-Meeting-Title.md`
- **JSON files:** `../data/YYYY-MM/YYYY-MM-DD-Meeting-Title.json`

---

## Troubleshooting

### "Server errors" for 2016 meetings
This is expected - the eScribe server returns 500 errors for 2016 meetings. This is a City of London server issue, not a problem with your code.

### Script is slow
That's normal! It's downloading and parsing hundreds of HTML pages. The backfill script shows progress so you can see it's working.

### "Already up to date" message
If `main.py` says this, it means you already have all meetings from the past 6 months. Good job! 🎉

### Want to re-download a meeting
Delete the existing file from `../content/` and run the script again.

---

## Need Help?

- **See parsing issues?** Check `FIX_SUMMARY.md` for details on known issues
- **Want to customize date ranges?** Edit `DEFAULT_START_YEAR` in `backfill.py`
- **Need to test parsing?** Use `main.py TEST_ALL_MEETINGS <year>`
