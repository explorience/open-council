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
  itemNumber: string
  vote: "yea" | "nay" | "absent"
}

interface CouncillorVotesFile {
  councillor: string
  slug: string
  votes: VoteRecord[]
}

interface AttendanceStats {
  totalMeetings: number
  present: number
  absent: number
  remote: number
  attendanceRate: number
}

interface AlignmentPair {
  councillor: string  // The "other" councillor in the pair
  sharedVotes: number
  agreedVotes: number
  alignmentRate: number
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
  }
  topAlignments: AlignmentPair[]
  bottomAlignments: AlignmentPair[]
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
      },
      voting: {
        totalVotes: 0,
        yeas: 0,
        nays: 0,
        absent: 0,
        participationRate: 0,
        yeaRate: 0,
      },
      topAlignments: [],
      bottomAlignments: [],
    }
    councillorAttendance[slug] = { present: 0, absent: 0, remote: 0, total: 0 }
  }

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
        for (const canonicalName of Object.keys(registry)) {
          if (!wasActiveOnDate(canonicalName, meetingDate, registry)) continue

          const slug = getSlug(canonicalName)
          councillorAttendance[slug].total++

          if (presentSet.has(slug)) {
            councillorAttendance[slug].present++
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

  // Update attendance stats
  for (const slug of Object.keys(councillorAttendance)) {
    const att = councillorAttendance[slug]
    councillorStats[slug].attendance = {
      totalMeetings: att.total,
      present: att.present,
      absent: att.absent,
      remote: att.remote,
      attendanceRate: att.total > 0 ? (att.present / att.total) * 100 : 0,
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

    // Update voting stats
    const yeas = data.votes.filter((v) => v.vote === "yea").length
    const nays = data.votes.filter((v) => v.vote === "nay").length
    const absent = data.votes.filter((v) => v.vote === "absent").length
    const total = data.votes.length
    const participated = yeas + nays

    councillorStats[slug].voting = {
      totalVotes: total,
      yeas,
      nays,
      absent,
      participationRate: total > 0 ? (participated / total) * 100 : 0,
      yeaRate: participated > 0 ? (yeas / participated) * 100 : 0,
    }

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

  // Get all councillor slugs
  const allSlugs = Object.keys(councillorStats)

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
  await fs.writeFile(
    path.join(outputDir, "alignment-matrix.json"),
    JSON.stringify(
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
