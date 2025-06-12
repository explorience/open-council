# eSCRIBE Scraping Guide for London

## Overview

This guide provides specific instructions for scraping London's eSCRIBE portal at pub-london.escribemeetings.com.

## Key URLs and Patterns

### Base URL
```
https://pub-london.escribemeetings.com/
```

### Meeting URLs
```
# Meeting list (homepage)
https://pub-london.escribemeetings.com/

# Individual meeting
https://pub-london.escribemeetings.com/Meeting.aspx?Id={GUID}&Agenda=Agenda&lang=English

# Post-meeting minutes
https://pub-london.escribemeetings.com/Meeting.aspx?Id={GUID}&Agenda=PostMinutes&lang=English
```

### Document URLs
```
# Vote results PDFs
https://pub-london.escribemeetings.com/documents/VoteResults_Council_Meeting_{YYYY-MM-DD}.pdf

# Agenda PDFs
https://pub-london.escribemeetings.com/FileStream.ashx?DocumentId={ID}
```

## HTML Structure & Selectors

### Meeting List Page

```python
# Meeting rows
meetings = soup.select('table#ctl00_ContentPlaceHolder1_gvMeetings tr')[1:]  # Skip header

# For each meeting row
for row in meetings:
    cells = row.select('td')
    meeting_type = cells[0].text.strip()  # "Council", "Committee", etc.
    meeting_date = cells[1].text.strip()
    
    # Get meeting link
    link = cells[2].select_one('a[href*="Meeting.aspx"]')
    if link:
        meeting_url = "https://pub-london.escribemeetings.com/" + link['href']
```

### Meeting Detail Page

```python
# Meeting metadata
meeting_info = {}
for row in soup.select('table.meetingInfo tr'):
    label = row.select_one('td:nth-of-type(1)')
    value = row.select_one('td:nth-of-type(2)')
    if label and value:
        meeting_info[label.text.strip()] = value.text.strip()

# Agenda items
agenda_items = []
for row in soup.select('table#ctl00_ContentPlaceHolder1_gvAgenda tr')[1:]:
    item_number = row.select_one('td:nth-of-type(1)').text.strip()
    item_title = row.select_one('td:nth-of-type(2)').text.strip()
    
    # Get item links
    links = row.select('a')
    for link in links:
        if 'Vote Result' in link.text:
            vote_url = "https://pub-london.escribemeetings.com/" + link['href']
```

## Vote Results Parsing

### PDF Vote Tables

Vote results are typically in PDFs with this structure:

```
| Councillor Name | Yes | No | Absent |
|-----------------|-----|-----|--------|
| J. Smith        |  X  |     |        |
| M. Jones        |     |  X  |        |
| Mayor           |  X  |     |        |
```

### Python PDF Parsing Example

```python
import pdfplumber
import requests
from io import BytesIO

def parse_vote_pdf(pdf_url):
    response = requests.get(pdf_url)
    votes = []
    
    with pdfplumber.open(BytesIO(response.content)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            
            for table in tables:
                # First row is usually headers
                if not table or len(table) < 2:
                    continue
                    
                headers = table[0]
                
                # Find column indices
                name_col = 0
                yes_col = headers.index('Yes') if 'Yes' in headers else 1
                no_col = headers.index('No') if 'No' in headers else 2
                absent_col = headers.index('Absent') if 'Absent' in headers else 3
                
                # Parse votes
                for row in table[1:]:
                    if not row[name_col]:
                        continue
                        
                    councillor_name = row[name_col].strip()
                    
                    # Determine vote
                    if row[yes_col] and row[yes_col].strip() in ['X', 'x', '✓']:
                        vote = 'yes'
                    elif row[no_col] and row[no_col].strip() in ['X', 'x', '✓']:
                        vote = 'no'
                    elif row[absent_col] and row[absent_col].strip() in ['X', 'x', '✓']:
                        vote = 'absent'
                    else:
                        vote = 'unknown'
                    
                    votes.append({
                        'councillor': councillor_name,
                        'vote': vote
                    })
    
    return votes
```

## Common Gotchas

### 1. Meeting Types
- Filter for "Council" meetings initially
- Committee meetings have different voting patterns
- "Special Council Meeting" should be included

### 2. Vote Types
```python
# Sometimes recorded as:
vote_mappings = {
    'X': 'yes/no',  # Position depends on column
    '✓': 'yes/no',
    'Y': 'yes',
    'N': 'no',
    'A': 'absent',
    'Ab': 'abstain',
    'R': 'recused',
    '-': 'absent',
    '': 'absent'
}
```

### 3. Councillor Name Variations
- "Mayor" vs "Mayor [Name]"
- "Deputy Mayor" when acting
- Names may include middle initials inconsistently
- Check for "Ward X - [Name]" format

### 4. Special Cases
- Unanimous votes may not have PDF
- Procedural votes often not recorded
- Some votes are voice votes (not recorded individually)

### 5. Historical Data
- URL patterns may change for older meetings
- PDFs before certain date might have different format
- Some historical meetings may not have recorded votes
- Councillor names may change due to elections/appointments

## CAPTCHA Mitigation Strategies

### Prevention (Best Approach)
```python
# 1. Polite scraping
import time
import random

def polite_request(url, session):
    # Random delay between 1-3 seconds
    time.sleep(random.uniform(1, 3))
    
    # Rotate user agents
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    ]
    
    headers = {
        'User-Agent': random.choice(user_agents),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
    }
    
    return session.get(url, headers=headers)

# 2. Session management
session = requests.Session()
# Maintain cookies across requests
```

### If You Hit CAPTCHA

1. **Manual Seed Method** (Easiest for weekly runs)
   - Open browser, navigate to site
   - Solve CAPTCHA manually
   - Export cookies using browser extension
   - Load cookies into your scraper

2. **Headless Browser** (More complex but automated)
```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

options = Options()
options.add_argument('--disable-blink-features=AutomationControlled')
driver = webdriver.Chrome(options=options)
```

3. **Contact the City** (Best long-term solution)
   - Email: citycouncil@london.ca
   - Explain your civic purpose
   - Request data access or whitelist

## Data Quality Checks

### Validate Parsed Votes
```python
def validate_votes(votes, meeting_date):
    # Check for common issues
    councillor_count = len(set(v['councillor'] for v in votes))
    
    # London has 14 councillors + mayor = 15 total
    if councillor_count < 10 or councillor_count > 15:
        print(f"Warning: Unusual councillor count: {councillor_count}")
    
    # Check for duplicate votes
    vote_counts = {}
    for vote in votes:
        key = (vote['councillor'], vote['motion'])
        vote_counts[key] = vote_counts.get(key, 0) + 1
    
    duplicates = [k for k, v in vote_counts.items() if v > 1]
    if duplicates:
        print(f"Warning: Duplicate votes found: {duplicates}")
    
    return len(duplicates) == 0
```

## Complete Working Example

See SCRAPER_STARTER.md for a full implementation example that includes all these techniques.
