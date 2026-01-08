# Councillor Comparison Tools - Research and Implementation Plan

*Generated for Issue #114 - Councillor Features & Scorecards*

## Executive Summary

This document outlines a plan to implement councillor comparison tools for Open Council, allowing London citizens to compare councillors side-by-side on voting records, attendance, alignment, and other metrics.

## 1. Existing Data Analysis

### Available Data (from `data/stats/councillor-stats.json`)

For each councillor, the following metrics are available:

| Metric | Description | Data Source |
|--------|-------------|-------------|
| **Attendance Rate** | % of meetings attended | `attendance.attendanceRate` |
| **Total Meetings** | Meetings during their term | `attendance.totalMeetings` |
| **Remote Attendance** | Count of remote meetings | `attendance.remote` |
| **Vote Participation Rate** | % of votes where they participated | `voting.participationRate` |
| **Yea Rate** | % of participated votes that were yea | `voting.yeaRate` |
| **Total Votes** | Total recorded votes | `voting.totalVotes` |
| **Contested Dissent Rate** | % of split votes where they voted against outcome | `voting.contestedDissentRate` |
| **Top Alignments** | 5 councillors most aligned with | `topAlignments[]` |
| **Bottom Alignments** | 5 councillors least aligned with | `bottomAlignments[]` |

### Alignment Matrix (from `data/stats/alignment-matrix.json`)

A complete pairwise alignment matrix exists for all 15 current councillors, showing:
- Alignment rate percentages (range: ~77% to ~98%)
- This enables direct "Councillor A votes with Councillor B X% of the time" comparisons

### Vote Data (individual files in `data/votes/`)

Each councillor has detailed vote records with:
- Date, meeting slug, item number
- Motion text
- Vote (yea/nay/absent)
- Result and whether it passed

### What's NOT Currently Available
- **Topic/Issue categorization** - Votes are not tagged by policy area (housing, transit, budget, etc.)
- **Ward representation** - No ward-specific data or predecessor tracking
- **Time-series data** - Stats are aggregates, not broken down by year/term

---

## 2. Comparison with Other Platforms

### GovTrack.us Approach
- **Side-by-side comparison**: Select 2 members, see voting alignment %
- **Ideology charts**: Plot members on a left-right spectrum
- **Vote overlap calculator**: "X and Y agree Z% of the time"
- **Key metrics**: Cosponsored bills, leadership roles, missed votes

### TheyWorkForYou Approach
- **Voting record tables**: Show how MPs voted on key issues
- **Policy position summaries**: "Generally voted for/against X"
- **Attendance/speaking stats**: Raw numbers displayed prominently
- **No direct side-by-side comparison tool**

### Key Insight
GovTrack's comparison is more actionable because it focuses on **direct alignment** between specific members. TheyWorkForYou is more about understanding a single MP's positions.

---

## 3. Recommended Design: Phased Approach

### Phase 1: Side-by-Side Councillor Comparison (High Value, Medium Effort)

**URL Structure**: `/councillors/compare` with client-side state management

**Features**:
1. **Multi-select dropdown** - Select 2-4 councillors to compare
2. **Comparison table** showing:
   - Attendance rate
   - Vote participation rate
   - Dissent rate (100 - yea rate)
   - Contested dissent rate
   - Total votes / meetings
3. **Pairwise alignment** - For each pair selected, show agreement %
4. **Visual bars** for easy comparison

**Technical Approach**:
- Static markdown page (`content/councillors/compare.md`) with `type: councillor-compare`
- New Quartz component (`CouncillorCompare.tsx`)
- Client-side JavaScript reads URL params (`?c=a-hopkins&c=s-stevenson`) and councillor-stats.json
- Uses existing patterns from `AlignmentMatrix` and `CouncillorRankings` components

**Data Requirements**:
- All data already exists in `councillor-stats.json`
- No backend changes needed

### Phase 2: Vote Overlap Calculator (High Value, Low Effort)

**Enhancement to Phase 1**:
- Show detailed stats when comparing 2 councillors:
  - "A Hopkins and S Stevenson voted together on X of Y shared votes (Z%)"
  - "They agree most on procedural votes, least on zoning matters"

**Technical**: Already in `alignmentMatrix[slug1][slug2]` with `sharedVotes` and `agreedVotes`

### Phase 3: Issue-Based Comparison (High Value, High Effort)

**The Challenge**: Votes are not currently tagged by topic

**Required Work**:
1. **Topic Classification Script** - Analyze motion text to categorize into:
   - Housing/Development
   - Transit/Transportation
   - Budget/Finance
   - Environment/Climate
   - Social Services
   - Public Safety
   - Infrastructure
   - Governance/Procedural

2. **Extended Stats Generation** - Update `generate-stats.ts` to produce per-topic stats

3. **UI Enhancement** - Add topic filter to comparison page

**Approach Options**:
- **LLM Classification**: Use Claude to classify motion text (batch process)
- **Keyword Heuristics**: Pattern matching on motion text (less accurate but simpler)
- **Hybrid**: LLM for initial classification, then cache results

### Phase 4: Ward Comparison / Predecessor Tracking (Medium Value, Medium Effort)

**Data Gap**: Need ward assignment per councillor/term

**Required**:
1. Add ward data to councillor registry (`lib/councillors/registry.json`)
2. Historical ward mapping (wards change over time)
3. Script to calculate ward-specific metrics

---

## 4. Technical Implementation Details

### Files to Create

| File | Purpose |
|------|---------|
| `content/councillors/compare.md` | Static page with `type: councillor-compare` |
| `quartz/components/CouncillorCompare.tsx` | Main comparison component |
| `quartz/components/scripts/councillorCompare.inline.ts` | Client-side logic |
| `quartz/components/styles/councillorCompare.scss` | Styles |

### Files to Modify

| File | Changes |
|------|---------|
| `quartz/components/index.ts` | Export new component |
| `quartz.layout.ts` | Add component to councillor pages |
| `content/councillors/index.md` | Add link to comparison tool |

### URL Design

```
/councillors/compare                          # Empty state - shows selection UI
/councillors/compare?c=a-hopkins              # Single councillor - shows their stats
/councillors/compare?c=a-hopkins&c=s-stevenson # Two councillors - full comparison
/councillors/compare?c=a-hopkins&c=s-stevenson&c=p-cuddy # Three-way comparison
```

### Component Architecture

```
CouncillorCompare.tsx
├── CouncillorSelector (multi-select dropdown)
├── ComparisonTable (metrics side-by-side)
├── AlignmentSummary (pairwise agreement %)
└── VoteHistoryTeaser (link to ask AI about specific topics)
```

---

## 5. User Experience Flow

1. **Entry Point**: Link from councillors index page or individual councillor pages
2. **Selection**: User picks 2-4 councillors from searchable dropdown
3. **Instant Results**: Page updates immediately (client-side, no reload)
4. **Shareability**: URL updates with selections for easy sharing
5. **Mobile-Friendly**: Stack metrics vertically on small screens

### Mock UI

```
┌────────────────────────────────────────────────────────────────┐
│  Compare Councillors                                           │
│                                                                 │
│  Select councillors: [A. Hopkins ▼] [S. Stevenson ▼] [+ Add]  │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│                    │ Anna Hopkins │ Susan Stevenson │           │
├────────────────────┼──────────────┼──────────────────┤          │
│ Attendance Rate    │ 49.9%        │ 41.3%            │          │
│ Vote Participation │ 94.1%        │ 86.0%            │          │
│ Dissent Rate       │ 7.6%         │ 17.8%            │          │
│ Total Votes        │ 9,332        │ 3,138            │          │
├────────────────────┴──────────────┴──────────────────┤          │
│                                                                 │
│  📊 Voting Alignment                                            │
│  ─────────────────                                              │
│  Hopkins and Stevenson agree 81.5% of the time                  │
│  (Based on 1,266 shared votes)                                  │
│                                                                 │
│  💬 Ask about their voting patterns                             │
│  "How did Hopkins and Stevenson vote on housing developments?"  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation Roadmap

### Sprint 1 (Recommended Start)
**Goal**: Basic side-by-side comparison

1. Create markdown page with `type: councillor-compare`
2. Build `CouncillorCompare.tsx` component
3. Implement councillor selection UI
4. Display comparison table with existing metrics
5. Add URL param handling for shareable links
6. Add navigation link from councillor index

**Estimated Effort**: 4-6 hours

### Sprint 2
**Goal**: Alignment visualization

1. Add pairwise alignment display
2. Create mini alignment matrix for selected councillors
3. Improve mobile responsiveness
4. Add "share comparison" button

**Estimated Effort**: 2-3 hours

### Sprint 3
**Goal**: Issue categorization (if desired)

1. Design topic taxonomy
2. Build classification script (keyword or LLM-based)
3. Extend stats generation
4. Add topic filter to comparison UI

**Estimated Effort**: 8-12 hours

---

## 7. Recommendations

### Immediate Priority
**Implement Phase 1** - The side-by-side comparison provides immediate value with minimal effort since all required data already exists.

### Medium-Term Priority
**Topic Classification** - This would make the comparison much more actionable ("How do they vote on housing?") but requires significant work.

### Defer
**Ward Comparison** - London's ward structure has changed, and predecessor tracking adds complexity. Consider after core comparison is stable.

### Integration with Chatbot
Add suggested questions to the comparison page that link to the AI chatbot:
- "How did [Councillor A] and [Councillor B] vote differently on zoning applications?"
- "What topics do [Councillor A] and [Councillor B] disagree on most?"

This leverages the RAG system's ability to find and synthesize relevant votes.

---

## 8. Summary

| Feature | Value | Effort | Data Ready |
|---------|-------|--------|------------|
| Side-by-side comparison | High | Medium | Yes |
| Vote overlap calculator | High | Low | Yes |
| Issue-based comparison | High | High | No (needs classification) |
| Ward comparison | Medium | Medium | No (needs ward data) |

**Recommended next step**: Implement Phase 1 (side-by-side comparison) using the existing component patterns from `AlignmentMatrix.tsx` and `CouncillorRankings.tsx`.
