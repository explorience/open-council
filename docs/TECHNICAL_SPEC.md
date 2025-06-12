# Technical Specification - Open Council (Quartz-based)

## Overview

Open Council leverages the Quartz static site generator to create a transparent, searchable database of London City Council voting records. This approach combines powerful scraping with Quartz's elegant presentation layer.

## Technology Stack

### Core Framework
- **Quartz 4**: Static site generator with built-in search, graph view, and backlinks
- **Obsidian**: Optional local content management
- **GitHub Pages/Netlify**: Free static hosting

### Data Pipeline
- **Language**: Python 3.9+
- **Scraping**: Firecrawl API or BeautifulSoup + Requests
- **PDF Parsing**: pdfplumber
- **Content Generation**: Python scripts to create markdown

### Automation
- **GitHub Actions**: Scheduled scraping and site rebuilds
- **Git**: Version control for all voting history

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   eSCRIBE       │────▶│  Python Scraper  │────▶│ Markdown Files  │
│   Portal        │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                           │
                        ┌──────────────────┐     ┌─────────▼────────┐
                        │   Static Site    │◀────│     Quartz       │
                        │  (GitHub Pages)  │     │    Generator     │
                        └──────────────────┘     └──────────────────┘
```

## Content Structure

### Directory Layout
```
open-council/
├── content/
│   ├── index.md                    # Homepage dashboard
│   ├── about.md                    # Project information
│   ├── methodology.md              # Data collection methods
│   ├── search.md                   # Search page (if needed)
│   │
│   ├── councillors/
│   │   ├── _index.md              # Councillor directory
│   │   ├── josh-morgan.md         # Individual profiles
│   │   ├── shawn-lewis.md
│   │   └── ...
│   │
│   ├── meetings/
│   │   ├── _index.md              # Meeting archive
│   │   ├── 2025/
│   │   │   ├── 2025-04-07.md     # Meeting summaries
│   │   │   └── ...
│   │   └── ...
│   │
│   ├── motions/
│   │   ├── _index.md              # All motions
│   │   ├── 2025-001-bike-lanes.md # Individual motions
│   │   └── ...
│   │
│   └── topics/                     # Tag-based organization
│       ├── housing.md
│       ├── transit.md
│       ├── budget.md
│       └── environment.md
│
├── data/                           # Raw scraped data
│   ├── votes.json
│   ├── meetings.json
│   └── councillors.json
│
├── scripts/                        # Automation scripts
│   ├── scraper.py                 # eSCRIBE scraper
│   ├── generate_content.py        # Markdown generator
│   └── update_stats.py            # Calculate alignments
│
└── quartz/                        # Quartz installation
    ├── components/                # Custom components
    │   ├── VoteDisplay.tsx
    │   ├── CouncillorCard.tsx
    │   └── VotingMatrix.tsx
    └── ...
```

## Markdown Frontmatter Schema

### Councillor Pages
```yaml
---
title: Josh Morgan
role: Mayor
ward: Citywide
email: jmorgan@london.ca
phone: 519-661-2489 x4000
photo: /assets/images/councillors/josh-morgan.jpg
tags: [councillor, mayor]
stats:
  totalVotes: 147
  attendance: 98.5
  yesVotes: 89
  noVotes: 58
  alignments:
    - councillor: "[[Shawn Lewis]]"
      percentage: 87
    - councillor: "[[Susan Stevenson]]" 
      percentage: 42
lastUpdated: 2025-04-08
---
```

### Meeting Pages
```yaml
---
title: Council Meeting - April 7, 2025
date: 2025-04-07
type: Regular Council Meeting
meetingId: 0e1c9b0c-f123-4567-8901-234567890abc
tags: [meeting, council, 2025-04]
stats:
  motionsTotal: 12
  motionsPassed: 8
  motionsFailed: 4
  attendance: 14/15
duration: "3h 45m"
---
```

### Motion Pages
```yaml
---
title: Bike Lanes Expansion on Wellington Road
motionId: 2025-001
meetingDate: 2025-04-07
meeting: "[[2025-04-07|April 7, 2025 Council Meeting]]"
mover: "[[Anna Hopkins]]"
seconder: "[[Shawn Lewis]]"
result: passed
voteCount:
  yes: 9
  no: 6
  absent: 0
tags: [motion, transit, cycling, infrastructure]
topics: [transit, environment]
---
```

## Custom Quartz Components

### 1. Vote Display Component
Shows individual votes with visual indicators

```typescript
// quartz/components/VoteDisplay.tsx
export interface VoteDisplayOptions {
  showDate?: boolean
  showMotionLink?: boolean
  compact?: boolean
}

export const VoteDisplay: QuartzComponentConstructor<VoteDisplayOptions>
```

### 2. Councillor Stats Card
Displays key metrics for each councillor

```typescript
// quartz/components/CouncillorCard.tsx
export interface CouncillorCardOptions {
  showAlignment?: boolean
  showContactInfo?: boolean
  cardStyle?: "compact" | "full"
}
```

### 3. Voting Matrix
Visual grid showing all votes for a meeting

```typescript
// quartz/components/VotingMatrix.tsx
export interface VotingMatrixOptions {
  meetingId: string
  interactive?: boolean
}
```

## Data Flow

### 1. Scraping Process
```python
# Weekly automated process
1. Fetch recent meetings from eSCRIBE
2. Download vote PDFs
3. Parse voting records
4. Update JSON data files
5. Trigger content generation
```

### 2. Content Generation
```python
# Convert JSON to Markdown
1. Load votes.json, meetings.json, councillors.json
2. Generate/update councillor profiles
3. Create meeting summaries
4. Generate motion pages
5. Update topic aggregation pages
6. Calculate voting alignments
7. Commit changes to Git
```

### 3. Site Build
```yaml
# Automatic via GitHub Actions
1. Detect content changes
2. Run Quartz build process
3. Deploy to GitHub Pages
4. Clear CDN cache
```

## Search Implementation

Quartz provides built-in full-text search that will automatically index:
- Councillor names
- Motion titles and descriptions
- Meeting dates
- Tags and topics

Search queries like "bike lanes", "Josh Morgan housing", or "April 2025 votes" will work out of the box.

## Graph View Integration

The Quartz graph view will visualize:
- **Nodes**: Councillors, meetings, motions
- **Edges**: Voting relationships, motion connections
- **Clusters**: Councillors who vote together frequently

## Performance Optimizations

1. **Static Generation**: No database queries at runtime
2. **CDN Delivery**: GitHub Pages/Netlify CDN
3. **Incremental Updates**: Only regenerate changed pages
4. **Image Optimization**: Councillor photos compressed
5. **Lazy Loading**: Components load as needed

## Automation Scripts

### scraper.py (Simplified for Quartz)
```python
def main():
    # 1. Scrape recent meetings
    meetings = scrape_recent_meetings()
    
    # 2. Parse votes
    all_votes = []
    for meeting in meetings:
        votes = parse_meeting_votes(meeting)
        all_votes.extend(votes)
    
    # 3. Save as JSON
    save_json('data/votes.json', all_votes)
    
    # 4. Generate markdown
    subprocess.run(['python', 'scripts/generate_content.py'])
```

### generate_content.py
```python
def generate_councillor_page(councillor, votes):
    """Creates a markdown file for each councillor"""
    
    frontmatter = {
        'title': councillor['name'],
        'ward': councillor['ward'],
        'stats': calculate_stats(councillor, votes),
        'tags': ['councillor', f'ward-{councillor["ward"]}']
    }
    
    content = create_markdown_content(frontmatter, votes)
    save_markdown(f'content/councillors/{slugify(councillor["name"])}.md', content)
```

## Deployment

### GitHub Actions Workflow
```yaml
name: Update Open Council
on:
  schedule:
    - cron: '0 10 * * 2'  # Tuesday mornings
  workflow_dispatch:      # Manual trigger

jobs:
  update-data:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      
      - name: Install dependencies
        run: pip install -r requirements.txt
      
      - name: Scrape new data
        run: python scripts/scraper.py
        
      - name: Generate content
        run: python scripts/generate_content.py
      
      - name: Commit changes
        uses: stefanzweifel/git-auto-commit-action@v4
        with:
          commit_message: 'Update voting records'
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 18
          
      - name: Install Quartz
        run: npm install
        
      - name: Build site
        run: npx quartz build
        
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
```

## Advantages of Quartz Approach

1. **Zero Backend Costs**: Pure static hosting
2. **Beautiful by Default**: Professional appearance immediately
3. **Powerful Search**: Works across all content types
4. **Graph Visualization**: Unique insight into voting patterns
5. **Version History**: Git tracks all changes
6. **Obsidian Compatible**: Edit locally with live preview
7. **Fast Performance**: Static files with CDN
8. **SEO Optimized**: Clean URLs and metadata

## Limitations & Mitigations

| Limitation | Mitigation |
|------------|------------|
| No real-time updates | Automated daily/weekly rebuilds |
| Limited filtering | Use tags and search creatively |
| No user accounts | Not needed for public data |
| Static API | Generate JSON files for developers |

## Future Enhancements

1. **RSS Feeds**: Already supported by Quartz
2. **Email Alerts**: Use GitHub Actions + external service
3. **Data Exports**: Generate CSV/JSON downloads
4. **Visualizations**: D3.js components in Quartz
5. **Comments**: Integrate Giscus (GitHub discussions)
