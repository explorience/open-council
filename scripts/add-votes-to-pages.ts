/**
 * Add vote breakdown sections to meeting markdown pages
 *
 * Reads _all-motions.json and injects a "Votes" section into each
 * meeting page showing substantive votes with roll calls.
 *
 * Usage: npx tsx scripts/add-votes-to-pages.ts
 */

import fs from "fs/promises"
import path from "path"
import {
  loadRegistry,
  getSlug,
} from "../lib/councillors/index.js"

interface AggregatedMotion {
  id: string
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
  margin: number
}

interface AllMotionsFile {
  generatedAt: string
  totalMotions: number
  substantiveMotions: number
  contestedMotions: number
  motions: AggregatedMotion[]
}

/**
 * Build a name → councillor page path lookup
 */
function buildCouncillorLinks(): Map<string, string> {
  const registry = loadRegistry()
  const links = new Map<string, string>()

  for (const [canonicalName, info] of Object.entries(registry)) {
    const slug = (info as any).slug || getSlug(canonicalName)
    const displayName = (info as any).displayName || canonicalName
    const isCurrent = (info as any).isCurrent !== false

    const folder = isCurrent ? "current" : "former"
    links.set(displayName, `/councillors/${folder}/${slug}`)
  }

  return links
}

/**
 * Format a councillor name as a markdown link if we have a page for them
 */
function linkCouncillor(name: string, links: Map<string, string>): string {
  const path = links.get(name)
  if (path) {
    return `[${name}](${path})`
  }
  return name
}

/**
 * Generate the votes markdown section for a meeting
 */
function generateVotesMarkdown(
  motions: AggregatedMotion[],
  councillorLinks: Map<string, string>
): string {
  // Filter to substantive votes only
  const substantive = motions.filter(m => !m.procedural)

  if (substantive.length === 0) return ""

  const contested = substantive.filter(m => !m.unanimous)
  const unanimous = substantive.filter(m => m.unanimous)

  const lines: string[] = []
  lines.push("")
  lines.push("---")
  lines.push("")
  lines.push("## Votes")
  lines.push("")
  lines.push(`*${substantive.length} substantive vote${substantive.length !== 1 ? "s" : ""} at this meeting (${contested.length} contested, ${unanimous.length} unanimous). Procedural motions excluded.*`)
  lines.push("")

  // Sort by item number
  const sorted = [...substantive].sort((a, b) => {
    // Parse item numbers like "3.8" for natural sorting
    const aParts = a.itemNumber.split(".").map(Number)
    const bParts = b.itemNumber.split(".").map(Number)
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0
      const bVal = bParts[i] || 0
      if (aVal !== bVal) return aVal - bVal
    }
    return 0
  })

  for (const motion of sorted) {
    const icon = motion.passed ? "✅" : "❌"
    const closeVote = !motion.unanimous && motion.margin <= 3 ? " 🔥" : ""

    // Item title as heading
    const itemLabel = motion.itemNumber ? `${motion.itemNumber}. ` : ""
    lines.push(`### ${itemLabel}${motion.itemTitle.trim()}`)
    lines.push("")

    // Motion text (truncated)
    const motionText = motion.motionText.length > 300
      ? motion.motionText.slice(0, 297) + "..."
      : motion.motionText
    lines.push(`> ${motionText.replace(/\n/g, " ")}`)
    lines.push("")

    // Result
    lines.push(`**${icon} ${motion.result}${closeVote}**`)
    lines.push("")

    if (motion.unanimous) {
      lines.push(`Unanimous (${motion.yeas.length}-0)`)
      lines.push("")
    } else {
      // Expandable roll call for contested votes
      lines.push("<details>")
      lines.push("<summary>View roll call</summary>")
      lines.push("")

      if (motion.yeas.length > 0) {
        const yeas = motion.yeas.map(n => linkCouncillor(n, councillorLinks)).join(", ")
        lines.push(`**Yea (${motion.yeas.length}):** ${yeas}`)
        lines.push("")
      }

      if (motion.nays.length > 0) {
        const nays = motion.nays.map(n => linkCouncillor(n, councillorLinks)).join(", ")
        lines.push(`**Nay (${motion.nays.length}):** ${nays}`)
        lines.push("")
      }

      if (motion.absent.length > 0) {
        const absent = motion.absent.map(n => linkCouncillor(n, councillorLinks)).join(", ")
        lines.push(`**Absent (${motion.absent.length}):** ${absent}`)
        lines.push("")
      }

      lines.push("</details>")
      lines.push("")
    }
  }

  return lines.join("\n")
}

/**
 * Find the matching markdown file for a meetingSlug
 */
async function findMarkdownFile(contentDir: string, meetingSlug: string): Promise<string | null> {
  // meetingSlug is like "months/2026-03/2026-03-10 5th Meeting of the Planning and Environment Committee"
  // Markdown files might have slightly different names
  const mdPath = path.join(contentDir, `${meetingSlug}.md`)

  try {
    await fs.access(mdPath)
    return mdPath
  } catch {
    // Try alternative naming patterns
    // Some files use " - " separator instead of the full title
    const dir = path.dirname(path.join(contentDir, meetingSlug))
    const baseName = path.basename(meetingSlug)
    const dateMatch = baseName.match(/^(\d{4}-\d{2}-\d{2})/)

    if (dateMatch) {
      try {
        const files = await fs.readdir(dir)
        // Find files starting with the same date
        const candidates = files.filter(f =>
          f.endsWith(".md") && f.startsWith(dateMatch[1])
        )

        // Try exact match first
        const exactFile = `${baseName}.md`
        if (candidates.includes(exactFile)) {
          return path.join(dir, exactFile)
        }

        // Try partial match - the meeting slug title should be contained in the filename
        // Extract the meeting type from the slug
        const slugType = baseName.replace(/^\d{4}-\d{2}-\d{2}\s*/, "").toLowerCase()
        for (const candidate of candidates) {
          const candidateType = candidate.replace(/^\d{4}-\d{2}-\d{2}\s*[-]?\s*/, "").replace(".md", "").toLowerCase()
          if (candidateType.includes(slugType.split(" ").slice(-2).join(" ")) ||
              slugType.includes(candidateType.split(" ").slice(-2).join(" "))) {
            return path.join(dir, candidate)
          }
        }

        // If only one candidate for this date and meeting type matches loosely
        if (candidates.length === 1) {
          return path.join(dir, candidates[0])
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return null
  }
}

async function main() {
  console.log("🗳️ Adding vote sections to meeting pages\n")

  const dataDir = path.join(process.cwd(), "data")
  const contentDir = path.join(process.cwd(), "content")
  const motionsPath = path.join(dataDir, "votes", "_all-motions.json")

  // Load all motions
  const motionsData: AllMotionsFile = JSON.parse(
    await fs.readFile(motionsPath, "utf-8")
  )
  console.log(`   Loaded ${motionsData.totalMotions} motions`)

  // Build councillor link map
  const councillorLinks = buildCouncillorLinks()
  console.log(`   ${councillorLinks.size} councillors mapped`)

  // Group motions by meetingSlug
  const motionsByMeeting = new Map<string, AggregatedMotion[]>()
  for (const motion of motionsData.motions) {
    const key = motion.meetingSlug
    if (!motionsByMeeting.has(key)) {
      motionsByMeeting.set(key, [])
    }
    motionsByMeeting.get(key)!.push(motion)
  }
  console.log(`   ${motionsByMeeting.size} meetings with votes`)

  // Process each meeting
  let updated = 0
  let skipped = 0
  let notFound = 0

  for (const [meetingSlug, motions] of motionsByMeeting) {
    // Find the markdown file
    const mdPath = await findMarkdownFile(contentDir, meetingSlug)

    if (!mdPath) {
      notFound++
      continue
    }

    // Read existing content
    const content = await fs.readFile(mdPath, "utf-8")

    // Skip if already has a votes section
    if (content.includes("## Votes")) {
      skipped++
      continue
    }

    // Generate votes markdown
    const votesSection = generateVotesMarkdown(motions, councillorLinks)

    if (!votesSection) {
      skipped++
      continue
    }

    // Append votes section to the markdown
    const newContent = content.trimEnd() + "\n" + votesSection + "\n"
    await fs.writeFile(mdPath, newContent)
    updated++
  }

  console.log(`\n✅ Vote sections added!`)
  console.log(`   Updated: ${updated} meeting pages`)
  console.log(`   Skipped: ${skipped} (already had votes or no substantive votes)`)
  console.log(`   Not found: ${notFound} (no matching markdown file)`)
}

main().catch(console.error)
