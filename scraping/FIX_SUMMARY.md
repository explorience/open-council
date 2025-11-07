# 2016 Meeting Parsing Issue - Summary

## Problem
150 meetings from 2016 could not be processed, causing an `AttributeError: 'NoneType' object has no attribute 'contents'` error in `Meeting.py` line 13.

## Root Cause
The eScribe server is returning **500 Internal Server Error** pages for all 2016 meeting URLs instead of the actual meeting minutes. When the scraper tried to parse these error pages as meeting minutes, it failed because:

1. The API successfully returns meeting data with valid URLs
2. But when the scraper fetches those URLs, the server returns an error page
3. The error page doesn't contain the expected HTML structure (no `class="AgendaMeetingNumberText"`)
4. `probable_title` becomes `None`
5. Accessing `.contents` on `None` causes the `AttributeError`

## What Was Fixed

### 1. Meeting.py
- Added server error page detection before parsing
- Added null-checking for `probable_title` to handle missing elements gracefully
- Now raises a clear `ValueError` when a server error page is detected

### 2. process_meeting.py  
- Added separate tracking for server errors vs parsing errors
- Improved error messages to distinguish between error types
- Created `meetings_server_errors` list to track server-side failures

### 3. main.py
- Updated to display server errors separately from parsing errors
- Better reporting distinguishes between:
  - Successfully processed meetings
  - Parsing errors (code issues)
  - Server errors (eScribe server issues) 
  - Meetings without minutes

## Expected Outcome
When you run the scraper again on 2016 meetings:
- Instead of crashing with an `AttributeError`, it will detect the server error pages
- The 150 failed meetings will be reported as "could not be processed (server errors)"
- You'll get clear output showing these are server-side issues, not parsing issues
- Other meetings will continue to process normally

## Next Steps
The 2016 meetings cannot be scraped until the eScribe server is fixed. Options:
1. **Contact the City of London** to report that 2016 meeting minutes URLs are returning 500 errors
2. **Skip 2016 for now** - The scraper will now handle these gracefully
3. **Check periodically** to see if the server issue gets resolved

## Testing
To test the fix, run:
```bash
cd /Users/heenal/Documents/GitHub/open-council/scraping
uv run main.py TEST_ALL_MEETINGS 2016
```

The output should now clearly indicate which meetings had server errors instead of showing confusing AttributeError messages.
