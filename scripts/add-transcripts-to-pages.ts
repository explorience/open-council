/**
 * Add transcript sections to meeting markdown pages
 *
 * This script reads JSON files that have transcripts and adds
 * a collapsible transcript section to the corresponding markdown files.
 *
 * Usage: npx tsx scripts/add-transcripts-to-pages.ts
 */

import fs from 'fs/promises'
import path from 'path'

interface TranscriptSegment {
  text: string
  end?: string
}

interface Meeting {
  title: string
  datetime: string
  transcript?: string | TranscriptSegment[]  // Consolidated full transcript text or legacy array format
  transcript_duration?: string  // Pre-computed duration, e.g., "1 hour, 43 minutes"
  transcript_source?: string
  transcript_source_url?: string
}

/**
 * Split text into paragraphs for better readability
 * Aims for paragraphs of roughly 3-5 sentences each
 */
function splitIntoParagraphs(text: string): string[] {
  // Split on sentence endings
  const sentences = text.split(/(?<=[.!?])\s+/)
  const paragraphs: string[] = []
  let currentParagraph: string[] = []

  for (const sentence of sentences) {
    currentParagraph.push(sentence)

    // Create a new paragraph every 4-5 sentences or at natural breaks
    if (currentParagraph.length >= 4) {
      paragraphs.push(currentParagraph.join(' '))
      currentParagraph = []
    }
  }

  // Don't forget the last paragraph
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(' '))
  }

  return paragraphs
}

/**
 * Generate the transcript markdown section
 */
function generateTranscriptMarkdown(
  transcript: string,
  duration?: string,
  source?: string,
  _sourceUrl?: string
): string {
  const durationText = duration || 'full recording'

  let md = '\n---\n\n'
  md += '## Full Transcript\n\n'

  // Attribution
  if (source === 'lillian_skinner_archive') {
    md += `> Transcript provided by [Lillian Skinner's London Council Archive](https://london.lillianskinner.ca). `
    md += `Note: This is an automated speech-to-text transcript and may contain errors. Speaker names are not identified.\n\n`
  }

  md += `<details>\n`
  md += `<summary>View full transcript (${durationText})</summary>\n\n`

  // Split into readable paragraphs
  const paragraphs = splitIntoParagraphs(transcript)

  for (const paragraph of paragraphs) {
    md += `${paragraph}\n\n`
  }

  md += '</details>\n'

  return md
}

/**
 * Check if markdown already has a transcript section
 */
function hasTranscriptSection(markdown: string): boolean {
  return markdown.includes('## Full Transcript')
}

/**
 * Remove existing transcript section from markdown
 */
function removeTranscriptSection(markdown: string): string {
  // Find the transcript section and remove it
  const transcriptStart = markdown.indexOf('\n---\n\n## Full Transcript')
  if (transcriptStart === -1) return markdown

  // Find the end of the details block
  const detailsEnd = markdown.indexOf('</details>', transcriptStart)
  if (detailsEnd === -1) return markdown

  const sectionEnd = markdown.indexOf('\n', detailsEnd + '</details>'.length)
  if (sectionEnd === -1) {
    return markdown.substring(0, transcriptStart)
  }

  return markdown.substring(0, transcriptStart) + markdown.substring(sectionEnd)
}

async function main() {
  console.log('📝 Adding transcripts to meeting pages\n')

  const dataDir = path.join(process.cwd(), 'data')
  const contentDir = path.join(process.cwd(), 'content', 'months')

  let added = 0
  let updated = 0
  let skipped = 0
  let noMarkdown = 0

  // Get all month directories
  const monthDirs = await fs.readdir(dataDir)
  const sortedMonths = monthDirs.filter(d => d.match(/^\d{4}-\d{2}$/)).sort().reverse()

  console.log(`Scanning ${sortedMonths.length} month directories...\n`)

  for (const monthDir of sortedMonths) {
    const monthPath = path.join(dataDir, monthDir)
    const files = await fs.readdir(monthPath)

    for (const file of files) {
      if (!file.endsWith('.json')) continue

      // Read JSON
      const jsonPath = path.join(monthPath, file)
      let meeting: Meeting
      try {
        const content = await fs.readFile(jsonPath, 'utf-8')
        meeting = JSON.parse(content)
      } catch (e) {
        continue
      }

      // Skip if no transcript
      const transcript = meeting.transcript
      if (!transcript || (typeof transcript === 'string' && transcript.length === 0)) {
        skipped++
        continue
      }

      // Handle both old array format and new string format during migration
      let transcriptText: string
      let duration: string | undefined = meeting.transcript_duration

      if (typeof transcript === 'string') {
        transcriptText = transcript
      } else if (Array.isArray(transcript)) {
        // Legacy format: array of segments - join them
        transcriptText = transcript.map((s) => s.text).join(' ')
        // Calculate duration from last segment if not provided
        if (!duration && transcript.length > 0) {
          const lastSeg = transcript[transcript.length - 1]
          if (lastSeg.end) {
            const parts = lastSeg.end.replace(',', '.').split(':')
            const hours = parseInt(parts[0], 10)
            const minutes = parseInt(parts[1], 10)
            if (hours > 0) {
              duration = `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`
            } else {
              duration = `${minutes} minute${minutes !== 1 ? 's' : ''}`
            }
          }
        }
      } else {
        skipped++
        continue
      }

      // Find corresponding markdown file
      const mdFileName = file.replace('.json', '.md')
      const mdPath = path.join(contentDir, monthDir, mdFileName)

      let markdown: string
      try {
        markdown = await fs.readFile(mdPath, 'utf-8')
      } catch (e) {
        // Markdown file doesn't exist
        noMarkdown++
        continue
      }

      // Check if already has transcript
      const hadTranscript = hasTranscriptSection(markdown)
      if (hadTranscript) {
        // Remove old transcript section to update it
        markdown = removeTranscriptSection(markdown)
      }

      // Generate and append transcript section
      const transcriptMd = generateTranscriptMarkdown(
        transcriptText,
        duration,
        meeting.transcript_source,
        meeting.transcript_source_url
      )

      const updatedMarkdown = markdown.trimEnd() + transcriptMd

      // Write updated markdown
      await fs.writeFile(mdPath, updatedMarkdown)

      if (hadTranscript) {
        updated++
        console.log(`  ↻ Updated: ${monthDir}/${mdFileName}`)
      } else {
        added++
        console.log(`  ✓ Added: ${monthDir}/${mdFileName}`)
      }
    }
  }

  console.log(`\n📊 Results:`)
  console.log(`   Added transcripts: ${added}`)
  console.log(`   Updated transcripts: ${updated}`)
  console.log(`   No transcript in JSON: ${skipped}`)
  console.log(`   No markdown file: ${noMarkdown}`)
}

main().catch(console.error)
