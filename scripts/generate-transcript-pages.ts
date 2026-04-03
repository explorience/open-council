/**
 * Generate content pages for transcript-only meetings
 *
 * When a meeting has transcript data but no official minutes,
 * the scraper creates a data JSON but no content .md page.
 * This script generates minimal content pages so transcripts
 * are accessible on the site.
 *
 * The add-transcripts-to-pages.ts script then adds the actual
 * transcript content to these pages.
 *
 * Usage: npx tsx scripts/generate-transcript-pages.ts
 */

import fs from 'fs/promises'
import path from 'path'

interface Meeting {
  title: string
  datetime: string
  meeting_type: string
  transcript?: string
  transcript_duration?: string
  placeholder?: boolean
  url?: string | null
  present?: string[]
  absent?: string[]
  items?: Record<string, unknown> | unknown[]
  data_sources?: {
    official_minutes: boolean
    transcript: boolean
    news_coverage?: boolean
  }
}

function generateMeetingMarkdown(meeting: Meeting, filename: string): string {
  const title = meeting.title || `${meeting.meeting_type} Meeting`
  const date = meeting.datetime?.split(' ')[0] || ''

  let md = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${date}\n---\n\n`
  md += `# ${title}\n\n`

  // Note about data source
  md += `> **Note:** Official minutes for this meeting have not yet been published. `
  md += `This page currently shows the meeting transcript only. `
  md += `Once official minutes are available, this page will be updated with full meeting details including agenda items, motions, and votes.\n\n`

  // Basic meeting info
  if (meeting.url) {
    md += `📋 [View on eScribe](${meeting.url})\n\n`
  }

  return md
}

async function main() {
  console.log('📄 Generating content pages for transcript-only meetings\n')

  const dataDir = path.join(process.cwd(), 'data')
  const contentDir = path.join(process.cwd(), 'content', 'months')

  let created = 0
  let alreadyExist = 0
  let noTranscript = 0

  const monthDirs = await fs.readdir(dataDir)
  const sortedMonths = monthDirs.filter(d => d.match(/^\d{4}-\d{2}$/)).sort().reverse()

  for (const monthDir of sortedMonths) {
    const monthPath = path.join(dataDir, monthDir)
    const files = await fs.readdir(monthPath)

    for (const file of files) {
      if (!file.endsWith('.json')) continue

      const jsonPath = path.join(monthPath, file)
      let meeting: Meeting
      try {
        const content = await fs.readFile(jsonPath, 'utf-8')
        meeting = JSON.parse(content)
      } catch {
        continue
      }

      // Only process meetings that have a transcript but no content page
      const hasTranscript = meeting.transcript &&
        (typeof meeting.transcript === 'string' ? meeting.transcript.length > 0 : true)

      if (!hasTranscript) {
        noTranscript++
        continue
      }

      // Check if content page already exists
      const mdFileName = file.replace('.json', '.md')
      const mdDir = path.join(contentDir, monthDir)
      const mdPath = path.join(mdDir, mdFileName)

      try {
        await fs.access(mdPath)
        alreadyExist++
        continue
      } catch {
        // File doesn't exist - we need to create it
      }

      // Generate minimal content page
      const markdown = generateMeetingMarkdown(meeting, file)

      await fs.mkdir(mdDir, { recursive: true })
      await fs.writeFile(mdPath, markdown)
      created++
      console.log(`  ✓ Created: ${monthDir}/${mdFileName}`)
    }
  }

  console.log(`\n📊 Results:`)
  console.log(`   Created pages: ${created}`)
  console.log(`   Already exist: ${alreadyExist}`)
  console.log(`   No transcript: ${noTranscript}`)
}

main().catch(console.error)
