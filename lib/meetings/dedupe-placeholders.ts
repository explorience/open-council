/**
 * Placeholder-meeting deduplication.
 *
 * BUG FIX (2026-08): scraping/process_meeting.py writes a placeholder page
 * ("Official minutes have not been published yet...") when a meeting's
 * official minutes aren't out yet, under a generic filename like
 * "2026-07-21 - Council". When the minutes later publish, process_meeting()
 * writes the REAL meeting under a *different* filename (the real title,
 * e.g. "2026-07-21 12th Meeting of Council") - it never notices or removes
 * the old placeholder. scripts/generate-pages.ts's scanMeetings() then
 * lists BOTH as separate meetings, so live index pages (committee pages,
 * year pages) show a "minutes not yet published" stub sitting right next
 * to the real meeting for the same date.
 *
 * Verified against the real corpus this also catches a second, related
 * stub pattern beyond the create_placeholder_meeting() case named above:
 * some meetings have a THIRD file (e.g.
 * "2026-03-09-Community and Protective Services Committee.json", no spaces
 * around the dash) with empty `items` and no `placeholder` flag at all,
 * apparently written by an older/different transcript-sync code path. Since
 * dedup here matches purely on (date, committeeSlug) + a body-text/
 * frontmatter placeholder signal - not on any particular filename
 * convention - these get caught and suppressed too, as long as a real
 * (non-placeholder, non-stub) sibling exists for the same date+committee.
 * A stub with NO real sibling (a genuinely still-pending meeting, or a
 * transcript-only meeting that may never get official minutes) is always
 * kept - see isPlaceholderMeeting()'s callers for how that signal is
 * derived.
 *
 * DESIGN CHOICE - filter at generation time, don't delete source files:
 * scrape-meetings.yml runs on an unattended daily cron and auto-commits +
 * pushes whatever lands in data/ and content/ with NO human review. Wiring
 * automatic *deletion* of "stale" placeholders into that pipeline means a
 * bug in the matching heuristic could silently destroy scraped source data
 * in an unreviewed push to a live civic-transparency site two months
 * before an election - an unacceptable risk for the (mostly cosmetic)
 * benefit of not having a few extra stub files sit in data/. Filtering
 * them out at page-generation time is non-destructive, trivially safe to
 * re-run, and directly fixes the actual complaint (stubs appearing on live
 * index pages) with no risk of data loss. See also
 * server/embeddings.ts's loadMeetings(), which independently skips
 * placeholder-flagged meeting JSON so they don't pollute the chatbot's
 * search corpus either.
 */

export interface DedupableMeeting {
  date: string
  committeeSlug: string
  isPlaceholder: boolean
}

export interface DedupeResult<T> {
  kept: T[]
  suppressedCount: number
}

/**
 * Drop placeholder meetings from the list when a real (non-placeholder)
 * meeting exists for the same date + committee. A placeholder with no real
 * sibling (a genuinely still-pending meeting) is always kept.
 */
export function dedupePlaceholderMeetings<T extends DedupableMeeting>(
  meetings: T[]
): DedupeResult<T> {
  const byGroup = new Map<string, T[]>()
  for (const m of meetings) {
    const key = `${m.date}|${m.committeeSlug}`
    const group = byGroup.get(key)
    if (group) {
      group.push(m)
    } else {
      byGroup.set(key, [m])
    }
  }

  const kept: T[] = []
  let suppressedCount = 0

  for (const group of byGroup.values()) {
    const hasReal = group.some(m => !m.isPlaceholder)
    for (const m of group) {
      if (m.isPlaceholder && hasReal) {
        suppressedCount++
        continue
      }
      kept.push(m)
    }
  }

  return { kept, suppressedCount }
}

/**
 * Marker phrases written into placeholder pages by (current and historical
 * versions of) create_basic_markdown() in scraping/process_meeting.py, used
 * as a retroactive signal for placeholder pages that predate the
 * `placeholder: true` frontmatter tag. Two word orders are both present in
 * the real corpus ("have not been published yet" from the current
 * template vs. the older "have not yet been published" wording still on
 * some existing March 2026 pages) - both must be recognized or those older
 * stubs silently evade dedup.
 */
export const PLACEHOLDER_BODY_MARKERS = [
  "Official minutes have not been published yet",
  "Official minutes for this meeting have not yet been published",
  "official minutes have not yet been published",
] as const

/**
 * Determine whether a scanned meeting page is a placeholder.
 *
 * Checks (in order):
 *  1. `placeholder: true` frontmatter - the forward-looking, reliable
 *     signal written by process_meeting.py going forward.
 *  2. Known marker phrases in the page body - needed for existing
 *     placeholder pages that predate the frontmatter tag (including a
 *     legacy wording still present on some pages).
 */
export function isPlaceholderMeeting(
  frontmatter: Record<string, unknown>,
  bodyContent: string
): boolean {
  if (frontmatter.placeholder === true) return true
  return PLACEHOLDER_BODY_MARKERS.some(marker => bodyContent.includes(marker))
}
