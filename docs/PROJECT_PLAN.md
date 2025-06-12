# Open Council Project Plan

## Project Overview

**Vision**: Create a transparent, accessible platform that makes London City Council voting records easily searchable and understandable for all citizens.

**Mission**: Empower Londoners to hold their elected representatives accountable by providing clear, timely information about how councillors vote on key issues.

**Timeline**: MVP by end of April 2025, full launch before summer 2025

## Core Objectives

1. **Transparency**: Make council voting records accessible to all citizens
2. **Accountability**: Enable voters to track their councillor's positions
3. **Engagement**: Increase civic participation through easy access to information
4. **Education**: Help citizens understand local government decision-making

## Technical Architecture

### Data Pipeline
1. **Scraping**: Firecrawl/Hyperbrowser → eSCRIBE portal
2. **Parsing**: Claude API → Extract voting records
3. **Content Generation**: Python → Markdown files
4. **Site Generator**: Quartz → Static website
5. **Hosting**: GitHub Pages (free)

### Key Components
- Web scraper for pub-london.escribemeetings.com
- Parser for vote extraction from PDFs/HTML
- Markdown generator for Quartz content
- Custom Quartz components for vote display
- GitHub Actions for automation

## MVP Features (Phase 1)

### Must Have
- [ ] Councillor profiles with basic info
- [ ] Voting record display by councillor
- [ ] Search by motion/topic
- [ ] Basic filtering (date range, vote type)
- [ ] Mobile-responsive design
- [ ] About page explaining the project

### Nice to Have
- [ ] Voting alignment visualization
- [ ] Email alerts for specific topics
- [ ] RSS feed of recent votes
- [ ] Share buttons for social media

## Data Model

### Councillors
- id
- name
- ward
- email
- photo_url
- party_affiliation (if any)

### Motions
- id
- meeting_id
- title
- description
- date
- status (passed/failed)
- vote_type (recorded/unanimous)

### Votes
- id
- councillor_id
- motion_id
- vote (yes/no/absent/abstain)

### Meetings
- id
- date
- type (council/committee)
- agenda_url
- minutes_url

## Development Phases

### Phase 1: MVP (2-3 weeks)
- Week 1: Scraper development and Quartz setup
- Week 2: Content generation and custom components
- Week 3: Testing and soft launch

### Phase 2: Enhancement (1 month)
- Add visualization components
- Implement automated updates
- Enhance search with custom filters
- Optimize graph view for voting patterns

### Phase 3: Expansion (2-3 months)
- Add historical data (2023-2024)
- Committee vote tracking
- Advanced Quartz customizations
- Generate API endpoints from static data

## Budget Estimate

### Minimal (DIY with AI assistance)
- Domain: $15/year
- Hosting: $0-20/month (free tiers available)
- Total: ~$200/year

### Enhanced (with some contracted help)
- Domain: $15/year
- Hosting: $20-50/month
- Designer consultation: $500-1000
- Developer assistance: $1000-2000
- Total: ~$3000 first year

## Success Metrics

### Launch (First Month)
- 100+ unique visitors
- 50+ searches performed
- 5+ social media mentions

### Growth (3 Months)
- 500+ monthly users
- Media coverage (at least 1 outlet)
- Used in public discourse

### Impact (6 Months)
- Referenced in council discussions
- 1000+ monthly users
- Expansion interest from other cities

## Risk Mitigation

### Technical Risks
- **Scraping blocks**: Use polite scraping, contact city if needed
- **Data accuracy**: Manual verification of sample data
- **Site changes**: Modular scraper design for easy updates

### Political Risks
- **Pushback**: Frame as non-partisan transparency tool
- **Misuse**: Clear disclaimers about data interpretation
- **Bias accusations**: Open source code, transparent methodology

## Next Steps

1. **Finalize name and register domain**
2. **Set up development environment**
3. **Build proof-of-concept scraper**
4. **Create basic database schema**
5. **Design simple UI mockups**
6. **Begin scraping recent votes (2025)**
7. **Soft launch with close contacts**
8. **Iterate based on feedback**
9. **Public launch with media outreach**

## Allies & Resources

### Potential Supporters
- London Free Press reporters
- Engaged citizen groups
- Progressive councillors
- Western University journalism/political science
- Local tech community

### Technical Resources
- OttWatch codebase (reference)
- Councilmatic (architecture ideas)
- OpenParliament (inspiration)
- eSCRIBE scraping guides

## Long-term Vision

Start with London, but build with expansion in mind. Other Ontario municipalities using eSCRIBE could adopt the same codebase with minimal changes. Ultimate goal: a federated network of municipal voting trackers across Canada, making local democracy as transparent as federal politics.
