# MVP Development Checklist

## Week 1: Foundation (April 14-20, 2025)

### Setup & Environment
- [ ] Register domain (opencouncil.ca or similar)
- [ ] Set up GitHub repository
- [ ] Install Quartz 4 locally
- [ ] Initialize Python environment for scraper
- [ ] Set up Firecrawl API account
- [ ] Create basic Quartz configuration

### Scraper Development
- [ ] Test connection to pub-london.escribemeetings.com
- [ ] Build meeting list scraper
- [ ] Build individual meeting parser
- [ ] Create PDF vote extractor
- [ ] Test with recent council meetings (March-April 2025)
- [ ] Handle edge cases (absent votes, unanimous decisions)

### Data Storage
- [ ] Design JSON schema for scraped data
- [ ] Create markdown templates for content generation
- [ ] Build content generation functions
- [ ] Test markdown output in Quartz

## Week 2: Core Features (April 21-27, 2025)

### Backend API
- [ ] Set up content generation pipeline
- [ ] Create markdown generators:
  - [ ] Councillor profile pages
  - [ ] Meeting summary pages
  - [ ] Motion detail pages
  - [ ] Topic aggregation pages
- [ ] Add frontmatter for Quartz features
- [ ] Test content relationships (backlinks)

### Frontend Development
- [ ] Customize Quartz theme
- [ ] Create custom components:
  - [ ] Vote display component
  - [ ] Councillor card component
  - [ ] Voting matrix visualization
- [ ] Configure Quartz search
- [ ] Set up graph view for voting relationships
- [ ] Customize homepage layout
- [ ] Test responsive design

### Data Processing
- [ ] Import historical data (Jan-April 2025)
- [ ] Categorize motions by topic
- [ ] Calculate basic statistics (attendance, alignment)
- [ ] Verify data accuracy (spot check against source)

## Week 3: Polish & Launch (April 28 - May 4, 2025)

### Testing & Quality
- [ ] Cross-browser testing
- [ ] Mobile responsiveness check
- [ ] Load testing with sample data
- [ ] Fix critical bugs
- [ ] Accessibility audit (WCAG basics)

### Content & Documentation
- [ ] Write About page
- [ ] Create methodology page
- [ ] Add data disclaimers
- [ ] Write social media announcement posts
- [ ] Prepare press release draft

### Deployment
- [ ] Set up GitHub Pages
- [ ] Configure custom domain
- [ ] Set up GitHub Actions for:
  - [ ] Automated scraping
  - [ ] Content generation
  - [ ] Quartz builds
- [ ] Test automated workflow
- [ ] Configure caching

### Soft Launch
- [ ] Share with 5-10 trusted contacts
- [ ] Gather initial feedback
- [ ] Make quick fixes based on feedback
- [ ] Test sharing on social media
- [ ] Monitor for any issues

## Post-Launch Tasks

### Week 4: Iterate & Improve
- [ ] Address user feedback
- [ ] Add missing features from MVP
- [ ] Improve search functionality
- [ ] Add more data visualizations
- [ ] Optimize performance

### Week 5-6: Expansion
- [ ] Add committee votes
- [ ] Import 2024 historical data
- [ ] Create comparison tools
- [ ] Add email alerts feature
- [ ] Reach out to local media

### Future Considerations
- [ ] API documentation for developers
- [ ] Data export features
- [ ] Voting prediction models
- [ ] Councillor scorecards
- [ ] Expansion to other cities

## Success Criteria

### Technical
- [ ] Successfully scrapes weekly council meetings
- [ ] Less than 3 second page load time
- [ ] 99% uptime in first month
- [ ] Zero critical bugs at launch

### Impact
- [ ] 100+ unique visitors in first week
- [ ] Shared by at least 1 councillor
- [ ] Mentioned in local media
- [ ] Used in public discourse

## Emergency Contacts

- Domain/Hosting Issues: [Provider support]
- Technical Questions: [AI assistants, Stack Overflow]
- eSCRIBE Changes: [Monitor daily in week 1]
- Press Inquiries: [Prepared statement ready]

## Notes

- Start small, iterate quickly
- Prioritize accuracy over features
- Keep the interface simple and fast
- Document everything for future contributors
- Celebrate small wins!
