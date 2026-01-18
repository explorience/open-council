/**
 * Generate summary pages for committees, years, and councillors
 *
 * This script scans all meeting content, extracts metadata, and generates
 * browsable index pages.
 *
 * Usage: npx tsx scripts/generate-pages.ts
 */

import fs from "fs/promises"
import path from "path"
import matter from "gray-matter"

// Import councillor data from shared module
import {
  loadRegistry,
  isCurrentCouncillor,
  extractCouncillors,
  type Meeting,
} from "../lib/councillors/index.js"

// Vote stats interface
interface VoteStats {
  totalVotes: number
  yeas: number
  nays: number
  absent: number
}

// Attendance trend period
interface AttendancePeriod {
  period: string
  attendanceRate: number
  meetingsAttended: number
  meetingsTotal: number
}

// Councillor stats interface
interface CouncillorStatsData {
  attendance: {
    totalMeetings: number
    present: number
    absent: number
    attendanceRate: number
    trend?: AttendancePeriod[]
    trendDirection?: "improving" | "declining" | "stable" | "insufficient_data"
  }
  voting: {
    totalVotes: number
    yeas: number
    nays: number
    absent: number
    participationRate: number
    yeaRate: number
    contestedDissentRate?: number // % of contested (non-unanimous) votes where councillor voted against final outcome
    contestedVotes?: number // Number of contested votes the councillor participated in
    // Substantive votes (excludes procedural motions)
    substantiveVotes?: number
    substantiveYeas?: number
    substantiveNays?: number
    substantiveParticipationRate?: number
    substantiveYeaRate?: number
  }
  budgetVoting?: {
    totalBudgetVotes: number
    budgetYeas: number
    budgetNays: number
    budgetAbsent: number
  }
  topAlignments: Array<{
    councillor: string
    alignmentRate: number
  }>
  bottomAlignments: Array<{
    councillor: string
    alignmentRate: number
  }>
  committeeActivity?: Array<{
    committee: string
    totalVotes: number
    yeas: number
    nays: number
    participationRate: number
  }>
  notableDissents?: Array<{
    date: string
    meetingTitle: string
    itemTitle: string
    motionText: string
    vote: "yea" | "nay"
    result: string
    meetingUrl?: string
  }>
}

// Load vote stats for a councillor (if available)
async function loadVoteStats(slug: string): Promise<VoteStats | null> {
  const votePath = path.join(process.cwd(), "data", "votes", `${slug}.json`)
  try {
    const content = await fs.readFile(votePath, "utf-8")
    const data = JSON.parse(content)
    return data.summary as VoteStats
  } catch {
    return null
  }
}

// Load councillor stats (if available)
async function loadCouncillorStats(slug: string): Promise<CouncillorStatsData | null> {
  const statsPath = path.join(process.cwd(), "data", "stats", `${slug}.json`)
  try {
    const content = await fs.readFile(statsPath, "utf-8")
    const data = JSON.parse(content)
    return data as CouncillorStatsData
  } catch {
    return null
  }
}

interface CommitteeData {
  name: string
  slug: string
  meetings: Meeting[]
  count: number
}

interface YearData {
  year: number
  meetings: Meeting[]
  count: number
  committeeBreakdown: { name: string; count: number }[]
}

interface CouncillorData {
  name: string
  slug: string
  meetings: Meeting[]
  count: number
  committees: { name: string; slug: string }[]
  yearsActive: number[]
}

// Load councillor registry from JSON data (source of truth)
const VERIFIED_COUNCILLORS = loadRegistry()

// Committee name normalization map
const COMMITTEE_MAPPINGS: Record<string, { name: string; slug: string }> = {
  "planning and environment": { name: "Planning and Environment Committee", slug: "planning-environment" },
  "planning & environment": { name: "Planning and Environment Committee", slug: "planning-environment" },
  "corporate services": { name: "Corporate Services Committee", slug: "corporate-services" },
  "strategic priorities and policy": { name: "Strategic Priorities and Policy Committee", slug: "strategic-priorities" },
  "strategic priorities & policy": { name: "Strategic Priorities and Policy Committee", slug: "strategic-priorities" },
  "civic works": { name: "Civic Works Committee", slug: "civic-works" },
  "community and protective services": { name: "Community and Protective Services Committee", slug: "community-protective-services" },
  "community & protective services": { name: "Community and Protective Services Committee", slug: "community-protective-services" },
  "audit": { name: "Audit Committee", slug: "audit" },
  "audit committee": { name: "Audit Committee", slug: "audit" },
  "budget": { name: "Budget Committee", slug: "budget" },
  "budget committee": { name: "Budget Committee", slug: "budget" },
  "city council": { name: "City Council", slug: "city-council" },
  "council": { name: "City Council", slug: "city-council" },
  "infrastructure and corporate services": { name: "Infrastructure and Corporate Services Committee", slug: "infrastructure-corporate-services" },
  "infrastructure & corporate services": { name: "Infrastructure and Corporate Services Committee", slug: "infrastructure-corporate-services" },
}

// Slugify helper
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Format a date for display (e.g., "Wed Nov 22 2017")
function formatMeetingDate(date: string | Date): string {
  const dateObj = date instanceof Date ? date : new Date(date)
  const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
  const month = dateObj.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
  const day = dateObj.getUTCDate()
  const year = dateObj.getUTCFullYear()
  return `${weekday} ${month} ${day} ${year}`
}

// Get ISO date string from a date (for sorting)
function getISODate(date: string | Date): string {
  if (date instanceof Date) {
    return date.toISOString().split('T')[0]
  }
  // If it's already an ISO date string, return as-is
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date
  }
  // Otherwise parse and convert
  return new Date(date).toISOString().split('T')[0]
}

// Extract committee from title
function extractCommittee(title: string): { name: string; slug: string } | null {
  const lowerTitle = title.toLowerCase()

  // Try to match known committees
  for (const [pattern, committee] of Object.entries(COMMITTEE_MAPPINGS)) {
    if (lowerTitle.includes(pattern)) {
      return committee
    }
  }

  // Fallback: try to extract from "Meeting of the X Committee" pattern
  const match = title.match(/meeting of (?:the )?(.+?)(?:\s*-|$)/i)
  if (match) {
    const name = match[1].trim()
    return { name, slug: slugify(name) }
  }

  return null
}

// Note: normalizeCouncillorName and extractCouncillors are imported from lib/councillors

// Scan all meeting files (now in months/ subfolder)
async function scanMeetings(contentDir: string): Promise<Meeting[]> {
  const meetings: Meeting[] = []

  // Meetings are now in content/months/YYYY-MM/ folders
  const monthsDir = path.join(contentDir, "months")

  let entries: { name: string; isDirectory: () => boolean }[]
  try {
    entries = await fs.readdir(monthsDir, { withFileTypes: true })
  } catch {
    // Fall back to old structure if months/ doesn't exist
    entries = await fs.readdir(contentDir, { withFileTypes: true })
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.match(/^\d{4}-\d{2}$/)) continue // Only year-month folders

    const monthDir = path.join(monthsDir, entry.name)
    const files = await fs.readdir(monthDir)

    for (const file of files) {
      if (!file.endsWith(".md")) continue

      const filePath = path.join(monthDir, file)

      let content: string
      let frontmatter: Record<string, unknown>

      try {
        content = await fs.readFile(filePath, "utf-8")
        const parsed = matter(content)
        frontmatter = parsed.data
      } catch (e) {
        // Skip files with parsing errors
        console.warn(`   ⚠ Skipping ${file}: parse error`)
        continue
      }

      const title = frontmatter.title as string || ""
      const date = frontmatter.date as string || ""

      if (!title || !date) continue

      const committee = extractCommittee(title)
      if (!committee) continue

      const councillors = extractCouncillors(content)
      const dateObj = new Date(date)

      // Create slug from folder and filename (with months/ prefix)
      const slug = `months/${entry.name}/${file.replace(".md", "")}`

      meetings.push({
        title,
        date,
        slug,
        year: dateObj.getFullYear(),
        month: dateObj.getMonth() + 1,
        committee: committee.name,
        committeeSlug: committee.slug,
        councillors,
        filePath,
      })
    }
  }

  return meetings.sort((a, b) => {
    const dateA = getISODate(a.date)
    const dateB = getISODate(b.date)
    return dateB.localeCompare(dateA) // ISO dates sort correctly lexicographically
  })
}

// Group meetings by committee
function groupByCommittee(meetings: Meeting[]): Map<string, CommitteeData> {
  const committees = new Map<string, CommitteeData>()

  for (const meeting of meetings) {
    if (!committees.has(meeting.committeeSlug)) {
      committees.set(meeting.committeeSlug, {
        name: meeting.committee,
        slug: meeting.committeeSlug,
        meetings: [],
        count: 0,
      })
    }
    const data = committees.get(meeting.committeeSlug)!
    data.meetings.push(meeting)
    data.count++
  }

  return committees
}

// Group meetings by year
function groupByYear(meetings: Meeting[]): Map<number, YearData> {
  const years = new Map<number, YearData>()

  for (const meeting of meetings) {
    if (!years.has(meeting.year)) {
      years.set(meeting.year, {
        year: meeting.year,
        meetings: [],
        count: 0,
        committeeBreakdown: [],
      })
    }
    const data = years.get(meeting.year)!
    data.meetings.push(meeting)
    data.count++
  }

  // Calculate committee breakdown for each year
  for (const [_year, data] of years) {
    const breakdown = new Map<string, number>()
    for (const meeting of data.meetings) {
      breakdown.set(meeting.committee, (breakdown.get(meeting.committee) || 0) + 1)
    }
    data.committeeBreakdown = Array.from(breakdown.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }

  return years
}

// Group meetings by councillor (using verified councillor data)
function groupByCouncillor(meetings: Meeting[]): Map<string, CouncillorData> {
  const councillors = new Map<string, CouncillorData>()

  for (const meeting of meetings) {
    for (const canonicalName of meeting.councillors) {
      // Only process verified councillors
      const verifiedInfo = VERIFIED_COUNCILLORS[canonicalName]
      if (!verifiedInfo) continue

      const slug = verifiedInfo.slug
      if (!councillors.has(slug)) {
        councillors.set(slug, {
          name: verifiedInfo.displayName,
          slug,
          meetings: [],
          count: 0,
          committees: [],
          yearsActive: [],
        })
      }
      const data = councillors.get(slug)!
      data.meetings.push(meeting)
      data.count++

      if (!data.committees.some(c => c.slug === meeting.committeeSlug)) {
        data.committees.push({ name: meeting.committee, slug: meeting.committeeSlug })
      }
      if (!data.yearsActive.includes(meeting.year)) {
        data.yearsActive.push(meeting.year)
      }
    }
  }

  // Sort years for each councillor
  for (const data of councillors.values()) {
    data.yearsActive.sort((a, b) => a - b) // Ascending order for display
  }

  return councillors
}

// Note: getCouncillorTerms and isCurrentCouncillor are imported from lib/councillors

// Default questions for chat prefill
const DEFAULT_QUESTIONS = [
  "What were the key decisions?",
  "What topics were discussed most?",
  "What were the major votes?",
]

// Generate committee page markdown
function generateCommitteePage(data: CommitteeData): string {
  const recentMeetings = data.meetings.slice(0, 10)
  const meetingsList = recentMeetings
    .map(m => `- [${m.title}](</${m.slug}>) - ${formatMeetingDate(m.date)}`)
    .join("\n")

  return `---
title: "${data.name}"
type: committee
slug: "${data.slug}"
meetingCount: ${data.count}
prefillQuestions:
${DEFAULT_QUESTIONS.map(q => `  - "${q}"`).join("\n")}
---

## Recent Meetings

${meetingsList}

${data.count > 10 ? `\n[View all ${data.count} meetings →](#)\n` : ""}
`
}

// Generate year page markdown
function generateYearPage(data: YearData): string {
  const breakdown = data.committeeBreakdown
    .map(c => `| ${c.name} | ${c.count} |`)
    .join("\n")

  const recentMeetings = data.meetings.slice(0, 10)
  const meetingsList = recentMeetings
    .map(m => `- [${m.title}](</${m.slug}>) - ${formatMeetingDate(m.date)}`)
    .join("\n")

  return `---
title: "${data.year}"
type: year
meetingCount: ${data.count}
prefillQuestions:
${DEFAULT_QUESTIONS.map(q => `  - "${q}"`).join("\n")}
---

## Meetings by Committee

| Committee | Meetings |
|-----------|----------|
${breakdown}

## Recent Meetings from ${data.year}

${meetingsList}
`
}

// Generate councillor page markdown with verified term data
function generateCouncillorPage(
  data: CouncillorData,
  canonicalName: string,
  voteStats: VoteStats | null,
  stats: CouncillorStatsData | null
): string {
  const committees = data.committees.map(c => `- [${c.name}](/committees/${c.slug})`).join("\n")

  // Get verified term information
  const verifiedInfo = VERIFIED_COUNCILLORS[canonicalName]
  const terms = verifiedInfo?.terms || []

  // Generate term list
  const termsList = terms.map(t => {
    const ward = t.ward ? ` (Ward ${t.ward})` : ""
    return `- ${t.start}-${t.end}: ${t.role}${ward}`
  }).join("\n")

  // Calculate actual service years from verified terms
  const yearsRange = terms.length > 0
    ? `${Math.min(...terms.map(t => t.start))} - ${Math.max(...terms.map(t => t.end))}`
    : "Unknown"

  const isCurrent = terms.some(t => t.end >= 2026)

  const recentMeetings = data.meetings.slice(0, 10)
  const meetingsList = recentMeetings
    .map(m => `- [${m.title}](</${m.slug}>) - ${formatMeetingDate(m.date)}`)
    .join("\n")

  // Vote stats frontmatter
  const votesFrontmatter = voteStats ? `
totalVotes: ${voteStats.totalVotes}
votesYea: ${voteStats.yeas}
votesNay: ${voteStats.nays}
votesAbsent: ${voteStats.absent}` : ""

  // Stats frontmatter
  const contestedDissentFrontmatter = stats?.voting.contestedDissentRate !== undefined
    ? `\ncontestedDissentRate: ${stats.voting.contestedDissentRate.toFixed(1)}
contestedVotes: ${stats.voting.contestedVotes}`
    : ""
  const statsFrontmatter = stats ? `
attendanceRate: ${stats.attendance.attendanceRate.toFixed(1)}
participationRate: ${stats.voting.participationRate.toFixed(1)}
yeaRate: ${stats.voting.yeaRate.toFixed(1)}${contestedDissentFrontmatter}` : ""

  // Voting record section - show both total and substantive votes
  const hasSubstantiveData = stats?.voting.substantiveVotes !== undefined && stats.voting.substantiveVotes > 0
  const substantiveSection = hasSubstantiveData ? `
### Substantive Votes

*Excludes procedural motions (minutes approval, adjournment, "be received", etc.)*

| Statistic | Count |
|-----------|-------|
| Substantive Votes | ${stats!.voting.substantiveVotes!.toLocaleString()} |
| Voted Yea | ${stats!.voting.substantiveYeas!.toLocaleString()} (${stats!.voting.substantiveYeaRate!.toFixed(1)}%) |
| Voted Nay | ${stats!.voting.substantiveNays!.toLocaleString()} (${(100 - stats!.voting.substantiveYeaRate!).toFixed(1)}%) |

` : ""

  // Contested dissent rate section
  const hasContestedData = stats?.voting.contestedVotes !== undefined && stats.voting.contestedVotes > 0
  const contestedDissentSection = hasContestedData ? `
### Dissent on Contested Votes

*Only counts non-unanimous votes where the councillor participated*

- **Dissent Rate**: ${stats!.voting.contestedDissentRate!.toFixed(1)}%
- **Contested Votes**: ${stats!.voting.contestedVotes!.toLocaleString()}

*Dissent = voting against the final outcome (e.g., voting "nay" on a motion that passed)*

` : ""

  // Budget voting section
  const hasBudgetData = stats?.budgetVoting && stats.budgetVoting.totalBudgetVotes > 0
  const budgetParticipated = hasBudgetData ? stats!.budgetVoting!.budgetYeas + stats!.budgetVoting!.budgetNays : 0
  const budgetVotingSection = hasBudgetData ? `
### Budget Votes

*Votes on budget-related items (budget committee meetings, tax, levy, fiscal, appropriation, expenditure)*

| Statistic | Count |
|-----------|-------|
| Budget Votes | ${stats!.budgetVoting!.totalBudgetVotes.toLocaleString()} |
| Voted Yea | ${stats!.budgetVoting!.budgetYeas.toLocaleString()} (${budgetParticipated > 0 ? ((stats!.budgetVoting!.budgetYeas / budgetParticipated) * 100).toFixed(1) : 0}%) |
| Voted Nay | ${stats!.budgetVoting!.budgetNays.toLocaleString()} (${budgetParticipated > 0 ? ((stats!.budgetVoting!.budgetNays / budgetParticipated) * 100).toFixed(1) : 0}%) |
| Absent | ${stats!.budgetVoting!.budgetAbsent.toLocaleString()} |

` : ""

  const votingSection = voteStats ? `
## Voting Record

### All Votes

| Statistic | Count |
|-----------|-------|
| Total Votes | ${voteStats.totalVotes.toLocaleString()} |
| Voted Yea | ${voteStats.yeas.toLocaleString()} (${((voteStats.yeas / voteStats.totalVotes) * 100).toFixed(1)}%) |
| Voted Nay | ${voteStats.nays.toLocaleString()} (${((voteStats.nays / voteStats.totalVotes) * 100).toFixed(1)}%) |
| Absent | ${voteStats.absent.toLocaleString()} (${((voteStats.absent / voteStats.totalVotes) * 100).toFixed(1)}%) |

${substantiveSection}${contestedDissentSection}${budgetVotingSection}` : ""

  // Attendance section with trend
  const getTrendIndicator = (direction: string | undefined): string => {
    switch (direction) {
      case "improving": return "Improving ^"
      case "declining": return "Declining v"
      case "stable": return "Stable -"
      default: return ""
    }
  }

  const getTrendBreakdown = (trend: AttendancePeriod[] | undefined): string => {
    if (!trend || trend.length === 0) return ""
    // Show last 4 years for brevity
    const recentYears = trend.slice(-4)
    const breakdown = recentYears
      .map(t => `  - ${t.period}: ${t.attendanceRate.toFixed(1)}% (${t.meetingsAttended}/${t.meetingsTotal} meetings)`)
      .join("\n")
    return `\n**Attendance by Year:**\n${breakdown}\n`
  }

  const trendIndicator = stats?.attendance.trendDirection && stats.attendance.trendDirection !== "insufficient_data"
    ? `\n- **Trend**: ${getTrendIndicator(stats.attendance.trendDirection)}`
    : ""

  const trendBreakdown = getTrendBreakdown(stats?.attendance.trend)

  const attendanceSection = stats && stats.attendance.totalMeetings > 0 ? `
## Attendance

- **Attendance Rate**: ${stats.attendance.attendanceRate.toFixed(1)}%
- **Meetings Attended**: ${stats.attendance.present.toLocaleString()} of ${stats.attendance.totalMeetings.toLocaleString()}
- **Meetings Missed**: ${stats.attendance.absent.toLocaleString()}${trendIndicator}
${trendBreakdown}
` : ""

  // Voting alignment section
  const alignmentSection = stats && stats.topAlignments.length > 0 ? `
## Voting Alignment

**Most aligned with:**
${stats.topAlignments.slice(0, 3).map(a => `- ${a.councillor} (${a.alignmentRate.toFixed(1)}%)`).join("\n")}

**Least aligned with:**
${stats.bottomAlignments.slice(0, 3).map(a => `- ${a.councillor} (${a.alignmentRate.toFixed(1)}%)`).join("\n")}

[View full voting alignment →](/councillors/alignment)

` : ""

  // Committee activity breakdown section
  const committeeActivitySection = stats && stats.committeeActivity && stats.committeeActivity.length > 0 ? `
## Committee Activity Breakdown

| Committee | Votes | Yea | Nay | Participation |
|-----------|------:|----:|----:|--------------:|
${stats.committeeActivity.map(c =>
  `| ${c.committee} | ${c.totalVotes.toLocaleString()} | ${c.yeas.toLocaleString()} | ${c.nays.toLocaleString()} | ${c.participationRate.toFixed(1)}% |`
).join("\n")}

` : ""

  // Notable Dissenting Votes section - shows votes where councillor was in the minority on split decisions
  const notableDissentsSection = stats && stats.notableDissents && stats.notableDissents.length > 0 ? `
## Notable Dissenting Votes

*Recent split votes where ${data.name} voted against the final outcome:*

${stats.notableDissents.map(d => {
  const meetingLink = d.meetingUrl ? `[${d.meetingTitle}](${d.meetingUrl})` : d.meetingTitle
  const voteLabel = d.vote === "nay" ? "Voted **Nay**" : "Voted **Yea**"
  return `### ${d.date}: ${d.itemTitle}

${meetingLink}

> ${d.motionText}

${voteLabel} - ${d.result}
`
}).join("\n")}
` : ""

  return `---
title: "${data.name}"
type: councillor
slug: "${data.slug}"
meetingCount: ${data.count}
yearsActive: "${yearsRange}"
isCurrent: ${isCurrent}${votesFrontmatter}${statsFrontmatter}
prefillQuestions:
${DEFAULT_QUESTIONS.map(q => `  - "${q}"`).join("\n")}
---

## Terms of Service

${termsList}
${votingSection}${attendanceSection}${alignmentSection}${committeeActivitySection}${notableDissentsSection}
## Committees Served

${committees}

## Recent Meetings (${data.count} total)

${meetingsList}
`
}

// Generate councillors index page with current/former organization
function generateCouncillorsIndexPage(councillors: Map<string, CouncillorData>): string {
  const all = Array.from(councillors.values())
    .sort((a, b) => b.count - a.count)

  // Separate current and former councillors
  const current: CouncillorData[] = []
  const former: CouncillorData[] = []

  for (const c of all) {
    // Find canonical name for this councillor
    const canonicalName = Object.keys(VERIFIED_COUNCILLORS).find(
      key => VERIFIED_COUNCILLORS[key].slug === c.slug
    )
    if (canonicalName && isCurrentCouncillor(canonicalName)) {
      current.push(c)
    } else {
      former.push(c)
    }
  }

  const currentList = current
    .map(c => `- [${c.name}](/councillors/current/${c.slug}) - ${c.count} meetings`)
    .join("\n")

  const formerList = former
    .map(c => `- [${c.name}](/councillors/former/${c.slug}) - ${c.count} meetings`)
    .join("\n")

  return `---
title: "Councillors"
type: councillor-index
---

Browse London City Council members by their meeting attendance and voting records.

**[View Voting Alignment Matrix](/councillors/alignment)** - See which councillors vote together most often

## Current Council (2022-2026)

${currentList}

## Former Councillors

${formerList}
`
}

// Main function
async function main() {
  console.log("🏛️ Open Council Page Generator\n")

  const contentDir = path.join(process.cwd(), "content")

  // Step 1: Scan meetings
  console.log("\n📁 Scanning meetings...")
  const meetings = await scanMeetings(contentDir)
  console.log(`   Found ${meetings.length} meetings`)

  // Step 2: Group data
  console.log("\n📊 Grouping data...")
  const committees = groupByCommittee(meetings)
  const years = groupByYear(meetings)
  const councillors = groupByCouncillor(meetings)

  console.log(`   ${committees.size} committees`)
  console.log(`   ${years.size} years`)
  console.log(`   ${councillors.size} councillors`)

  // Step 3: Create output directories
  const committeesDir = path.join(contentDir, "committees")
  const yearsDir = path.join(contentDir, "years")
  const councillorsDir = path.join(contentDir, "councillors")

  await fs.mkdir(committeesDir, { recursive: true })
  await fs.mkdir(yearsDir, { recursive: true })
  await fs.mkdir(councillorsDir, { recursive: true })

  // Step 4: Generate committee pages
  console.log("\n📝 Generating committee pages...")
  for (const [slug, data] of committees) {
    const content = generateCommitteePage(data)
    const filePath = path.join(committeesDir, `${slug}.md`)
    await fs.writeFile(filePath, content)
    console.log(`   ✓ ${data.name}`)
  }

  // Step 5: Generate year pages
  console.log("\n📝 Generating year pages...")
  for (const [year, data] of years) {
    const content = generateYearPage(data)
    const filePath = path.join(yearsDir, `${year}.md`)
    await fs.writeFile(filePath, content)
    console.log(`   ✓ ${year}`)
  }

  // Step 6: Generate councillor pages
  console.log("\n📝 Generating councillor pages...")

  // Create current and former subdirectories
  const currentDir = path.join(councillorsDir, "current")
  const formerDir = path.join(councillorsDir, "former")
  await fs.mkdir(currentDir, { recursive: true })
  await fs.mkdir(formerDir, { recursive: true })

  // Generate index page
  const indexContent = generateCouncillorsIndexPage(councillors)
  await fs.writeFile(path.join(councillorsDir, "index.md"), indexContent)
  console.log("   ✓ Councillors index")

  // Generate individual pages for ALL verified councillors
  const allCouncillors = Array.from(councillors.values())
    .sort((a, b) => b.count - a.count)

  let currentCount = 0
  let formerCount = 0

  for (const data of allCouncillors) {
    // Find canonical name for this councillor
    const canonicalName = Object.keys(VERIFIED_COUNCILLORS).find(
      key => VERIFIED_COUNCILLORS[key].slug === data.slug
    )

    if (!canonicalName) continue

    const isCurrent = isCurrentCouncillor(canonicalName)
    const targetDir = isCurrent ? currentDir : formerDir

    const voteStats = await loadVoteStats(data.slug)
    const stats = await loadCouncillorStats(data.slug)
    const content = generateCouncillorPage(data, canonicalName, voteStats, stats)
    const filePath = path.join(targetDir, `${data.slug}.md`)
    await fs.writeFile(filePath, content)

    if (isCurrent) {
      currentCount++
      console.log(`   ✓ ${data.name} (current)`)
    } else {
      formerCount++
      console.log(`   ✓ ${data.name} (former)`)
    }
  }

  console.log("\n✅ Generation complete!")
  console.log(`   Committee pages: ${committees.size}`)
  console.log(`   Year pages: ${years.size}`)
  console.log(`   Councillor pages: ${currentCount} current, ${formerCount} former`)
}

main().catch(console.error)
