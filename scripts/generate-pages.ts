/**
 * Generate summary pages for committees, years, and councillors
 *
 * This script scans all meeting content, extracts metadata, and generates
 * AI-powered summary pages for browsing.
 *
 * Usage: npx tsx scripts/generate-pages.ts
 *
 * Environment variables:
 * - ANTHROPIC_API_KEY: Required for AI summaries
 * - SKIP_AI: Set to "true" to skip AI generation (for testing)
 */

import fs from "fs/promises"
import path from "path"
import Anthropic from "@anthropic-ai/sdk"
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
  for (const [year, data] of years) {
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

// Generate AI summary using Anthropic
async function generateSummary(
  anthropic: Anthropic | null,
  type: "committee" | "year" | "councillor",
  data: CommitteeData | YearData | CouncillorData,
  skipAI: boolean
): Promise<{ summary: string; questions: string[] }> {
  if (skipAI || !anthropic) {
    return {
      summary: `Summary for ${type} will be generated when ANTHROPIC_API_KEY is provided.`,
      questions: [
        `What were the key decisions?`,
        `What topics were discussed most?`,
        `What were the major votes?`,
      ],
    }
  }

  let prompt = ""

  if (type === "committee") {
    const d = data as CommitteeData
    const recentMeetings = d.meetings.slice(0, 20).map(m => m.title).join("\n- ")
    prompt = `You are summarizing the work of the "${d.name}" of London City Council, Canada.

This committee has held ${d.count} meetings. Recent meetings include:
- ${recentMeetings}

Write a 2-3 paragraph summary of what this committee typically handles, its role in city governance, and the types of issues it addresses. Be factual and informative.

Then provide 3 contextual questions a citizen might want to ask about this committee's work.

Format your response as:
SUMMARY:
[Your summary here]

QUESTIONS:
1. [Question 1]
2. [Question 2]
3. [Question 3]`
  } else if (type === "year") {
    const d = data as YearData
    const breakdown = d.committeeBreakdown.map(c => `${c.name}: ${c.count} meetings`).join("\n- ")
    prompt = `You are summarizing London City Council's work in ${d.year}.

There were ${d.count} total meetings across committees:
- ${breakdown}

Write a 2-3 paragraph summary of what a typical year of council work looks like, mentioning the types of decisions councils make (budgets, zoning, infrastructure, etc.).

Then provide 3 contextual questions about this year's council work.

Format your response as:
SUMMARY:
[Your summary here]

QUESTIONS:
1. [Question 1]
2. [Question 2]
3. [Question 3]`
  } else {
    const d = data as CouncillorData
    const committees = d.committees.join(", ")
    const years = d.yearsActive.length > 3
      ? `${Math.min(...d.yearsActive)}-${Math.max(...d.yearsActive)}`
      : d.yearsActive.join(", ")
    prompt = `You are summarizing the council participation of ${d.name} on London City Council, Canada.

They have attended ${d.count} meetings.
Committees served on: ${committees}
Years active: ${years}

Write a 1-2 paragraph factual summary of their council participation based on this data. Do not make up information about their policies or positions - just describe their participation.

Then provide 3 questions someone might ask about their voting record or participation.

Format your response as:
SUMMARY:
[Your summary here]

QUESTIONS:
1. [Question 1]
2. [Question 2]
3. [Question 3]`
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    })

    const text = response.content[0].type === "text" ? response.content[0].text : ""

    // Parse response
    const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?=QUESTIONS:|$)/i)
    const questionsMatch = text.match(/QUESTIONS:\s*([\s\S]*)/i)

    const summary = summaryMatch ? summaryMatch[1].trim() : text
    const questions: string[] = []

    if (questionsMatch) {
      const qText = questionsMatch[1]
      const qMatches = qText.matchAll(/\d+\.\s*(.+)/g)
      for (const m of qMatches) {
        questions.push(m[1].trim())
      }
    }

    return { summary, questions: questions.length > 0 ? questions : [
      "What were the key decisions?",
      "What topics were discussed most?",
      "What were the major votes?",
    ]}
  } catch (error) {
    console.error(`Error generating summary for ${type}:`, error)
    return {
      summary: `Summary generation failed. Please try again later.`,
      questions: [
        "What were the key decisions?",
        "What topics were discussed most?",
        "What were the major votes?",
      ],
    }
  }
}

// Generate committee page markdown
function generateCommitteePage(
  data: CommitteeData,
  summary: string,
  questions: string[]
): string {
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
${questions.map(q => `  - "${q}"`).join("\n")}
---

${summary}

## Recent Meetings

${meetingsList}

${data.count > 10 ? `\n[View all ${data.count} meetings →](#)\n` : ""}
`
}

// Generate year page markdown
function generateYearPage(
  data: YearData,
  summary: string,
  questions: string[]
): string {
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
${questions.map(q => `  - "${q}"`).join("\n")}
---

${summary}

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
  summary: string,
  questions: string[],
  canonicalName: string,
  voteStats: VoteStats | null
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

  // Vote stats frontmatter and section
  const votesFrontmatter = voteStats ? `
totalVotes: ${voteStats.totalVotes}
votesYea: ${voteStats.yeas}
votesNay: ${voteStats.nays}
votesAbsent: ${voteStats.absent}` : ""

  const votingSection = voteStats ? `
## Voting Record

| Statistic | Count |
|-----------|-------|
| Total Votes | ${voteStats.totalVotes.toLocaleString()} |
| Voted Yea | ${voteStats.yeas.toLocaleString()} (${((voteStats.yeas / voteStats.totalVotes) * 100).toFixed(1)}%) |
| Voted Nay | ${voteStats.nays.toLocaleString()} (${((voteStats.nays / voteStats.totalVotes) * 100).toFixed(1)}%) |
| Absent | ${voteStats.absent.toLocaleString()} (${((voteStats.absent / voteStats.totalVotes) * 100).toFixed(1)}%) |

` : ""

  return `---
title: "${data.name}"
type: councillor
slug: "${data.slug}"
meetingCount: ${data.count}
yearsActive: "${yearsRange}"
isCurrent: ${isCurrent}${votesFrontmatter}
prefillQuestions:
${questions.map(q => `  - "${q}"`).join("\n")}
---

${summary}

## Terms of Service

${termsList}
${votingSection}
## Committees Served

${committees}

## Meeting Attendance (${data.count} meetings)

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
  const skipAI = process.env.SKIP_AI === "true"

  // Initialize Anthropic client if API key is available
  let anthropic: Anthropic | null = null
  if (process.env.ANTHROPIC_API_KEY && !skipAI) {
    anthropic = new Anthropic()
    console.log("✓ Anthropic API key found, will generate AI summaries")
  } else {
    console.log("⚠ No ANTHROPIC_API_KEY found or SKIP_AI=true, using placeholder summaries")
  }

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
    const { summary, questions } = await generateSummary(anthropic, "committee", data, skipAI)
    const content = generateCommitteePage(data, summary, questions)
    const filePath = path.join(committeesDir, `${slug}.md`)
    await fs.writeFile(filePath, content)
    console.log(`   ✓ ${data.name}`)
  }

  // Step 5: Generate year pages
  console.log("\n📝 Generating year pages...")
  for (const [year, data] of years) {
    const { summary, questions } = await generateSummary(anthropic, "year", data, skipAI)
    const content = generateYearPage(data, summary, questions)
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

    const { summary, questions } = await generateSummary(anthropic, "councillor", data, skipAI)
    const voteStats = await loadVoteStats(data.slug)
    const content = generateCouncillorPage(data, summary, questions, canonicalName, voteStats)
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
