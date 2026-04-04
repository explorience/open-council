/**
 * Add full vote history sections to councillor markdown pages
 *
 * Reads per-councillor vote JSON files and appends a collapsible
 * "Full Vote History" section grouped by year.
 *
 * Usage: npx tsx scripts/add-votes-to-councillors.ts
 */

import fs from "fs/promises"
import path from "path"
import { loadRegistry } from "../lib/councillors/index.js"

interface Vote {
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
  vote: string // "yea" | "nay" | "absent"
}

interface CouncillorVoteFile {
  councillor: string
  slug: string
  generatedAt: string
  totalVotes: number
  votes: Vote[]
}

function isProcedural(motionText: string): boolean {
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

function generateVoteHistoryMarkdown(votes: Vote[]): string {
  // Filter to substantive votes only
  const substantive = votes.filter(v => !isProcedural(v.motionText))

  if (substantive.length === 0) return ""

  // Group by year, sorted descending
  const byYear = new Map<string, Vote[]>()
  for (const v of substantive) {
    const year = v.date.slice(0, 4)
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year)!.push(v)
  }

  const years = Array.from(byYear.keys()).sort((a, b) => b.localeCompare(a))

  const lines: string[] = []
  lines.push("")
  lines.push("---")
  lines.push("")
  lines.push("## Full Vote History")
  lines.push("")

  const contested = substantive.filter(v => !v.unanimous)
  lines.push(`*${substantive.length.toLocaleString()} substantive votes (${contested.length.toLocaleString()} contested). Procedural motions excluded.*`)
  lines.push("")

  for (const year of years) {
    const yearVotes = byYear.get(year)!
    const yearContested = yearVotes.filter(v => !v.unanimous)

    lines.push(`<details>`)
    lines.push(`<summary><strong>${year}</strong> — ${yearVotes.length} votes (${yearContested.length} contested)</summary>`)
    lines.push("")

    // Sort by date descending within year
    yearVotes.sort((a, b) => b.date.localeCompare(a.date))

    // Group by meeting within the year
    const byMeeting = new Map<string, Vote[]>()
    for (const v of yearVotes) {
      const key = `${v.date}|${v.meetingTitle}`
      if (!byMeeting.has(key)) byMeeting.set(key, [])
      byMeeting.get(key)!.push(v)
    }

    for (const [meetingKey, meetingVotes] of byMeeting) {
      const [date, meetingTitle] = meetingKey.split("|")
      const meetingSlug = meetingVotes[0].meetingSlug.replace(/ /g, "-")
      const dateStr = new Date(date + "T12:00:00").toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric",
      })

      lines.push(`**[${dateStr} — ${meetingTitle}](/${meetingSlug})**`)
      lines.push("")

      for (const v of meetingVotes) {
        const voteIcon = v.vote === "yea" ? "🟢" : v.vote === "nay" ? "🔴" : "⚪"
        const voteText = v.vote.charAt(0).toUpperCase() + v.vote.slice(1)
        const resultIcon = v.passed ? "✅" : "❌"
        const closeVote = !v.unanimous && Math.abs(
          (v.result.match(/(\d+)\s*to\s*(\d+)/)?.[1] ? parseInt(v.result.match(/(\d+)\s*to\s*(\d+)/)![1]) : 0) -
          (v.result.match(/(\d+)\s*to\s*(\d+)/)?.[2] ? parseInt(v.result.match(/(\d+)\s*to\s*(\d+)/)![2]) : 0)
        ) <= 3 ? " 🔥" : ""

        const itemLabel = v.itemNumber ? `${v.itemNumber}. ` : ""
        lines.push(`- ${voteIcon} **${voteText}** — ${itemLabel}${v.itemTitle.slice(0, 100)}${v.itemTitle.length > 100 ? "..." : ""} ${resultIcon} ${v.result}${closeVote}`)
      }
      lines.push("")
    }

    lines.push(`</details>`)
    lines.push("")
  }

  return lines.join("\n")
}

async function main() {
  console.log("📊 Adding vote history to councillor pages\n")

  const votesDir = path.join(process.cwd(), "data", "votes")
  const councillorsDir = path.join(process.cwd(), "content", "councillors")

  const registry = loadRegistry()

  let updated = 0
  let skipped = 0

  for (const [canonicalName, info] of Object.entries(registry)) {
    const slug = (info as any).slug
    const isCurrent = (info as any).isCurrent !== false
    const folder = isCurrent ? "current" : "former"

    // Check if vote file exists
    const voteFile = path.join(votesDir, `${slug}.json`)
    try {
      await fs.access(voteFile)
    } catch {
      continue
    }

    // Check if councillor page exists
    const mdPath = path.join(councillorsDir, folder, `${slug}.md`)
    try {
      await fs.access(mdPath)
    } catch {
      // Try the other folder
      const altPath = path.join(councillorsDir, folder === "current" ? "former" : "current", `${slug}.md`)
      try {
        await fs.access(altPath)
        continue // Skip - wrong folder
      } catch {
        continue
      }
    }

    // Read vote data
    const voteData: CouncillorVoteFile = JSON.parse(await fs.readFile(voteFile, "utf-8"))

    if (voteData.votes.length === 0) {
      skipped++
      continue
    }

    // Read existing page
    const content = await fs.readFile(mdPath, "utf-8")

    // Skip if already has vote history
    if (content.includes("## Full Vote History")) {
      skipped++
      continue
    }

    // Generate and append
    const historySection = generateVoteHistoryMarkdown(voteData.votes)

    if (!historySection) {
      skipped++
      continue
    }

    const newContent = content.trimEnd() + "\n" + historySection + "\n"
    await fs.writeFile(mdPath, newContent)
    updated++

    const substantive = voteData.votes.filter(v => !isProcedural(v.motionText))
    console.log(`   ✅ ${canonicalName}: ${substantive.length} substantive votes added`)
  }

  console.log(`\n✅ Vote history added!`)
  console.log(`   Updated: ${updated} councillor pages`)
  console.log(`   Skipped: ${skipped}`)
}

main().catch(console.error)
