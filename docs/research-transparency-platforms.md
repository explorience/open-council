# Research Report: Democracy & Transparency Platform Best Practices

*Generated for Issue #114 - Councillor Features & Scorecards*

## Executive Summary

This report analyzes leading democracy transparency platforms worldwide to identify best practices for displaying councillor statistics and engagement metrics, applicable to a local council context like Open Council.

---

## Platform Analysis

### 1. GovTrack.us (US Congress)

**Overview:** One of the most comprehensive legislative tracking platforms, tracking all bills, votes, and member statistics since 2004.

**Key Statistics Displayed:**
- **Ideology Score:** Places members on a left-right spectrum using DW-NOMINATE methodology
- **Leadership Score:** Measures how often a member's bills attract cosponsors from both parties
- **Bills Sponsored/Cosponsored:** Raw counts with success rates
- **Voting Record:** Complete vote history with filtering
- **Missed Votes:** Percentage of votes missed with comparison to median
- **Committee Assignments:** Current and historical

**Unique Features:**
- **"Report Cards":** Annual statistical summaries comparing members to peers
- **Percentile rankings:** Shows how a member compares (e.g., "more bills than 92% of senators")
- **Cosponsorship network analysis:** Visual maps of who works with whom
- **"Maverick" score:** Percentage of votes against party majority

**How They Handle Procedural vs Substantive:**
- Separates "key votes" from routine procedural votes
- Allows filtering by vote type
- Highlights "passage" votes vs amendments

**Applicable to Local Council:**
- Percentile comparisons are highly effective
- Report card format is user-friendly
- Cosponsorship networks could translate to motion co-sponsorship

---

### 2. TheyWorkForYou.com (UK Parliament)

**Overview:** Run by mySociety, this is the gold standard for parliamentary transparency in the UK.

**Key Statistics Displayed:**
- **Voting Record:** All division votes with clear "Voted for/against" labels
- **Rebellion Rate:** Percentage of votes against party whip
- **Attendance:** Both voting attendance and general attendance
- **Speaking Statistics:**
  - Number of debates spoken in
  - Words spoken (total)
  - Topics most spoken about
- **Written Questions:** Number submitted and answered
- **Early Day Motions:** Signed/sponsored

**Unique Features:**
- **Plain language vote descriptions:** "Voted against higher taxes on banks" rather than bill numbers
- **Topic tagging:** Associates speeches/votes with policy areas
- **Comparison tools:** "Compare [MP] with other MPs"
- **Alerts:** Email when your MP speaks or votes

**Independence/Maverick Definition:**
- Explicitly shows "Rebelled against their party X times"
- Provides context: "This is higher/lower than average for [party]"

**Committee Work:**
- Lists all committee memberships
- Shows attendance at committee sessions (where available)

**Applicable to Local Council:**
- Plain language descriptions are essential for accessibility
- Speaking statistics could track council meeting participation
- Topic tagging helps citizens find relevant votes

---

### 3. OpenSecrets.org

**Overview:** Focuses on money in politics - campaign finance, lobbying, and revolving door.

**Key Metrics:**
- **Campaign contributions:** By industry, organization, geography
- **Voting alignment with donors:** Correlates votes with major contributor interests
- **Lobbying disclosure:** Who's lobbying whom
- **Personal financial disclosures:** Net worth estimates
- **Outside spending:** Super PAC involvement

**Transparency Features:**
- "Follow the money" visualizations
- Industry contribution breakdowns
- Historical trend data

**Applicable to Local Council:**
- Campaign contribution tracking (where applicable)
- Could highlight declared interests vs voting patterns
- Less relevant for non-partisan local councils

---

### 4. FiveThirtyEight Political Tracking

**Overview:** Data journalism with sophisticated statistical analysis.

**Key Metrics:**
- **Trump Score / Biden Score:** How often a member votes with the president
- **Predicted vs Actual voting:** Based on district lean
- **"Maverick" analysis:** Members who vote against expectations

**Unique Approach:**
- Uses statistical modeling to set expectations
- Highlights deviations from predicted behavior
- Provides context for "why" votes matter

**Voting Predictability:**
- Explicitly calculates predictability scores
- Compares to similar members
- Considers district characteristics

**Applicable to Local Council:**
- The "predicted vs actual" framework is powerful
- Could predict voting based on ward demographics
- Helps identify true independents vs performative ones

---

### 5. ProPublica's Represent (Congress API)

**Overview:** Provides data and tools for tracking Congress.

**Key Features:**
- **Comprehensive API:** Powers many other transparency tools
- **Vote comparisons:** How similar are two members?
- **Statement tracking:** Press releases and public statements
- **Missed votes analysis:** With context and trends

**Engagement Metrics:**
- Bill introduction rate
- Amendment success rate
- Floor speech frequency

**Applicable to Local Council:**
- API-first approach enables third-party innovation
- Similarity comparisons between councillors would be valuable

---

### 6. OpenParliament.ca (Canada)

**Overview:** Tracks Canadian federal Parliament, similar to TheyWorkForYou.

**Key Statistics:**
- **Hansard participation:** Speaking frequency
- **Bill/motion sponsorship**
- **Voting record** with party loyalty metrics
- **Question Period:** Questions asked

**Unique Features:**
- **Plain language summaries** of parliamentary activity
- **Topic modeling** of speeches
- **Party discipline tracking**

**Committee Tracking:**
- Lists committee memberships
- Links to committee transcripts
- Shows committee attendance

**Applicable to Local Council:**
- Good model for Canadian context
- Committee tracking approach is relevant
- Topic modeling for council discussions

---

### 7. European Transparency Platforms

**VoteWatch.eu (European Parliament):**
- Tracks MEP voting records
- Shows party group cohesion
- National delegation analysis
- Policy area voting trends

**Abgeordnetenwatch.de (Germany):**
- Citizens can ask politicians questions
- Response rate tracking
- Voting transparency
- Side job/income disclosure

**Regards Citoyens / NosDéputés.fr (France):**
- Weekly activity metrics
- Amendment success rates
- Speaking time
- Commission participation

**Common European Features:**
- Multi-party coalition analysis
- Cross-party collaboration metrics
- Language/accessibility focus

---

## Best Practices Summary

### Core Statistics to Display

| Category | Essential Metrics | Advanced Metrics |
|----------|------------------|------------------|
| **Attendance** | Meeting attendance %, Votes participated in | Trend over time, Comparison to average |
| **Voting** | Total votes cast, Yes/No breakdown | Alignment with mayor/majority, Key vote highlights |
| **Independence** | Votes against majority, "Maverick" score | Predictability score, Party loyalty (if applicable) |
| **Engagement** | Motions introduced, Motions seconded | Speaking frequency, Questions asked |
| **Committee** | Memberships, Attendance | Chair positions, Report authorship |

### Handling Procedural vs Substantive Votes

**Best Practices:**
1. **Tag votes by type:** Procedural, budget, policy, appointments
2. **Weight differently:** Don't count procedural votes equally in independence scores
3. **Allow filtering:** Let users see "key votes only" or "all votes"
4. **Provide context:** Explain what was at stake in each vote

**Example from TheyWorkForYou:**
- Labels votes as "free vote" vs "whipped vote"
- Shows context: "This vote was on an amendment that would have..."

### Defining Independence/"Maverick" Voting

**Common Approaches:**
1. **GovTrack:** % of votes against party majority
2. **FiveThirtyEight:** Deviation from predicted voting based on district
3. **TheyWorkForYou:** "Rebellion rate" - votes against party whip

**For Non-Partisan Councils:**
- Track votes against majority
- Track votes against mayor/administration recommendations
- Identify voting "clusters" or coalitions
- Show "unusual bedfellows" votes

### Attendance Best Practices

**What to Show:**
- Overall attendance percentage
- Trend over time (improving/declining)
- Comparison to council average
- Breakdown by meeting type (full council vs committee)

**Context Matters:**
- Note legitimate absences (illness, official business)
- Some platforms show "excused" vs "unexcused"
- Consider remote participation where applicable

### Coalition/Alignment Analysis

**Effective Approaches:**
1. **Pairwise similarity:** "Councillor A voted the same as Councillor B 85% of the time"
2. **Clustering visualization:** Network diagrams showing voting blocs
3. **Policy area alignment:** Similar on housing, different on transit
4. **Historical trends:** Alignment over time

### Most Effective Visualizations

1. **Timeline/Activity heatmap:** Shows engagement over time
2. **Comparison bar charts:** Member vs average
3. **Network diagrams:** Voting coalitions and co-sponsorship
4. **Gauge/meter:** For single metrics like attendance
5. **Radar/spider charts:** Multi-dimensional comparison
6. **Voting cards:** Visual representation of yes/no/absent

### What Makes Platforms Engaging

1. **Plain language:** Translate legislative jargon
2. **Personal relevance:** "Your councillor voted..."
3. **Alerts/notifications:** Email when your rep acts
4. **Mobile-friendly:** Responsive design
5. **Shareable:** Social media integration
6. **Searchable:** Find votes by topic
7. **Contextual:** Explain why votes matter

---

## Recommendations for Open Council

### Phase 1: Essential Stats
1. **Attendance rate** with trend indicator
2. **Votes cast** (total, for/against breakdown)
3. **Motions introduced/seconded**
4. **Committee memberships**

### Phase 2: Advanced Analytics
1. **Voting alignment matrix** (who votes together)
2. **"Independence score"** (votes against majority)
3. **Topic-based voting breakdown**
4. **Speaking frequency** (if captured in data)

### Phase 3: Engagement Features
1. **Councillor comparison tool**
2. **"How did my councillor vote on X"** search
3. **Vote alerts** for followed topics
4. **Plain language vote descriptions**

### Unique Opportunities for Local Council
1. **Ward-specific issues:** Track votes affecting specific wards
2. **Developer/planning votes:** High local interest
3. **Budget votes:** Show spending priorities
4. **Response to citizen delegations:** Did they vote consistent with speakers?

---

## Key Takeaways

1. **Context is king:** Raw numbers mean little without comparison and explanation
2. **Accessibility first:** Plain language and clear visualizations
3. **Independence requires nuance:** Define it clearly and consistently
4. **Procedural votes should be separate:** Don't let them skew "real" voting patterns
5. **Committee work matters:** Often more important than floor votes
6. **Trends over snapshots:** Show trajectories, not just current state
7. **Coalition analysis is compelling:** Who works with whom?

---

This research provides a foundation for designing councillor profile pages and statistics for the Open Council platform. The most successful platforms combine quantitative data with qualitative context, making complex legislative information accessible to everyday citizens.
