# Content Generation Guide for Open Council

This guide explains how to convert scraped voting data into Quartz-compatible markdown files.

## Overview

The content generation process transforms raw JSON data from the scraper into structured markdown files that Quartz can render as a beautiful website.

## Data Flow

```
eSCRIBE Portal → Scraper → JSON Data → Content Generator → Markdown Files → Quartz → Website
```

## JSON Data Structure

### Input Format (from scraper)
```json
{
  "meetings": {
    "meeting-id-123": {
      "date": "2025-04-07",
      "type": "Regular Council Meeting",
      "info": {
        "location": "Council Chambers",
        "start_time": "7:00 PM"
      },
      "votes": [
        {
          "councillor": "Josh Morgan",
          "vote": "yes",
          "motion": "Bike Lanes Expansion on Wellington Road"
        }
      ]
    }
  },
  "councillors": {
    "josh-morgan": {
      "name": "Josh Morgan",
      "ward": "Citywide",
      "email": "jmorgan@london.ca"
    }
  }
}
```

## Content Generation Script

```python
import json
import os
from datetime import datetime
from slugify import slugify

class QuartzContentGenerator:
    def __init__(self, data_dir='data', content_dir='content'):
        self.data_dir = data_dir
        self.content_dir = content_dir
        self.ensure_directories()
    
    def ensure_directories(self):
        """Create content directory structure"""
        dirs = [
            'councillors',
            'meetings',
            'motions',
            'topics'
        ]
        for dir in dirs:
            os.makedirs(os.path.join(self.content_dir, dir), exist_ok=True)
    
    def generate_all_content(self):
        """Main entry point to generate all content"""
        # Load data
        with open(f'{self.data_dir}/votes.json', 'r') as f:
            data = json.load(f)
        
        # Generate different content types
        self.generate_councillor_pages(data)
        self.generate_meeting_pages(data)
        self.generate_motion_pages(data)
        self.generate_topic_pages(data)
        self.generate_homepage(data)
        self.generate_indices(data)
    
    def generate_councillor_pages(self, data):
        """Generate individual councillor profile pages"""
        councillors = self.extract_councillors(data)
        
        for councillor_id, info in councillors.items():
            # Calculate voting statistics
            stats = self.calculate_councillor_stats(councillor_id, data)
            
            # Generate frontmatter
            frontmatter = {
                'title': info['name'],
                'ward': info['ward'],
                'email': info.get('email', ''),
                'tags': ['councillor', f'ward-{slugify(info["ward"])}'],
                'stats': stats,
                'lastUpdated': datetime.now().strftime('%Y-%m-%d')
            }
            
            # Generate content
            content = self.format_frontmatter(frontmatter)
            content += f"\n# {info['name']}\n\n"
            content += f"**Ward:** {info['ward']}  \n"
            content += f"**Email:** {info['email']}  \n\n"
            
            # Add voting summary
            content += "## Voting Summary\n\n"
            content += f"- **Total Votes:** {stats['totalVotes']}\n"
            content += f"- **Attendance Rate:** {stats['attendance']}%\n"
            content += f"- **Yes Votes:** {stats['yesVotes']} ({stats['yesPercentage']}%)\n"
            content += f"- **No Votes:** {stats['noVotes']} ({stats['noPercentage']}%)\n\n"
            
            # Add recent votes
            content += "## Recent Votes\n\n"
            recent_votes = self.get_recent_votes(councillor_id, data, limit=10)
            
            for vote in recent_votes:
                icon = self.get_vote_icon(vote['vote'])
                date = vote['date']
                motion_slug = slugify(vote['motion'])
                content += f"- {icon} [[motions/{motion_slug}|{vote['motion']}]] - {date}\n"
            
            # Add voting alignment
            content += "\n## Voting Alignment\n\n"
            alignments = self.calculate_alignments(councillor_id, data)
            
            content += "Most aligned with:\n"
            for aligned in alignments['most'][:3]:
                content += f"- [[{slugify(aligned['name'])}|{aligned['name']}]] - {aligned['percentage']}%\n"
            
            content += "\nLeast aligned with:\n"
            for aligned in alignments['least'][:3]:
                content += f"- [[{slugify(aligned['name'])}|{aligned['name']}]] - {aligned['percentage']}%\n"
            
            # Save file
            filename = f"{self.content_dir}/councillors/{slugify(info['name'])}.md"
            with open(filename, 'w') as f:
                f.write(content)
    
    def generate_meeting_pages(self, data):
        """Generate meeting summary pages"""
        for meeting_id, meeting in data['meetings'].items():
            # Generate frontmatter
            frontmatter = {
                'title': f"Council Meeting - {meeting['date']}",
                'date': meeting['date'],
                'type': meeting['type'],
                'tags': ['meeting', 'council', meeting['date'][:7]],
                'meetingId': meeting_id
            }
            
            # Generate content
            content = self.format_frontmatter(frontmatter)
            content += f"\n# {meeting['type']} - {meeting['date']}\n\n"
            
            # Meeting info
            if meeting.get('info'):
                content += "## Meeting Information\n\n"
                for key, value in meeting['info'].items():
                    content += f"- **{key.replace('_', ' ').title()}:** {value}\n"
                content += "\n"
            
            # Group votes by motion
            motions = self.group_votes_by_motion(meeting['votes'])
            
            content += "## Motions Voted On\n\n"
            for motion_title, votes in motions.items():
                motion_slug = slugify(motion_title)
                
                # Count votes
                yes_count = sum(1 for v in votes if v['vote'] == 'yes')
                no_count = sum(1 for v in votes if v['vote'] == 'no')
                absent_count = sum(1 for v in votes if v['vote'] == 'absent')
                
                result = "Passed" if yes_count > no_count else "Failed"
                
                content += f"### [[motions/{motion_slug}|{motion_title}]]\n\n"
                content += f"**Result:** {result} (Yes: {yes_count}, No: {no_count}, Absent: {absent_count})\n\n"
                
                # Voting breakdown
                content += "<details>\n<summary>Voting Breakdown</summary>\n\n"
                
                for vote in sorted(votes, key=lambda x: x['councillor']):
                    icon = self.get_vote_icon(vote['vote'])
                    councillor_slug = slugify(vote['councillor'])
                    content += f"- {icon} [[councillors/{councillor_slug}|{vote['councillor']}]]\n"
                
                content += "\n</details>\n\n"
            
            # Save file
            date_slug = meeting['date'].replace(' ', '-').lower()
            filename = f"{self.content_dir}/meetings/{date_slug}.md"
            with open(filename, 'w') as f:
                f.write(content)
    
    def generate_homepage(self, data):
        """Generate the homepage with recent activity"""
        content = """---
title: Open Council - London
tags: [index]
---

# Open Council - London

Making London City Council voting records transparent and accessible to all citizens.

## Recent Votes

"""
        # Get last 5 meetings
        recent_meetings = self.get_recent_meetings(data, limit=5)
        
        for meeting in recent_meetings:
            date_slug = meeting['date'].replace(' ', '-').lower()
            content += f"### [[meetings/{date_slug}|{meeting['type']} - {meeting['date']}]]\n\n"
            
            # Show first 3 motions from this meeting
            motions = self.group_votes_by_motion(meeting['votes'])
            for i, (motion_title, votes) in enumerate(list(motions.items())[:3]):
                yes_count = sum(1 for v in votes if v['vote'] == 'yes')
                no_count = sum(1 for v in votes if v['vote'] == 'no')
                result_icon = "✅" if yes_count > no_count else "❌"
                
                motion_slug = slugify(motion_title)
                content += f"- {result_icon} [[motions/{motion_slug}|{motion_title}]] ({yes_count}-{no_count})\n"
            
            if len(motions) > 3:
                content += f"- *...and {len(motions) - 3} more motions*\n"
            
            content += "\n"
        
        # Add quick stats
        content += """## Quick Stats

- **Total Meetings Tracked:** """ + str(len(data['meetings'])) + """
- **Councillors:** 15
- **Last Updated:** """ + datetime.now().strftime('%Y-%m-%d') + """

## Explore

- [[councillors/|Browse Councillors]] - See voting records by councillor
- [[meetings/|View Meetings]] - Browse all council meetings
- [[topics/|Topics]] - Explore votes by topic
- [[about|About This Project]] - Learn more about Open Council

## Search

Use the search bar above to find specific motions, councillors, or topics.
"""
        
        # Save file
        with open(f"{self.content_dir}/index.md", 'w') as f:
            f.write(content)
    
    # Helper methods
    def format_frontmatter(self, data):
        """Format dictionary as YAML frontmatter"""
        import yaml
        return f"---\n{yaml.dump(data, default_flow_style=False)}---\n"
    
    def get_vote_icon(self, vote):
        """Return emoji icon for vote type"""
        icons = {
            'yes': '✅',
            'no': '❌',
            'absent': '⭕',
            'abstain': '⏸️'
        }
        return icons.get(vote, '❓')
    
    def slugify(self, text):
        """Convert text to URL-friendly slug"""
        return slugify(text)
    
    def extract_councillors(self, data):
        """Extract unique councillors from voting data"""
        councillors = {}
        
        for meeting in data['meetings'].values():
            for vote in meeting.get('votes', []):
                name = vote['councillor']
                if name not in councillors:
                    # Extract ward from name if present
                    # This is a simplified version - enhance based on actual data
                    councillors[name] = {
                        'name': name,
                        'ward': 'Unknown',  # Would be extracted from other sources
                        'email': ''  # Would be added from councillor data
                    }
        
        return councillors

# Usage
if __name__ == "__main__":
    generator = QuartzContentGenerator()
    generator.generate_all_content()
    print("Content generation complete!")
```

## Key Features

### 1. Automatic Linking
- Use `[[page-name]]` syntax for internal links
- Quartz automatically creates backlinks
- Dead links are highlighted for easy fixing

### 2. Tag Organization
- Tags in frontmatter create topic pages
- Automatic tag clouds and indexes
- Filter content by multiple tags

### 3. Graph Visualization
- Voting relationships appear in graph view
- Clustered by voting alignment
- Interactive exploration

### 4. Search Integration
- All content is automatically indexed
- Full-text search across all fields
- Fuzzy matching for names

## Customization Tips

### Vote Display
```markdown
:::vote-display
councillor: Josh Morgan
motion: Bike Lanes Expansion
vote: yes
date: 2025-04-07
:::
```

### Voting Matrix
```markdown
:::voting-matrix
meeting: 2025-04-07
style: compact
:::
```

### Councillor Card
```markdown
:::councillor-card
name: Josh Morgan
ward: Citywide
style: full
:::
```

## File Naming Conventions

- **Councillors**: `firstname-lastname.md`
- **Meetings**: `YYYY-MM-DD.md`
- **Motions**: `YYYY-NNN-brief-description.md`
- **Topics**: `topic-name.md`

## Automation

Add to your GitHub Action:

```yaml
- name: Generate Quartz content
  run: |
    python scripts/generate_content.py
    
- name: Commit generated content
  uses: stefanzweifel/git-auto-commit-action@v4
  with:
    commit_message: 'Generate Quartz content from latest data'
    file_pattern: 'content/**/*.md'
```

This ensures your Quartz site always reflects the latest voting data!
