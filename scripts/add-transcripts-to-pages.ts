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
  index: number
  start: string
  end: string
  text: string
}

interface Meeting {
  title: string
  datetime: string
  transcript?: TranscriptSegment[]
  transcript_source?: string
  transcript_source_url?: string
}

/**
 * Convert timestamp to seconds for duration calculation
 */
function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.replace(',', '.').split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseFloat(parts[2])
  return hours * 3600 + minutes * 60 + seconds
}

/**
 * Get human-readable duration from transcript segments
 */
function getTranscriptDuration(transcript: TranscriptSegment[]): string {
  if (!transcript.length) return '0 minutes'

  const lastSegment = transcript[transcript.length - 1]
  const totalSeconds = timestampToSeconds(lastSegment.end)

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`
  }
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`
}

/**
 * Format timestamp for display (HH:MM:SS → H:MM:SS or MM:SS)
 */
function formatTimestamp(timestamp: string): string {
  const parts = timestamp.replace(',', '.').split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = Math.floor(parseFloat(parts[2]))

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Generate the transcript markdown section
 */
function generateTranscriptMarkdown(
  transcript: TranscriptSegment[],
  source?: string,
  sourceUrl?: string
): string {
  const duration = getTranscriptDuration(transcript)

  let md = '\n---\n\n'
  md += '## Full Transcript\n\n'

  // Attribution
  if (source === 'lillian_skinner_archive') {
    md += `> Transcript provided by [Lillian Skinner's London Council Archive](https://london.lillianskinner.ca). `
    md += `Note: This is an automated speech-to-text transcript and may contain errors. Speaker names are not identified.\n\n`
  }

  md += `<details>\n`
  md += `<summary>View full transcript (${duration})</summary>\n\n`

  // Group segments into paragraphs (every ~30 seconds or natural breaks)
  let currentParagraph: TranscriptSegment[] = []
  let paragraphStartTime = transcript[0]?.start || '00:00:00'

  for (let i = 0; i < transcript.length; i++) {
    const segment = transcript[i]
    currentParagraph.push(segment)

    // Start new paragraph every ~30 seconds or at natural speech breaks
    const segmentTime = timestampToSeconds(segment.start)
    const paragraphTime = timestampToSeconds(paragraphStartTime)
    const isLongEnough = segmentTime - paragraphTime >= 30
    const endsWithPunctuation = /[.!?]$/.test(segment.text.trim())

    if (isLongEnough && endsWithPunctuation) {
      // Output paragraph
      const timestamp = formatTimestamp(paragraphStartTime)
      const text = currentParagraph.map(s => s.text).join(' ')
      md += `**[${timestamp}]** ${text}\n\n`

      // Reset for next paragraph
      currentParagraph = []
      if (i + 1 < transcript.length) {
        paragraphStartTime = transcript[i + 1].start
      }
    }
  }

  // Don't forget the last paragraph
  if (currentParagraph.length > 0) {
    const timestamp = formatTimestamp(paragraphStartTime)
    const text = currentParagraph.map(s => s.text).join(' ')
    md += `**[${timestamp}]** ${text}\n\n`
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
      if (!meeting.transcript || meeting.transcript.length === 0) {
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
        meeting.transcript,
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
