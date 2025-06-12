# Implementing Open Council with Quartz

## Overview

This guide explains how to build Open Council using Quartz as the foundation, extending it with custom components for displaying voting data.

## Architecture

### Core Concept
Instead of a traditional database, we'll generate markdown files from scraped data. Quartz will handle search, navigation, and display.

### Directory Structure
```
open-council-quartz/
├── content/
│   ├── index.md                 # Homepage with recent votes
│   ├── about.md                 # About the project
│   ├── methodology.md           # How we collect data
│   ├── councillors/
│   │   ├── _index.md           # Councillor directory
│   │   ├── josh-morgan.md      # Individual profiles
│   │   └── ...
│   ├── meetings/
│   │   ├── _index.md           # Meeting archive
│   │   ├── 2025-04-07.md       # Meeting records
│   │   └── ...
│   ├── motions/
│   │   ├── _index.md           # Motion directory
│   │   ├── 2025-001-bike-lanes.md
│   │   └── ...
│   └── topics/
│       ├── housing.md
│       ├── transit.md
│       └── environment.md
├── data/
│   ├── votes.json              # Raw voting data
│   └── councillors.json        # Councillor info
└── scripts/
    ├── scraper.py              # eSCRIBE scraper
    └── generate-content.py     # Convert data to markdown
```

## Custom Components

### 1. Vote Display Component

Create `quartz/components/VoteDisplay.tsx`:

```typescript
import { QuartzComponentConstructor, QuartzComponentProps } from "./types"

interface VoteData {
  motion: string
  vote: "yes" | "no" | "absent" | "abstain"
  date: string
}

export const VoteDisplay: QuartzComponentConstructor = (opts) => {
  return (props: QuartzComponentProps) => {
    const { fileData } = props
    const votes = fileData.frontmatter?.votes as VoteData[] || []
    
    return (
      <div class="vote-display">
        {votes.map(vote => (
          <div class={`vote-item vote-${vote.vote}`}>
            <span class="vote-icon">
              {vote.vote === "yes" ? "✅" : 
               vote.vote === "no" ? "❌" : 
               vote.vote === "absent" ? "⭕" : "⏸️"}
            </span>
            <span class="vote-motion">{vote.motion}</span>
            <span class="vote-date">{vote.date}</span>
          </div>
        ))}
      </div>
    )
  }
}
```

### 2. Councillor Card Component

```typescript
export const CouncillorCard: QuartzComponentConstructor = (opts) => {
  return (props: QuartzComponentProps) => {
    const { fileData } = props
    const { ward, attendance, totalVotes } = fileData.frontmatter
    
    return (
      <div class="councillor-card">
        <h3>{fileData.frontmatter.title}</h3>
        <p>Ward: {ward}</p>
        <p>Attendance: {attendance}%</p>
        <p>Votes Cast: {totalVotes}</p>
      </div>
    )
  }
}
```

### 3. Voting Alignment Graph

Leverage Quartz's existing graph view to show voting relationships:

```typescript
// Modify quartz.config.ts
const config: QuartzConfig = {
  plugins: {
    transformers: [
      // Add custom transformer to create links between councillors
      // based on voting alignment
    ]
  }
}
```

## Content Generation Script

```python
# scripts/generate-content.py
import json
import os
from datetime import datetime

def generate_councillor_page(councillor, votes):
    """Generate markdown for a councillor page"""
    
    # Calculate statistics
    total_votes = len(votes[councillor['id']])
    yes_votes = sum(1 for v in votes[councillor['id']] if v['vote'] == 'yes')
    
    content = f"""---
title: {councillor['name']}
ward: {councillor['ward']}
email: {councillor['email']}
totalVotes: {total_votes}
yesPercentage: {(yes_votes/total_votes*100):.1f}
tags: [councillor, ward-{councillor['ward']}]
---

# {councillor['name']}

**Ward:** {councillor['ward']}  
**Email:** {councillor['email']}

## Voting Summary

- **Total Votes:** {total_votes}
- **Yes Votes:** {yes_votes} ({(yes_votes/total_votes*100):.1f}%)
- **No Votes:** {total_votes - yes_votes}

## Recent Votes

"""
    
    # Add recent votes
    recent_votes = sorted(votes[councillor['id']], 
                         key=lambda x: x['date'], 
                         reverse=True)[:10]
    
    for vote in recent_votes:
        icon = "✅" if vote['vote'] == "yes" else "❌"
        content += f"- {icon} [[{vote['motion_id']}|{vote['motion_title']}]] ({vote['date']})\n"
    
    return content

def generate_meeting_page(meeting, motions, votes):
    """Generate markdown for a meeting page"""
    
    content = f"""---
title: Council Meeting - {meeting['date']}
date: {meeting['date']}
type: {meeting['type']}
tags: [meeting, {meeting['date'][:7]}]
---

# {meeting['type']} - {meeting['date']}

## Motions Considered

"""
    
    for motion in motions:
        content += f"\n### [[{motion['id']}|{motion['title']}]]\n\n"
        content += f"{motion['description']}\n\n"
        content += "**Voting Results:**\n"
        
        # Tally votes
        yes_count = sum(1 for v in votes[motion['id']] if v['vote'] == 'yes')
        no_count = sum(1 for v in votes[motion['id']] if v['vote'] == 'no')
        
        content += f"- Yes: {yes_count}\n"
        content += f"- No: {no_count}\n"
        content += f"- **Result:** {'Passed' if yes_count > no_count else 'Failed'}\n"
    
    return content

# Main generation logic
def generate_site_content():
    # Load scraped data
    with open('data/votes.json') as f:
        vote_data = json.load(f)
    
    # Generate councillor pages
    for councillor in vote_data['councillors']:
        content = generate_councillor_page(councillor, vote_data['votes'])
        
        filename = councillor['name'].lower().replace(' ', '-')
        with open(f'content/councillors/{filename}.md', 'w') as f:
            f.write(content)
    
    # Generate meeting pages, motion pages, etc.
    # ...

if __name__ == "__main__":
    generate_site_content()
```

## Styling Customizations

Add to `quartz/styles/custom.scss`:

```scss
.vote-display {
  .vote-item {
    display: flex;
    align-items: center;
    padding: 0.5rem;
    margin: 0.25rem 0;
    border-radius: 0.25rem;
    
    &.vote-yes { background: rgba(0, 255, 0, 0.1); }
    &.vote-no { background: rgba(255, 0, 0, 0.1); }
    &.vote-absent { background: rgba(128, 128, 128, 0.1); }
  }
  
  .vote-icon { margin-right: 0.5rem; }
  .vote-date { 
    margin-left: auto;
    font-size: 0.875rem;
    color: var(--gray);
  }
}

.councillor-card {
  border: 1px solid var(--lightgray);
  padding: 1rem;
  border-radius: 0.5rem;
  
  &:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
}
```

## Deployment Workflow

1. **Scrape Data** (GitHub Action, weekly)
```yaml
name: Update Voting Data
on:
  schedule:
    - cron: '0 10 * * 2'  # Tuesday mornings
jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: python scripts/scraper.py
      - run: python scripts/generate-content.py
      - uses: stefanzweifel/git-auto-commit-action@v4
        with:
          commit_message: Update voting records
```

2. **Build & Deploy** (Triggered by content changes)
```yaml
name: Deploy Quartz site
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npx quartz build
      - uses: actions/upload-pages-artifact@v2
        with:
          path: public
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/deploy-pages@v2
```

## Advantages of This Approach

1. **Fast & Free Hosting** - GitHub Pages or Netlify
2. **Built-in Search** - Quartz's search works across all content
3. **Beautiful by Default** - Minimal custom styling needed
4. **Graph Visualization** - Show voting alignments
5. **Obsidian Compatible** - Edit content locally
6. **SEO Friendly** - Static pages rank well
7. **No Database** - Just markdown files
8. **Version Controlled** - Full history of changes

## Potential Limitations

1. **Dynamic Filtering** - Would need custom JavaScript
2. **Real-time Updates** - Requires rebuild
3. **Complex Queries** - Limited compared to SQL
4. **API Access** - Would need separate service

## Making It Work

1. Start with Quartz 4 template
2. Add custom components for vote display
3. Create content generation scripts
4. Style with custom CSS
5. Deploy to GitHub Pages

This approach gives you a sophisticated-looking site with minimal backend complexity!
