/**
 * Extract per-councillor voting data from meeting JSON files
 *
 * Scans all meeting data and generates data/votes/{slug}.json for each councillor
 * with their complete voting history.
 *
 * Usage: npx tsx scripts/generate-votes.ts
 */

import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import {
  loadRegistry,
  normalizeCouncillorName,
  getSlug,
} from "../lib/councillors/index.js"

// Types
interface VoteRow {
  vote: string // "Yeas:" or "Nays:" or "Absent:"
  voters: string[]
}

interface Vote {
  rows: VoteRow[]
  __class__: "Vote"
}

interface MotionResult {
  string: string // "Motion Passed (15 to 0)"
  __class__: "MotionResult"
}

interface ContentItem {
  vote?: Vote
  result?: MotionResult
  string?: string
  motion_texts?: { string: string }[]
  pre_motion_texts?: { string: string }[]
  __class__: string
}

interface MeetingItem {
  title: string
  number: string
  content: ContentItem[]
  items?: Record<string, MeetingItem>
  __class__: "MeetingItem"
}

interface Meeting {
  title: string
  datetime: string
  url: string
  meeting_type: string
  items: Record<string, MeetingItem>
  present?: string[]
  absent?: string[]
  remote_attendance?: string[]
}

interface VoteRecord {
  date: string
  meetingSlug: string
  meetingTitle: string
  meetingType: string
  meetingUrl: string
  itemNumber: string
  itemTitle: string
  motionText: string
  vote: "yea" | "nay" | "absent"
  result: string
  passed: boolean
  unanimous: boolean
}

interface CouncillorVotesFile {
  councillor: string
  slug: string
  generatedAt: string
  sourceHash: string
  summary: {
    totalMeetings: number
    totalVotes: number
    yeas: number
    nays: number
    absent: number
  }
  votes: VoteRecord[]
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

// Extract motion text from content item
function extractMotionText(content: ContentItem): string {
  const parts: string[] = []

  if (content.motion_texts) {
    parts.push(...content.motion_texts.map(t => t.string))
  }
  if (content.pre_motion_texts) {
    parts.push(...content.pre_motion_texts.map(t => t.string))
  }
  if (content.string && content.__class__ === "Paragraph") {
    parts.push(content.string)
  }

  return parts.join(" ").slice(0, 500) // Truncate to reasonable length
}

// Parse vote result string
function parseResult(result: string): { passed: boolean; unanimous: boolean } {
  const passed = /passed|carried|approved/i.test(result)
  const unanimousMatch = result.match(/\((\d+) to (\d+)\)/)
  const unanimous = unanimousMatch ? unanimousMatch[2] === "0" : false
  return { passed, unanimous }
}

// Normalize voter name from meeting format (e.g., "Mayor J. Morgan" -> "J. Morgan")
function normalizeVoterName(name: string): string | null {
  // Remove titles
  let cleaned = name
    .replace(/^(Mayor|Deputy Mayor|Councillor|Acting)\s+/i, "")
    .trim()

  return normalizeCouncillorName(cleaned)
}

// Recursively find all votes in meeting items
function findVotes(
  items: Record<string, MeetingItem>,
  meeting: Meeting,
  meetingSlug: string,
  parentPath: string = ""
): VoteRecord[] {
  const votes: VoteRecord[] = []
  const registry = loadRegistry()

  for (const [num, item] of Object.entries(items)) {
    const itemPath = parentPath ? `${parentPath}.${num}` : num

    // Check content for votes
    if (item.content && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content.vote && content.vote.rows) {
          const motionText = extractMotionText(content)
          const resultStr = content.result?.string || ""
          const { passed, unanimous } = parseResult(resultStr)

          // Process each voter
          for (const row of content.vote.rows) {
            const voteType = row.vote.toLowerCase().includes("yea")
              ? "yea"
              : row.vote.toLowerCase().includes("nay")
                ? "nay"
                : "absent"

            for (const voterName of row.voters) {
              const canonicalName = normalizeVoterName(voterName)
              if (canonicalName && registry[canonicalName]) {
                votes.push({
                  date: meeting.datetime.split(" ")[0],
                  meetingSlug,
                  meetingTitle: meeting.title,
                  meetingType: meeting.meeting_type || "Unknown",
                  meetingUrl: meeting.url,
                  itemNumber: itemPath,
                  itemTitle: item.title,
                  motionText,
                  vote: voteType,
                  result: resultStr,
                  passed,
                  unanimous,
                })
              }
            }
          }
        }
      }
    }

    // Recursively check nested items
    if (item.items && Object.keys(item.items).length > 0) {
      votes.push(...findVotes(item.items, meeting, meetingSlug, itemPath))
    }
  }

  return votes
}

// Generate a hash of the source data for staleness detection
function generateSourceHash(meetings: Meeting[]): string {
  const content = JSON.stringify(
    meetings.map(m => ({
      title: m.title,
      datetime: m.datetime,
      itemCount: Object.keys(m.items || {}).length,
    }))
  )
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
}

// Main function
async function main() {
  console.log("🗳️ Vote Extraction Script\n")

  const dataDir = path.join(process.cwd(), "data")
  const outputDir = path.join(dataDir, "votes")
  const registry = loadRegistry()

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true })

  // Initialize vote collections per councillor
  const councillorVotes: Record<string, VoteRecord[]> = {}
  const councillorMeetings: Record<string, Set<string>> = {}

  for (const canonicalName of Object.keys(registry)) {
    const slug = getSlug(canonicalName)
    councillorVotes[slug] = []
    councillorMeetings[slug] = new Set()
  }

  // Scan all meeting directories
  console.log("📁 Scanning meeting data...")
  const entries = await fs.readdir(dataDir, { withFileTypes: true })
  const monthDirs = entries
    .filter(e => e.isDirectory() && /^\d{4}-\d{2}/.test(e.name))
    .map(e => e.name)
    .sort()

  let totalMeetings = 0
  let totalVotes = 0
  const allMeetings: Meeting[] = []

  for (const monthDir of monthDirs) {
    const monthPath = path.join(dataDir, monthDir)
    const files = await fs.readdir(monthPath)
    const jsonFiles = files.filter(f => f.endsWith(".json"))

    for (const file of jsonFiles) {
      const filePath = path.join(monthPath, file)

      try {
        const content = await fs.readFile(filePath, "utf-8")
        const meeting: Meeting = JSON.parse(content)

        if (!meeting.items || Object.keys(meeting.items).length === 0) {
          continue
        }

        totalMeetings++
        allMeetings.push(meeting)

        // Generate meeting slug
        const meetingSlug = `months/${monthDir}/${file.replace(".json", "")}`

        // Find all votes in this meeting (just for counting)
        const votes = findVotes(meeting.items, meeting, meetingSlug)
        totalVotes += votes.length

      } catch (err) {
        // Skip files with parse errors
        continue
      }
    }
  }

  console.log(`   Found ${totalMeetings} meetings with items`)

  // Actually reprocess to properly attribute votes to councillors
  console.log("\n📊 Extracting votes per councillor...")

  for (const monthDir of monthDirs) {
    const monthPath = path.join(dataDir, monthDir)
    const files = await fs.readdir(monthPath)
    const jsonFiles = files.filter(f => f.endsWith(".json"))

    for (const file of jsonFiles) {
      const filePath = path.join(monthPath, file)

      try {
        const content = await fs.readFile(filePath, "utf-8")
        const meeting: Meeting = JSON.parse(content)

        if (!meeting.items || Object.keys(meeting.items).length === 0) {
          continue
        }

        const meetingSlug = `months/${monthDir}/${file.replace(".json", "")}`

        // Find all votes with councillor attribution
        findVotesWithAttribution(
          meeting.items,
          meeting,
          meetingSlug,
          councillorVotes,
          councillorMeetings,
          registry
        )

      } catch (err) {
        continue
      }
    }
  }

  // Generate source hash
  const sourceHash = generateSourceHash(allMeetings)

  // Write vote files for each councillor
  console.log("\n📝 Writing vote files...")
  let councillorsWithVotes = 0

  for (const [slug, votes] of Object.entries(councillorVotes)) {
    if (votes.length === 0) continue

    councillorsWithVotes++

    // Find canonical name for this slug
    const canonicalName = Object.keys(registry).find(
      name => registry[name].slug === slug
    )!

    // Calculate summary stats
    const yeas = votes.filter(v => v.vote === "yea").length
    const nays = votes.filter(v => v.vote === "nay").length
    const absent = votes.filter(v => v.vote === "absent").length
    const meetings = councillorMeetings[slug]?.size || 0

    // Sort votes by date descending
    votes.sort((a, b) => b.date.localeCompare(a.date))

    const votesFile: CouncillorVotesFile = {
      councillor: canonicalName,
      slug,
      generatedAt: new Date().toISOString(),
      sourceHash,
      summary: {
        totalMeetings: meetings,
        totalVotes: votes.length,
        yeas,
        nays,
        absent,
      },
      votes,
    }

    const outputPath = path.join(outputDir, `${slug}.json`)
    await fs.writeFile(outputPath, JSON.stringify(votesFile, null, 2))

    console.log(`   ✓ ${registry[canonicalName].displayName}: ${votes.length} votes`)
  }

  // ─── Phase 1: Aggregate all councillor votes into _all-motions.json ───
  console.log("\n📊 Aggregating all motions...")

  const motionMap = new Map<string, {
    date: string
    meetingSlug: string
    meetingTitle: string
    meetingType: string
    meetingUrl: string
    itemNumber: string
    itemTitle: string
    motionText: string
    result: string
    passed: boolean
    unanimous: boolean
    procedural: boolean
    yeas: string[]
    nays: string[]
    absent: string[]
  }>()

  // Read all councillor vote files and aggregate
  for (const [slug, votes] of Object.entries(councillorVotes)) {
    if (votes.length === 0) continue

    // Find display name for this councillor
    const canonicalName = Object.keys(registry).find(
      name => registry[name].slug === slug
    )!
    const displayName = registry[canonicalName].displayName

    for (const vote of votes) {
      // Create a unique key for each motion
      const motionKey = `${vote.date}|${vote.meetingSlug}|${vote.itemNumber}|${vote.motionText}`

      if (!motionMap.has(motionKey)) {
        motionMap.set(motionKey, {
          date: vote.date,
          meetingSlug: vote.meetingSlug,
          meetingTitle: vote.meetingTitle,
          meetingType: vote.meetingType,
          meetingUrl: vote.meetingUrl,
          itemNumber: vote.itemNumber,
          itemTitle: vote.itemTitle,
          motionText: vote.motionText,
          result: vote.result,
          passed: vote.passed,
          unanimous: vote.unanimous,
          procedural: isProcedural(vote.motionText),
          yeas: [],
          nays: [],
          absent: [],
        })
      }

      const motion = motionMap.get(motionKey)!
      if (vote.vote === "yea") motion.yeas.push(displayName)
      else if (vote.vote === "nay") motion.nays.push(displayName)
      else if (vote.vote === "absent") motion.absent.push(displayName)
    }
  }

  // Convert to array with IDs, sorted by date descending then item number
  const allMotions = Array.from(motionMap.values())
    .map(m => ({
      id: crypto.createHash("sha256")
        .update(`${m.date}|${m.meetingSlug}|${m.itemNumber}|${m.motionText}`)
        .digest("hex")
        .slice(0, 12),
      ...m,
      margin: Math.abs(m.yeas.length - m.nays.length),
    }))
    .sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date)
      if (dateCompare !== 0) return dateCompare
      return a.itemNumber.localeCompare(b.itemNumber)
    })

  const substantiveCount = allMotions.filter(m => !m.procedural).length
  const contestedCount = allMotions.filter(m => !m.procedural && !m.unanimous).length

  const allMotionsFile = {
    generatedAt: new Date().toISOString(),
    sourceHash,
    totalMotions: allMotions.length,
    substantiveMotions: substantiveCount,
    contestedMotions: contestedCount,
    motions: allMotions,
  }

  await fs.writeFile(
    path.join(outputDir, "_all-motions.json"),
    JSON.stringify(allMotionsFile)
  )

  console.log(`   Total motions: ${allMotions.length}`)
  console.log(`   Substantive: ${substantiveCount}`)
  console.log(`   Contested: ${contestedCount}`)

  // Write metadata file
  const metaFile = {
    generatedAt: new Date().toISOString(),
    sourceHash,
    totalMeetings,
    councillorsWithVotes,
    totalMotions: allMotions.length,
    substantiveMotions: substantiveCount,
    contestedMotions: contestedCount,
  }
  await fs.writeFile(
    path.join(outputDir, "_meta.json"),
    JSON.stringify(metaFile, null, 2)
  )

  console.log(`\n✅ Vote extraction complete!`)
  console.log(`   Meetings processed: ${totalMeetings}`)
  console.log(`   Councillors with votes: ${councillorsWithVotes}`)
  console.log(`   All motions aggregated: ${allMotions.length}`)
}

// Find votes and attribute to councillors
function findVotesWithAttribution(
  items: Record<string, MeetingItem>,
  meeting: Meeting,
  meetingSlug: string,
  councillorVotes: Record<string, VoteRecord[]>,
  councillorMeetings: Record<string, Set<string>>,
  registry: ReturnType<typeof loadRegistry>,
  parentPath: string = ""
): void {
  for (const [num, item] of Object.entries(items)) {
    const itemPath = parentPath ? `${parentPath}.${num}` : num

    if (item.content && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content.vote && content.vote.rows) {
          const motionText = extractMotionText(content)
          const resultStr = content.result?.string || ""
          const { passed, unanimous } = parseResult(resultStr)

          for (const row of content.vote.rows) {
            const voteType = row.vote.toLowerCase().includes("yea")
              ? "yea"
              : row.vote.toLowerCase().includes("nay")
                ? "nay"
                : "absent"

            for (const voterName of row.voters) {
              const canonicalName = normalizeVoterName(voterName)
              if (canonicalName && registry[canonicalName]) {
                const slug = registry[canonicalName].slug

                if (councillorVotes[slug]) {
                  councillorVotes[slug].push({
                    date: meeting.datetime.split(" ")[0],
                    meetingSlug,
                    meetingTitle: meeting.title,
                    meetingType: meeting.meeting_type || "Unknown",
                    meetingUrl: meeting.url,
                    itemNumber: itemPath,
                    itemTitle: item.title,
                    motionText,
                    vote: voteType,
                    result: resultStr,
                    passed,
                    unanimous,
                  })

                  councillorMeetings[slug]?.add(meetingSlug)
                }
              }
            }
          }
        }
      }
    }

    if (item.items && Object.keys(item.items).length > 0) {
      findVotesWithAttribution(
        item.items,
        meeting,
        meetingSlug,
        councillorVotes,
        councillorMeetings,
        registry,
        itemPath
      )
    }
  }
}

main().catch(console.error)
