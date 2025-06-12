# Sample Scraper Code for Open Council

This is a starting template for scraping London's eSCRIBE portal. Use this with AI coding assistants like Cursor or Windsurf.

```python
import requests
from bs4 import BeautifulSoup
import pdfplumber
from datetime import datetime
import json
import time
import os
from io import BytesIO

class LondonCouncilScraper:
    def __init__(self):
        self.base_url = "https://pub-london.escribemeetings.com"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        
    def get_recent_meetings(self, limit=10):
        """Get list of recent council meetings"""
        response = self.session.get(f"{self.base_url}/")
        soup = BeautifulSoup(response.text, 'html.parser')
        
        meetings = []
        meeting_rows = soup.select('table#ctl00_ContentPlaceHolder1_gvMeetings tr')[1:limit+1]
        
        for row in meeting_rows:
            cells = row.select('td')
            if len(cells) >= 3:
                meeting_type = cells[0].text.strip()
                
                # Only get Council meetings for MVP
                if 'Council' in meeting_type:
                    meeting_date = cells[1].text.strip()
                    link = cells[2].select_one('a[href*="Meeting.aspx"]')
                    
                    if link:
                        meeting_url = f"{self.base_url}/{link['href']}"
                        meetings.append({
                            'type': meeting_type,
                            'date': meeting_date,
                            'url': meeting_url,
                            'meeting_id': self.extract_meeting_id(link['href'])
                        })
        
        return meetings
    
    def extract_meeting_id(self, href):
        """Extract meeting ID from URL"""
        import re
        match = re.search(r'Id=([a-f0-9-]+)', href)
        return match.group(1) if match else None
    
    def get_meeting_details(self, meeting_url):
        """Get details of a specific meeting including vote results"""
        response = self.session.get(meeting_url)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Extract meeting metadata
        meeting_info = {}
        info_table = soup.select('table.meetingInfo tr')
        for row in info_table:
            cells = row.select('td')
            if len(cells) >= 2:
                key = cells[0].text.strip().rstrip(':')
                value = cells[1].text.strip()
                meeting_info[key] = value
        
        # Find vote results link
        vote_results_link = None
        for link in soup.select('a'):
            if 'Vote Result' in link.text:
                vote_results_link = f"{self.base_url}/{link['href']}"
                break
        
        # Get agenda items
        agenda_items = []
        agenda_rows = soup.select('table#ctl00_ContentPlaceHolder1_gvAgenda tr')[1:]
        
        for row in agenda_rows:
            cells = row.select('td')
            if len(cells) >= 2:
                item_number = cells[0].text.strip()
                item_title = cells[1].text.strip()
                agenda_items.append({
                    'number': item_number,
                    'title': item_title
                })
        
        return {
            'info': meeting_info,
            'vote_results_url': vote_results_link,
            'agenda_items': agenda_items
        }
    
    def parse_vote_pdf(self, pdf_url):
        """Parse vote results from PDF"""
        response = self.session.get(pdf_url)
        votes = []
        
        with pdfplumber.open(BytesIO(response.content)) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                tables = page.extract_tables()
                
                # Parse each table on the page
                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    
                    # Look for vote table structure
                    headers = table[0]
                    if not any('Yes' in str(h) for h in headers):
                        continue
                    
                    # Find column indices
                    name_col = 0
                    yes_col = next((i for i, h in enumerate(headers) if 'Yes' in str(h)), 1)
                    no_col = next((i for i, h in enumerate(headers) if 'No' in str(h)), 2)
                    absent_col = next((i for i, h in enumerate(headers) if 'Absent' in str(h)), 3)
                    
                    # Extract motion info from surrounding text
                    motion_title = self.extract_motion_from_text(text)
                    
                    # Parse each row
                    for row in table[1:]:
                        if not row or not row[name_col]:
                            continue
                        
                        councillor_name = str(row[name_col]).strip()
                        
                        # Skip if not a valid councillor name
                        if not councillor_name or councillor_name.lower() in ['total', 'motion', '']:
                            continue
                        
                        # Determine vote
                        vote = 'unknown'
                        if row[yes_col] and str(row[yes_col]).strip() in ['X', 'x', '✓', 'Y']:
                            vote = 'yes'
                        elif row[no_col] and str(row[no_col]).strip() in ['X', 'x', '✓', 'N']:
                            vote = 'no'
                        elif row[absent_col] and str(row[absent_col]).strip() in ['X', 'x', '✓', 'A']:
                            vote = 'absent'
                        
                        votes.append({
                            'councillor': councillor_name,
                            'vote': vote,
                            'motion': motion_title
                        })
        
        return votes
    
    def extract_motion_from_text(self, text):
        """Extract motion description from PDF text"""
        # This is a simple implementation - enhance based on actual PDF structure
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if 'Motion' in line or 'MOTION' in line:
                # Return the line and possibly the next line
                motion_text = line
                if i + 1 < len(lines):
                    motion_text += ' ' + lines[i + 1]
                return motion_text.strip()
        return "Motion details not found"
    
    def save_to_json(self, data, filename='data/votes.json'):
        """Save scraped data to JSON files for content generation"""
        import os
        import json
        
        # Ensure data directory exists
        os.makedirs('data', exist_ok=True)
        
        # Load existing data if it exists
        existing_data = {}
        if os.path.exists(filename):
            with open(filename, 'r') as f:
                existing_data = json.load(f)
        
        # Merge new data
        meeting_id = data.get('meeting_id')
        if 'meetings' not in existing_data:
            existing_data['meetings'] = {}
        
        existing_data['meetings'][meeting_id] = {
            'date': data.get('date'),
            'type': data.get('type'),
            'info': data.get('info'),
            'votes': data.get('votes', [])
        }
        
        # Save updated data
        with open(filename, 'w') as f:
            json.dump(existing_data, f, indent=2)
        
        print(f"Saved data to {filename}")
    
    def generate_markdown_content(self, data):
        """Generate Quartz-compatible markdown files"""
        # This would be expanded to create actual markdown files
        # For now, just a placeholder
        print("Generating markdown content for Quartz...")
        
        # Example: Generate a meeting page
        meeting_content = f"""---
title: Council Meeting - {data['date']}
date: {data['date']}
type: {data['type']}
tags: [meeting, council]
---

# {data['type']} - {data['date']}

## Votes

"""
        
        # Add vote results
        for vote in data.get('votes', []):
            meeting_content += f"- {vote['councillor']}: {vote['vote']} on {vote['motion']}\n"
        
        # Save to content directory
        filename = f"content/meetings/{data['date'].replace(' ', '-').lower()}.md"
        print(f"Would save to: {filename}")

# Example usage
if __name__ == "__main__":
    scraper = LondonCouncilScraper()
    
    # Get recent meetings
    print("Fetching recent council meetings...")
    meetings = scraper.get_recent_meetings(limit=5)
    
    for meeting in meetings:
        print(f"\nProcessing {meeting['type']} on {meeting['date']}")
        
        # Get meeting details
        details = scraper.get_meeting_details(meeting['url'])
        
        # Parse votes if available
        if details['vote_results_url']:
            print(f"Found vote results at: {details['vote_results_url']}")
            votes = scraper.parse_vote_pdf(details['vote_results_url'])
            
            # Save to JSON
            scraper.save_to_json({
                'meeting_id': meeting['meeting_id'],
                'date': meeting['date'],
                'type': meeting['type'],
                'info': details['info'],
                'votes': votes
            })
            
            # Generate markdown content
            scraper.generate_markdown_content({
                'meeting_id': meeting['meeting_id'],
                'date': meeting['date'],
                'type': meeting['type'],
                'info': details['info'],
                'votes': votes
            })
            
            print(f"Saved {len(votes)} votes to JSON")
        
        # Be polite to the server
        time.sleep(2)
    
    print("\nScraping complete!")
```

## Instructions for AI Assistants

When using this code with Cursor or Windsurf, ask the AI to:

1. **Set up the environment**:
   - "Help me install the required Python packages for this scraper"
   - "Create a requirements.txt file for this project"

2. **Test and debug**:
   - "Run this scraper and help me fix any errors"
   - "Add better error handling to this code"
   - "Help me handle CAPTCHA if we encounter it"

3. **Enhance the content generator**:
   - "Create a function to generate councillor profile pages from the JSON data"
   - "Add frontmatter with voting statistics to each councillor page"
   - "Generate topic pages that aggregate related motions"
   - "Create a homepage that shows recent votes"

4. **Build Quartz components**:
   - "Help me create a custom Quartz component to display votes"
   - "Add a voting matrix visualization component"
   - "Create a councillor card component for the directory"

5. **Set up automation**:
   - "Create a GitHub Action to run the scraper weekly"
   - "Add a step to generate markdown after scraping"
   - "Configure automatic Quartz builds and deployment"

6. **Frontend**:
   - "Create a simple HTML page to display councillor voting records"
   - "Add search functionality to the frontend"
   - "Make the design responsive with Tailwind CSS"

## Tips for Success

1. Start with just one recent meeting to test
2. Print out lots of debug info to understand the data structure
3. Save raw HTML/PDF for debugging when parsing fails
4. Check robots.txt and add delays between requests
5. Use try/except blocks around parsing code
6. Keep the database schema simple initially
7. Test with different types of votes (unanimous, recorded, etc.)

## Common Issues to Watch For

1. **Dynamic Content**: Some content might be loaded with JavaScript
2. **Session Expiry**: The session might timeout after inactivity  
3. **PDF Variations**: Vote tables might have different formats
4. **Name Variations**: Same councillor might appear differently
5. **Missing Data**: Not all meetings have recorded votes

Remember: This is just a starting point. The AI assistants can help you improve and expand this code significantly!
