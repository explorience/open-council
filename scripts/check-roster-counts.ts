/**
 * Guard: quartz/components/data/roster.ts is a HAND SNAPSHOT of the
 * `meetingCount` frontmatter that scripts/generate-pages.ts writes into
 * content/committees/*.md. The frontmatter is the source of truth; the
 * snapshot exists so FrontpageWall.tsx and DashboardView.tsx can print
 * the numbers without re-reading the corpus at render time.
 *
 * A snapshot that drifts ships a visibly wrong number on the front page
 * that contradicts the very committee page it links to. (It did: the
 * front-page stats column and the dashboard COMMITTEES card both printed
 * "Community and Protective Services 208" while
 * /committees/community-protective-services said "View all 209 meetings".)
 *
 * Run: npx tsx scripts/check-roster-counts.ts
 * Exit 0 = every roster row matches its committee page's frontmatter.
 */
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { committees } from "../quartz/components/data/roster.js"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const committeesDir = path.join(repoRoot, "content", "committees")

function frontmatterCount(source: string): number | null {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const line = m[1].match(/^meetingCount:\s*(\d+)\s*$/m)
  return line ? Number(line[1]) : null
}

const failures: string[] = []

for (const c of committees) {
  const file = path.join(committeesDir, `${c.slug}.md`)
  let source: string
  try {
    source = await fs.readFile(file, "utf8")
  } catch {
    failures.push(
      `${c.slug}: roster row has no content/committees/${c.slug}.md`,
    )
    continue
  }
  const truth = frontmatterCount(source)
  if (truth === null) {
    failures.push(
      `${c.slug}: content/committees/${c.slug}.md has no meetingCount frontmatter`,
    )
    continue
  }
  if (c.count !== truth) {
    failures.push(
      `${c.slug}: roster.ts count=${c.count} but content/committees/${c.slug}.md meetingCount=${truth}`,
    )
  } else {
    console.log(`  ok  ${c.slug.padEnd(36)} ${truth}`)
  }
}

if (failures.length > 0) {
  console.error(
    `\nFAIL — ${failures.length} roster row(s) drifted from frontmatter:`,
  )
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(
  `\nPASS — all ${committees.length} roster counts match their committee frontmatter.`,
)
