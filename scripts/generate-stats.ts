/**
 * Generate councillor statistics: attendance, voting alignment, scorecards
 *
 * Phase 3 of Issue #114: Statistics & Analysis
 *
 * Usage: npx tsx scripts/generate-stats.ts
 */

import fs from "fs/promises"
import path from "path"
import {
  loadRegistry,
  getSlug,
  normalizeCouncillorName,
} from "../lib/councillors/index.js"

// Types
interface Meeting {
  title: string
  datetime: string
  meeting_type: string
  present?: string[]
  absent?: string[]
  remote_attendance?: string[]
}

interface VoteRecord {
  date: string
  meetingSlug: string
  meetingTitle: string
  meetingType: string
  meetingUrl?: string
  itemNumber: string
  itemTitle: string
  motionText?: string
  vote: "yea" | "nay" | "absent"
  result: string
  passed: boolean
  unanimous: boolean
}

// Check if a motion is procedural (routine/administrative) vs substantive
function isProcedural(motionText: string | undefined): boolean {
  if (!motionText) return false
  const text = motionText.toLowerCase()
  return (
    /be received/i.test(text) ||
    /be noted/i.test(text) ||
    /minutes.*be approved/i.test(text) ||
    /be adjourned/i.test(text) ||
    /closed session/i.test(text) ||
    /public participation meeting/i.test(text) ||
    /first reading|second reading|third reading/i.test(text) ||
    /consent items/i.test(text)
  )
}

// Check if a vote is budget-related based on meetingType, itemTitle, or motionText
// Budget keywords: "budget", "tax", "levy", "fiscal", "appropriation", "expenditure"
function isBudgetRelated(vote: VoteRecord): boolean {
  const budgetKeywords = /budget|tax|levy|fiscal|appropriation|expenditure/i

  // Check if meetingType contains "Budget"
  if (vote.meetingType && /budget/i.test(vote.meetingType)) {
    return true
  }

  // Check if itemTitle contains budget-related keywords
  if (vote.itemTitle && budgetKeywords.test(vote.itemTitle)) {
    return true
  }

  // Check if motionText contains budget-related keywords
  if (vote.motionText && budgetKeywords.test(vote.motionText)) {
    return true
  }

  return false
}

interface BudgetVotingStats {
  totalBudgetVotes: number
  budgetYeas: number
  budgetNays: number
  budgetAbsent: number
}

// Committee activity breakdown for a councillor
interface CommitteeActivity {
  committee: string
  totalVotes: number
  yeas: number
  nays: number
  participationRate: number
}

interface CouncillorVotesFile {
  councillor: string
  slug: string
  votes: VoteRecord[]
}

interface AttendancePeriod {
  period: string  // e.g., "2023" or "2023-Q1"
  attendanceRate: number
  meetingsAttended: number
  meetingsTotal: number
}

interface AttendanceStats {
  totalMeetings: number
  present: number
  absent: number
  remote: number
  attendanceRate: number
  trend: AttendancePeriod[]
  trendDirection: "improving" | "declining" | "stable" | "insufficient_data"
}

interface AlignmentPair {
  councillor: string  // The "other" councillor in the pair
  sharedVotes: number
  agreedVotes: number
  alignmentRate: number
}

// Notable dissenting vote (councillor was in the minority on a split decision)
interface NotableDissent {
  date: string
  meetingTitle: string
  itemTitle: string
  motionText: string // truncated
  vote: "yea" | "nay"
  result: string
  meetingUrl?: string
}

// Internal type for raw alignment data between two councillors
interface RawAlignmentPair {
  councillor1: string
  councillor2: string
  sharedVotes: number
  agreedVotes: number
  alignmentRate: number
}

interface CouncillorStats {
  councillor: string
  slug: string
  attendance: AttendanceStats
  voting: {
    totalVotes: number
    yeas: number
    nays: number
    absent: number
    participationRate: number
    yeaRate: number
    contestedDissentRate: number // % of contested (non-unanimous) votes where councillor voted against final outcome
    contestedVotes: number // Number of contested votes the councillor participated in
    // Substantive votes (excludes procedural motions)
    substantiveVotes: number
    substantiveYeas: number
    substantiveNays: number
    substantiveParticipationRate: number
    substantiveYeaRate: number
  }
  budgetVoting: BudgetVotingStats
  topAlignments: AlignmentPair[]
  bottomAlignments: AlignmentPair[]
  notableDissents: NotableDissent[]
  committeeActivity: CommitteeActivity[]
}

interface StatsOutput {
  generatedAt: string
  councillorStats: Record<string, CouncillorStats>
  alignmentMatrix: Record<string, Record<string, number>>
}

// Get councillor's active date range based on terms
function getActiveRange(
  canonicalName: string,
  registry: ReturnType<typeof loadRegistry>
): { start: Date; end: Date } | null {
  const info = registry[canonicalName]
  if (!info || !info.terms || info.terms.length === 0) return null

  const startYear = Math.min(...info.terms.map((t) => t.start))
  const endYear = Math.max(...info.terms.map((t) => t.end))

  return {
    start: new Date(`${startYear}-01-01`),
    end: new Date(`${endYear}-12-31`),
  }
}

// Check if a councillor was active during a meeting date
function wasActiveOnDate(
  canonicalName: string,
  meetingDate: Date,
  registry: ReturnType<typeof loadRegistry>
): boolean {
  const range = getActiveRange(canonicalName, registry)
  if (!range) return false
  return meetingDate >= range.start && meetingDate <= range.end
}

// Normalize attendee name from meeting data
function normalizeAttendeeName(name: string): string | null {
  // Remove remote attendance timestamps like "(at 1:16 PM)"
  let cleaned = name.replace(/\s*\(at\s+[\d:]+\s*[AP]M\)/i, "").trim()
  return normalizeCouncillorName(cleaned)
}

// Check if a councillor is on the current council term (2022-2026)
function isCurrentCouncillor(
  canonicalName: string,
  registry: ReturnType<typeof loadRegistry>
): boolean {
  const info = registry[canonicalName]
  if (!info || !info.terms || info.terms.length === 0) return false
  // Current term is 2022-2026
  return info.terms.some((t) => t.start <= 2022 && t.end >= 2026)
}

async function main() {
  console.log("📊 Councillor Statistics Generator\n")

  const dataDir = path.join(process.cwd(), "data")
  const votesDir = path.join(dataDir, "votes")
  const outputDir = path.join(dataDir, "stats")
  const registry = loadRegistry()

  await fs.mkdir(outputDir, { recursive: true })

  // Initialize stats for all councillors
  const councillorStats: Record<string, CouncillorStats> = {}
  const councillorAttendance: Record<
    string,
    { present: number; absent: number; remote: number; total: number }
  > = {}

  for (const canonicalName of Object.keys(registry)) {
    const slug = getSlug(canonicalName)
    councillorStats[slug] = {
      councillor: registry[canonicalName].displayName,
      slug,
      attendance: {
        totalMeetings: 0,
        present: 0,
        absent: 0,
        remote: 0,
        attendanceRate: 0,
        trend: [],
        trendDirection: "insufficient_data",
      },
      voting: {
        totalVotes: 0,
        yeas: 0,
        nays: 0,
        absent: 0,
        participationRate: 0,
        yeaRate: 0,
        contestedDissentRate: 0,
        contestedVotes: 0,
        substantiveVotes: 0,
        substantiveYeas: 0,
        substantiveNays: 0,
        substantiveParticipationRate: 0,
        substantiveYeaRate: 0,
      },
      budgetVoting: {
        totalBudgetVotes: 0,
        budgetYeas: 0,
        budgetNays: 0,
        budgetAbsent: 0,
      },
      topAlignments: [],
      bottomAlignments: [],
      notableDissents: [],
      committeeActivity: [],
    }
    councillorAttendance[slug] = { present: 0, absent: 0, remote: 0, total: 0 }
  }

  // Track attendance by year for trend calculation
  const councillorAttendanceByYear: Record<
    string,
    Record<string, { present: number; total: number }>
  > = {}

  // ============================================
  // PART 1: Calculate Attendance Statistics
  // ============================================
  console.log("📁 Calculating attendance statistics...")

  const entries = await fs.readdir(dataDir, { withFileTypes: true })
  const monthDirs = entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}/.test(e.name))
    .map((e) => e.name)
    .sort()

  let totalMeetings = 0

  for (const monthDir of monthDirs) {
    const monthPath = path.join(dataDir, monthDir)
    const files = await fs.readdir(monthPath)
    const jsonFiles = files.filter((f) => f.endsWith(".json"))

    for (const file of jsonFiles) {
      const filePath = path.join(monthPath, file)

      try {
        const content = await fs.readFile(filePath, "utf-8")
        const meeting: Meeting = JSON.parse(content)

        if (!meeting.present && !meeting.absent) continue

        // Parse meeting date
        const meetingDate = new Date(meeting.datetime.split(" ")[0])
        totalMeetings++

        // Track who was present
        const presentSet = new Set<string>()
        const remoteSet = new Set<string>()

        if (meeting.present) {
          for (const name of meeting.present) {
            const canonical = normalizeAttendeeName(name)
            if (canonical && registry[canonical]) {
              presentSet.add(getSlug(canonical))
            }
          }
        }

        if (meeting.remote_attendance) {
          for (const name of meeting.remote_attendance) {
            const canonical = normalizeAttendeeName(name)
            if (canonical && registry[canonical]) {
              remoteSet.add(getSlug(canonical))
            }
          }
        }

        // For each councillor active during this meeting, update attendance
        const meetingYear = meetingDate.getFullYear().toString()

        for (const canonicalName of Object.keys(registry)) {
          if (!wasActiveOnDate(canonicalName, meetingDate, registry)) continue

          const slug = getSlug(canonicalName)
          councillorAttendance[slug].total++

          // Initialize year tracking for this councillor if needed
          if (!councillorAttendanceByYear[slug]) {
            councillorAttendanceByYear[slug] = {}
          }
          if (!councillorAttendanceByYear[slug][meetingYear]) {
            councillorAttendanceByYear[slug][meetingYear] = { present: 0, total: 0 }
          }
          councillorAttendanceByYear[slug][meetingYear].total++

          if (presentSet.has(slug)) {
            councillorAttendance[slug].present++
            councillorAttendanceByYear[slug][meetingYear].present++
            if (remoteSet.has(slug)) {
              councillorAttendance[slug].remote++
            }
          } else if (meeting.absent?.some((n) => normalizeAttendeeName(n) === canonicalName)) {
            councillorAttendance[slug].absent++
          } else {
            // Not explicitly listed as present or absent - might be absent
            councillorAttendance[slug].absent++
          }
        }
      } catch {
        continue
      }
    }
  }

  // Update attendance stats with trend data
  for (const slug of Object.keys(councillorAttendance)) {
    const att = councillorAttendance[slug]
    const yearData = councillorAttendanceByYear[slug] || {}

    // Build trend data sorted by year
    const trend: AttendancePeriod[] = Object.keys(yearData)
      .sort()
      .map((year) => {
        const data = yearData[year]
        return {
          period: year,
          attendanceRate: data.total > 0 ? (data.present / data.total) * 100 : 0,
          meetingsAttended: data.present,
          meetingsTotal: data.total,
        }
      })

    // Calculate trend direction based on recent years
    // Need at least 2 years of data to determine a trend
    let trendDirection: "improving" | "declining" | "stable" | "insufficient_data" =
      "insufficient_data"

    if (trend.length >= 2) {
      // Compare the most recent year to the average of previous years
      const recentYear = trend[trend.length - 1]
      const previousYears = trend.slice(0, -1)

      // Only consider years with at least 5 meetings for reliable comparison
      const validPreviousYears = previousYears.filter((y) => y.meetingsTotal >= 5)

      if (validPreviousYears.length >= 1 && recentYear.meetingsTotal >= 5) {
        const previousAvg =
          validPreviousYears.reduce((sum, y) => sum + y.attendanceRate, 0) /
          validPreviousYears.length

        const diff = recentYear.attendanceRate - previousAvg

        // Use 5 percentage points as the threshold for meaningful change
        if (diff >= 5) {
          trendDirection = "improving"
        } else if (diff <= -5) {
          trendDirection = "declining"
        } else {
          trendDirection = "stable"
        }
      }
    }

    councillorStats[slug].attendance = {
      totalMeetings: att.total,
      present: att.present,
      absent: att.absent,
      remote: att.remote,
      attendanceRate: att.total > 0 ? (att.present / att.total) * 100 : 0,
      trend,
      trendDirection,
    }
  }

  console.log(`   Processed ${totalMeetings} meetings`)

  // ============================================
  // PART 2: Load Voting Data and Calculate Voting Stats
  // ============================================
  console.log("\n🗳️ Loading voting data...")

  // Map: motionKey -> councillorSlug -> vote
  const motionVotes: Map<string, Map<string, "yea" | "nay" | "absent">> =
    new Map()

  const voteFiles = await fs.readdir(votesDir)
  for (const file of voteFiles) {
    if (file === "_meta.json" || !file.endsWith(".json")) continue

    const filePath = path.join(votesDir, file)
    const content = await fs.readFile(filePath, "utf-8")
    const data: CouncillorVotesFile = JSON.parse(content)

    const slug = data.slug

    // Update voting stats (all votes)
    const yeas = data.votes.filter((v) => v.vote === "yea").length
    const nays = data.votes.filter((v) => v.vote === "nay").length
    const absent = data.votes.filter((v) => v.vote === "absent").length
    const total = data.votes.length
    const participated = yeas + nays

    // Calculate substantive votes (excluding procedural motions)
    const substantiveVotes = data.votes.filter((v) => !isProcedural(v.motionText))
    const substantiveYeas = substantiveVotes.filter((v) => v.vote === "yea").length
    const substantiveNays = substantiveVotes.filter((v) => v.vote === "nay").length
    const substantiveTotal = substantiveVotes.length
    const substantiveParticipated = substantiveYeas + substantiveNays

    // Calculate contested dissent rate:
    // Only count non-unanimous votes where councillor participated
    // Dissent = voted against final outcome (nay on passed OR yea on failed)
    const contestedVotes = data.votes.filter(
      (v) => v.unanimous === false && v.vote !== "absent"
    )
    const dissentingVotes = contestedVotes.filter((v) => {
      // Dissent means voting against the final outcome
      if (v.passed && v.vote === "nay") return true // Voted nay but it passed
      if (!v.passed && v.vote === "yea") return true // Voted yea but it failed
      return false
    })
    const contestedDissentRate =
      contestedVotes.length > 0
        ? (dissentingVotes.length / contestedVotes.length) * 100
        : 0

    councillorStats[slug].voting = {
      totalVotes: total,
      yeas,
      nays,
      absent,
      participationRate: total > 0 ? (participated / total) * 100 : 0,
      yeaRate: participated > 0 ? (yeas / participated) * 100 : 0,
      contestedDissentRate,
      contestedVotes: contestedVotes.length,
      substantiveVotes: substantiveTotal,
      substantiveYeas,
      substantiveNays,
      substantiveParticipationRate: substantiveTotal > 0 ? (substantiveParticipated / substantiveTotal) * 100 : 0,
      substantiveYeaRate: substantiveParticipated > 0 ? (substantiveYeas / substantiveParticipated) * 100 : 0,
    }

    // Calculate budget voting stats
    const budgetVotes = data.votes.filter((v) => isBudgetRelated(v))
    const budgetYeas = budgetVotes.filter((v) => v.vote === "yea").length
    const budgetNays = budgetVotes.filter((v) => v.vote === "nay").length
    const budgetAbsent = budgetVotes.filter((v) => v.vote === "absent").length

    councillorStats[slug].budgetVoting = {
      totalBudgetVotes: budgetVotes.length,
      budgetYeas,
      budgetNays,
      budgetAbsent,
    }

    // Calculate committee activity breakdown
    const committeeVotes: Record<
      string,
      { total: number; yeas: number; nays: number; absent: number }
    > = {}

    for (const vote of data.votes) {
      const committee = vote.meetingType || "Unknown"
      if (!committeeVotes[committee]) {
        committeeVotes[committee] = { total: 0, yeas: 0, nays: 0, absent: 0 }
      }
      committeeVotes[committee].total++
      if (vote.vote === "yea") {
        committeeVotes[committee].yeas++
      } else if (vote.vote === "nay") {
        committeeVotes[committee].nays++
      } else {
        committeeVotes[committee].absent++
      }
    }

    // Convert to CommitteeActivity array and sort by total votes descending
    councillorStats[slug].committeeActivity = Object.entries(committeeVotes)
      .map(([committee, stats]) => ({
        committee,
        totalVotes: stats.total,
        yeas: stats.yeas,
        nays: stats.nays,
        participationRate:
          stats.total > 0
            ? ((stats.yeas + stats.nays) / stats.total) * 100
            : 0,
      }))
      .sort((a, b) => b.totalVotes - a.totalVotes)

    // Find dissenting votes: split votes where councillor was in minority
    // A dissent is: nay on passed motion OR yea on failed motion
    const dissents: NotableDissent[] = []
    for (const vote of data.votes) {
      // Skip if unanimous, absent, or missing required fields
      if (vote.unanimous || vote.vote === "absent") continue
      if (!vote.motionText || !vote.result) continue

      // Check if councillor was in the minority
      const wasDissentingVote =
        (vote.vote === "nay" && vote.passed) ||
        (vote.vote === "yea" && !vote.passed)

      if (wasDissentingVote) {
        // Truncate motion text to 200 chars for display
        const truncatedMotion =
          vote.motionText.length > 200
            ? vote.motionText.substring(0, 200) + "..."
            : vote.motionText

        dissents.push({
          date: vote.date,
          meetingTitle: vote.meetingTitle,
          itemTitle: vote.itemTitle,
          motionText: truncatedMotion,
          vote: vote.vote,
          result: vote.result,
          meetingUrl: vote.meetingUrl,
        })
      }
    }

    // Sort by date descending and take the most recent 10
    dissents.sort((a, b) => b.date.localeCompare(a.date))
    councillorStats[slug].notableDissents = dissents.slice(0, 10)

    // Build motion vote map for alignment analysis
    for (const vote of data.votes) {
      if (vote.vote === "absent") continue // Skip absent for alignment

      const motionKey = `${vote.meetingSlug}::${vote.itemNumber}`

      if (!motionVotes.has(motionKey)) {
        motionVotes.set(motionKey, new Map())
      }
      motionVotes.get(motionKey)!.set(slug, vote.vote)
    }
  }

  console.log(`   Loaded ${motionVotes.size} unique motions for alignment analysis`)

  // ============================================
  // PART 3: Calculate Voting Alignment
  // ============================================
  console.log("\n🤝 Calculating voting alignment...")

  // Get ONLY current councillor slugs (2022-2026 term) for alignment matrix
  // This prevents old councillors (e.g., Ed Holder) from polluting alignment data
  const currentCouncillorSlugs = new Set(
    Object.keys(registry)
      .filter((canonicalName) => isCurrentCouncillor(canonicalName, registry))
      .map((name) => getSlug(name))
  )
  const allSlugs = Object.keys(councillorStats).filter((slug) =>
    currentCouncillorSlugs.has(slug)
  )
  console.log(`   Filtering to ${allSlugs.length} current councillors for alignment`)

  // Pairwise alignment counts
  const alignmentCounts: Map<
    string,
    { shared: number; agreed: number }
  > = new Map()

  // Initialize all pairs
  for (let i = 0; i < allSlugs.length; i++) {
    for (let j = i + 1; j < allSlugs.length; j++) {
      const pairKey = [allSlugs[i], allSlugs[j]].sort().join("::")
      alignmentCounts.set(pairKey, { shared: 0, agreed: 0 })
    }
  }

  // Calculate alignment for each motion
  for (const [, votes] of motionVotes) {
    const voters = Array.from(votes.keys())

    for (let i = 0; i < voters.length; i++) {
      for (let j = i + 1; j < voters.length; j++) {
        const pairKey = [voters[i], voters[j]].sort().join("::")
        const counts = alignmentCounts.get(pairKey)
        if (!counts) continue

        counts.shared++
        if (votes.get(voters[i]) === votes.get(voters[j])) {
          counts.agreed++
        }
      }
    }
  }

  // Build alignment matrix
  const alignmentMatrix: Record<string, Record<string, number>> = {}

  for (const slug of allSlugs) {
    alignmentMatrix[slug] = {}
  }

  const allAlignments: RawAlignmentPair[] = []

  for (const [pairKey, counts] of alignmentCounts) {
    if (counts.shared < 10) continue // Need minimum votes together

    const [slug1, slug2] = pairKey.split("::")
    const rate = (counts.agreed / counts.shared) * 100

    alignmentMatrix[slug1][slug2] = rate
    alignmentMatrix[slug2][slug1] = rate

    allAlignments.push({
      councillor1: councillorStats[slug1].councillor,
      councillor2: councillorStats[slug2].councillor,
      sharedVotes: counts.shared,
      agreedVotes: counts.agreed,
      alignmentRate: rate,
    })
  }

  // Assign top/bottom alignments for each councillor
  for (const slug of allSlugs) {
    const myAlignments = allAlignments
      .filter(
        (a) =>
          getSlugFromName(a.councillor1) === slug ||
          getSlugFromName(a.councillor2) === slug
      )
      .map((a) => {
        // Find the "other" councillor in the pair
        const otherCouncillor =
          getSlugFromName(a.councillor1) === slug ? a.councillor2 : a.councillor1
        return {
          councillor: otherCouncillor,
          sharedVotes: a.sharedVotes,
          agreedVotes: a.agreedVotes,
          alignmentRate: a.alignmentRate,
        }
      })

    // Sort by alignment rate
    myAlignments.sort((a, b) => b.alignmentRate - a.alignmentRate)

    councillorStats[slug].topAlignments = myAlignments.slice(0, 5)
    councillorStats[slug].bottomAlignments = myAlignments.slice(-5).reverse()
  }

  console.log(`   Calculated ${allAlignments.length} councillor pair alignments`)

  // ============================================
  // PART 4: Write Output Files
  // ============================================
  console.log("\n📝 Writing stats files...")

  // Write main stats file
  const output: StatsOutput = {
    generatedAt: new Date().toISOString(),
    councillorStats,
    alignmentMatrix,
  }

  await fs.writeFile(
    path.join(outputDir, "councillor-stats.json"),
    JSON.stringify(output, null, 2)
  )

  // Write individual councillor stat files for easy access
  for (const [slug, stats] of Object.entries(councillorStats)) {
    await fs.writeFile(
      path.join(outputDir, `${slug}.json`),
      JSON.stringify(stats, null, 2)
    )
  }

  // Write alignment matrix as separate file for visualization
  const alignmentMatrixData = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      matrix: alignmentMatrix,
      councillors: allSlugs.map((s) => ({
        slug: s,
        name: councillorStats[s].councillor,
      })),
    },
    null,
    2
  )

  await fs.writeFile(path.join(outputDir, "alignment-matrix.json"), alignmentMatrixData)

  // Also copy to static directory for Quartz build
  const staticDir = path.join(process.cwd(), "quartz", "static", "data", "stats")
  await fs.mkdir(staticDir, { recursive: true })
  await fs.writeFile(path.join(staticDir, "alignment-matrix.json"), alignmentMatrixData)
  await fs.writeFile(
    path.join(staticDir, "councillor-stats.json"),
    JSON.stringify(output, null, 2)
  )

  console.log("\n✅ Statistics generation complete!")
  console.log(`   Councillor stats: ${Object.keys(councillorStats).length}`)
  console.log(`   Alignment pairs: ${allAlignments.length}`)

  // Print some interesting stats
  const currentCouncillors = Object.values(councillorStats).filter(
    (s) => s.attendance.totalMeetings > 50
  )

  if (currentCouncillors.length > 0) {
    console.log("\n📈 Sample Statistics (councillors with 50+ meetings):")

    // Highest attendance
    const topAttendance = [...currentCouncillors]
      .sort((a, b) => b.attendance.attendanceRate - a.attendance.attendanceRate)
      .slice(0, 3)

    console.log("\n   Top Attendance Rates:")
    for (const c of topAttendance) {
      console.log(
        `   - ${c.councillor}: ${c.attendance.attendanceRate.toFixed(1)}%`
      )
    }

    // Highest yea rates
    const topYea = [...currentCouncillors]
      .filter((c) => c.voting.totalVotes > 100)
      .sort((a, b) => b.voting.yeaRate - a.voting.yeaRate)
      .slice(0, 3)

    console.log("\n   Highest Yea Rates (of participated votes):")
    for (const c of topYea) {
      console.log(`   - ${c.councillor}: ${c.voting.yeaRate.toFixed(1)}%`)
    }

    // Highest dissent (lowest yea rate)
    const topNay = [...currentCouncillors]
      .filter((c) => c.voting.totalVotes > 100)
      .sort((a, b) => a.voting.yeaRate - b.voting.yeaRate)
      .slice(0, 3)

    console.log("\n   Most Frequent Dissenters:")
    for (const c of topNay) {
      console.log(`   - ${c.councillor}: ${(100 - c.voting.yeaRate).toFixed(1)}% nay rate`)
    }
  }
}

// Helper to get slug from display name
function getSlugFromName(name: string): string {
  const registry = loadRegistry()
  const canonical = normalizeCouncillorName(name)
  if (canonical && registry[canonical]) {
    return registry[canonical].slug
  }
  // Fallback to simple slug
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

main().catch(console.error)
