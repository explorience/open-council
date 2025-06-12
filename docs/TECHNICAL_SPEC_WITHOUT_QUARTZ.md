# Technical Specification - Open Council

## Overview

This document outlines the technical implementation details for the Open Council voting tracker.

## Technology Stack

### Backend
- **Language**: Python 3.9+ (for scraping) or Node.js
- **Scraping**: 
  - Primary: Firecrawl API
  - Fallback: BeautifulSoup + Requests
  - PDF parsing: pdfplumber
- **Database**: PostgreSQL (production) or SQLite (MVP)
- **API**: FastAPI or Express.js

### Frontend
- **Framework**: Next.js (if complex) or vanilla HTML/CSS/JS (MVP)
- **Styling**: Tailwind CSS
- **Charts**: Chart.js or D3.js for visualizations
- **Search**: Fuse.js for client-side search

### Infrastructure
- **Hosting**: Vercel (frontend), Railway/Render (backend)
- **Automation**: GitHub Actions for scheduled scraping
- **Monitoring**: Sentry for error tracking

## eSCRIBE Scraping Strategy

### Target URLs
```
Base: https://pub-london.escribemeetings.com/
Meeting List: /
Meeting Detail: /Meeting.aspx?Id={GUID}&Agenda={Type}&lang=English
Vote Results: /documents/VoteResults_*.pdf
```

### Scraping Workflow

1. **Get Meeting List**
```python
def get_meetings():
    url = "https://pub-london.escribemeetings.com/"
    # Parse meeting table
    # Extract meeting IDs and dates
    # Filter for Council meetings (ignore committees initially)
```

2. **Parse Meeting Details**
```python
def parse_meeting(meeting_id):
    # Get agenda items
    # Find vote results link
    # Download PDF or parse HTML table
    # Extract motion text and outcomes
```

3. **Extract Votes**
```python
def extract_votes_from_pdf(pdf_url):
    # Download PDF
    # Use pdfplumber to extract tables
    # Parse councillor names and votes
    # Handle special cases (Mayor's vote, ties)
```

### Data Parsing Patterns

#### Vote Types
- Yes/Y
- No/N
- Absent
- Abstain/Recused

#### Edge Cases
- Acting mayors
- By-elections (councillor changes)
- Recorded vs unanimous votes
- Committee of the whole votes

## Database Schema

```sql
-- Councillors table
CREATE TABLE councillors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ward VARCHAR(100),
    email VARCHAR(255),
    photo_url TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Meetings table
CREATE TABLE meetings (
    id SERIAL PRIMARY KEY,
    escribe_id VARCHAR(255) UNIQUE,
    date DATE NOT NULL,
    type VARCHAR(50), -- 'council', 'committee'
    agenda_url TEXT,
    minutes_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Motions table
CREATE TABLE motions (
    id SERIAL PRIMARY KEY,
    meeting_id INTEGER REFERENCES meetings(id),
    motion_number VARCHAR(50),
    title TEXT,
    description TEXT,
    mover_id INTEGER REFERENCES councillors(id),
    seconder_id INTEGER REFERENCES councillors(id),
    outcome VARCHAR(20), -- 'passed', 'failed', 'deferred'
    vote_type VARCHAR(20), -- 'recorded', 'unanimous'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Votes table
CREATE TABLE votes (
    id SERIAL PRIMARY KEY,
    motion_id INTEGER REFERENCES motions(id),
    councillor_id INTEGER REFERENCES councillors(id),
    vote VARCHAR(20) NOT NULL, -- 'yes', 'no', 'absent', 'abstain'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(motion_id, councillor_id)
);

-- Topics table (for categorization)
CREATE TABLE topics (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE,
    description TEXT
);

-- Motion topics junction table
CREATE TABLE motion_topics (
    motion_id INTEGER REFERENCES motions(id),
    topic_id INTEGER REFERENCES topics(id),
    PRIMARY KEY (motion_id, topic_id)
);
```

## API Endpoints

### Public API (Read-only)

```
GET /api/councillors
GET /api/councillors/{id}
GET /api/councillors/{id}/votes

GET /api/motions
GET /api/motions/{id}
GET /api/motions/search?q={query}

GET /api/meetings
GET /api/meetings/{id}

GET /api/votes?councillor={id}&motion={id}
GET /api/stats/alignment/{councillor1}/{councillor2}
```

## Frontend Pages

### Home (/)
- Recent votes
- Search box
- Quick stats

### Councillors (/councillors)
- Grid of all councillors
- Basic info and wards

### Councillor Profile (/councillors/{slug})
- Voting record
- Attendance stats
- Recent votes
- Voting alignment with others

### Motions (/motions)
- Searchable list
- Filter by date, outcome
- Tag by topic

### Motion Detail (/motions/{id})
- Full text
- Vote breakdown
- Visual representation

### About (/about)
- Project explanation
- Methodology
- Data sources
- Contact info

## Automation Strategy

### GitHub Actions Workflow

```yaml
name: Scrape Council Votes
on:
  schedule:
    - cron: '0 10 * * 2' # Tuesday mornings after Monday meetings
  workflow_dispatch: # Manual trigger

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Python
        uses: actions/setup-python@v2
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Run scraper
        run: python scraper/main.py
      - name: Notify on failure
        if: failure()
        run: # Send email/Discord notification
```

## MVP Implementation Timeline

### Week 1: Foundation
- [ ] Day 1-2: Set up dev environment, initialize repo
- [ ] Day 3-4: Build basic scraper for recent meetings
- [ ] Day 5-7: Create database, test data import

### Week 2: Core Features  
- [ ] Day 1-2: Build API endpoints
- [ ] Day 3-4: Create basic frontend
- [ ] Day 5-7: Implement search and filtering

### Week 3: Polish & Launch
- [ ] Day 1-2: Testing and bug fixes
- [ ] Day 3-4: Deploy to production
- [ ] Day 5-7: Soft launch and gather feedback

## Performance Considerations

- Cache meeting/motion data aggressively
- Implement pagination for large result sets
- Use database indexes on commonly queried fields
- Consider static site generation for better performance

## Security & Privacy

- No user accounts in MVP
- Rate limiting on API endpoints
- Sanitize all search inputs
- Respect robots.txt and scraping ethics
- HTTPS everywhere
- No personal data beyond public council info

## Monitoring & Maintenance

- Set up error alerts for scraper failures
- Monitor for eSCRIBE structure changes
- Weekly data integrity checks
- Monthly performance reviews
- Automated backups of database
