/**
 * Add vote breakdown sections to meeting markdown pages
 *
 * Reads _all-motions.json and injects a "Votes" section into each
 * meeting page showing substantive votes with roll calls.
 *
 * Idempotent: if a page already has a "## Votes" section (from a prior
 * run), it is REPLACED with the freshly generated one rather than
 * skipped or duplicated. Safe to re-run any time data/votes changes.
 *
 * This is the last step of the vote pipeline — run in this order:
 *   1. npx tsx scripts/generate-votes.ts   (scrape/parse -> data/votes)
 *   2. npx tsx scripts/generate-stats.ts   (data/votes -> data/stats)
 *   3. npx tsx scripts/generate-pages.ts   (data -> content/*.md, base pages)
 *   4. npx tsx scripts/add-votes-to-pages.ts (inject/refresh ## Votes sections)
 *
 * Usage: npx tsx scripts/add-votes-to-pages.ts
 */

import fs from "fs/promises"
import path from "path"
import {
  loadRegistry,
  getSlug,
  isCurrentCouncillor,
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
    // Registry entries carry no isCurrent field — the phantom-field check made EVERY
    // councillor "current", 404ing all former-councillor mentions. Use the term-based check.
    const isCurrent = isCurrentCouncillor(canonicalName)

    const folder = isCurrent ? "current" : "former"
    links.set(displayName, `/councillors/${folder}/${slug}`)
    // The frozen vote data stores registry keys (initials form, e.g. "W.R. Monteith"),
    // which can differ from displayName — register both so mentions always link.
    links.set(canonicalName, `/councillors/${folder}/${slug}`)
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

/**
 * Every meetingSlug the votes pipeline could possibly produce - scans
 * data/YYYY-MM/*.json the same way generate-votes.ts does, so a meeting
 * that currently has ZERO stored motions (all of them demoted/excluded,
 * e.g. a garbled roll call, or the file itself is a detected duplicate
 * re-publication) still gets visited below.
 *
 * Without this, main() below iterated motionsByMeeting alone - built
 * ONLY from _all-motions.json - so a meeting that lost ALL of its
 * motions was never visited at all and its stale "## Votes" section from
 * an earlier run was never stripped (issue #199 final verify: 2 pages,
 * 2011-12-05 Strategic Priorities and Policy Committee and 2015-06-10
 * MINUTES 17TH MEETING, kept publishing roll calls data/votes no longer
 * contained). Iterate the full meeting universe instead of the
 * motions-only one - "any page whose meeting has zero stored motions
 * gets its Votes section removed."
 */
async function allMeetingSlugs(dataDir: string): Promise<string[]> {
  const slugs: string[] = []
  const entries = await fs.readdir(dataDir, { withFileTypes: true })
  const monthDirs = entries
    .filter(e => e.isDirectory() && /^\d{4}-\d{2}/.test(e.name))
    .map(e => e.name)
    .sort()

  for (const monthDir of monthDirs) {
    const monthPath = path.join(dataDir, monthDir)
    const files = await fs.readdir(monthPath)
    for (const file of files.filter(f => f.endsWith(".json")).sort()) {
      try {
        const content = await fs.readFile(path.join(monthPath, file), "utf-8")
        const meeting = JSON.parse(content)
        if (!meeting.items || Object.keys(meeting.items).length === 0) continue
        slugs.push(`months/${monthDir}/${file.replace(".json", "")}`)
      } catch {
        continue
      }
    }
  }
  return slugs
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

  // The meeting universe to visit is motionsByMeeting's keys UNION every
  // meeting scanned from raw data - see allMeetingSlugs()'s doc comment.
  const scannedSlugs = await allMeetingSlugs(dataDir)
  const allSlugs = new Set<string>([...motionsByMeeting.keys(), ...scannedSlugs])
  console.log(`   ${allSlugs.size} meetings total to check (including zero-motion ones)`)

  // Process each meeting
  let updated = 0
  let skipped = 0
  let notFound = 0
  let orphansStripped = 0

  for (const meetingSlug of allSlugs) {
    const motions = motionsByMeeting.get(meetingSlug) ?? []
    // Find the markdown file
    const mdPath = await findMarkdownFile(contentDir, meetingSlug)

    if (!mdPath) {
      notFound++
      continue
    }

    // Read existing content
    const content = await fs.readFile(mdPath, "utf-8")

    // Generate votes markdown (may be "" if this meeting no longer has
    // any substantive votes, e.g. everything reclassified as procedural)
    const votesSection = generateVotesMarkdown(motions, councillorLinks)

    const votesHeadingIdx = content.indexOf("\n## Votes\n")

    if (votesHeadingIdx === -1 && !votesSection) {
      // No existing section and nothing to add this run - untouched.
      skipped++
      continue
    }

    // Strip any pre-existing "## Votes" section (and its leading "---"
    // separator) so re-runs REPLACE rather than append. The Votes section
    // is always the last thing in the file (see generateVotesMarkdown),
    // so this is just "cut everything from the separator before ## Votes
    // onward". Match defensively in case a future section is appended
    // after Votes: stop at the next "\n---\n\n## " boundary if one exists.
    let base = content
    if (votesHeadingIdx !== -1) {
      // Walk back over the "---\n\n" separator that generateVotesMarkdown
      // always writes immediately before the heading.
      const sepIdx = content.lastIndexOf("\n---\n\n", votesHeadingIdx)
      const cutFrom = sepIdx !== -1 ? sepIdx : votesHeadingIdx

      const rest = content.slice(votesHeadingIdx + "\n## Votes\n".length)
      const nextSectionMatch = rest.match(/\n---\n\n## /)
      const trailingKept = nextSectionMatch
        ? rest.slice(nextSectionMatch.index)
        : ""

      base = content.slice(0, cutFrom).trimEnd() + trailingKept
    }

    // Write the (re)generated votes section, or just the stripped base
    // if this meeting no longer has any substantive votes to show.
    const newContent = votesSection
      ? base.trimEnd() + "\n" + votesSection + "\n"
      : base.trimEnd() + "\n"
    if (newContent === content) {
      skipped++
      continue
    }
    if (votesHeadingIdx !== -1 && !votesSection) {
      orphansStripped++
    }
    await fs.writeFile(mdPath, newContent)
    updated++
  }

  console.log(`\n✅ Vote sections added!`)
  console.log(`   Updated: ${updated} meeting pages`)
  console.log(`   Skipped: ${skipped} (no substantive votes, or votes section already up to date)`)
  console.log(`   Not found: ${notFound} (no matching markdown file)`)
  console.log(`   Orphaned sections stripped: ${orphansStripped} (meeting now has zero stored motions)`)
}

main().catch(console.error)
