/**
 * Shared "which pages are real meetings" predicate for Quartz's homepage
 * components (RecentNotes' "Recent Meetings" panel and DashboardView's
 * advanced-mode rail + "Meetings" stat card).
 *
 * Fixes two findings from the 30 Aug 2026 audit of the committee-mapping /
 * homepage-dedupe branch:
 *
 *  - BLOCKER: DashboardView.tsx carried its own copy of the stale exclusion
 *    blocklist (`slug !== "index" && !startsWith("committees/") && ...`)
 *    that quartz.layout.ts's RecentNotes filter had just been fixed to drop
 *    in favour of an inclusion check (`startsWith("months/")`). Two
 *    independent filters is exactly how they drifted apart the first time -
 *    hoisting one predicate here means they can't drift a third time.
 *
 *  - GAP: even with the months/ inclusion check, the rail still showed each
 *    real meeting NEXT TO its stale "Official minutes have not been
 *    published yet" placeholder stub (dedupePlaceholderMeetings() runs
 *    inside scripts/generate-pages.ts's scanMeetings(), which only affects
 *    the generated committee/year/councillor pages - it never touches
 *    Quartz's `allFiles`, so RecentNotes/DashboardView still saw the raw,
 *    undeduped .md files). This re-derives the same (date, committeeSlug,
 *    isPlaceholder) grouping from Quartz's QuartzPluginData (frontmatter +
 *    the Description transformer's plain-text `f.text`, since Quartz has no
 *    access to the raw markdown file content scanMeetings() reads from
 *    disk) and reuses dedupePlaceholderMeetings() to suppress the same
 *    stale stubs here too.
 */

import { extractCommittee } from "./committee.js"
import { dedupePlaceholderMeetings, isPlaceholderMeeting, type DedupableMeeting } from "./dedupe-placeholders.js"

export interface MeetingFileLike {
  slug?: string
  frontmatter?: { title?: string; [key: string]: unknown }
  text?: string
}

interface Candidate<T> extends DedupableMeeting {
  file: T
}

/**
 * Given Quartz's `allFiles` (or any array of meeting-shaped pages), return
 * the subset that are real meeting pages: under months/, with stale
 * placeholder duplicates suppressed. Order is preserved from the input -
 * callers that need a particular order (e.g. newest-first) should sort
 * after filtering, same as scanMeetings() does.
 */
export function filterRealMeetingFiles<T extends MeetingFileLike>(files: T[]): T[] {
  const monthFiles = files.filter((f) => f.slug?.startsWith("months/") ?? false)

  const candidates: Candidate<T>[] = monthFiles.map((f) => {
    const title = f.frontmatter?.title ?? ""
    const committee = title ? extractCommittee(title) : null
    // Date comes from the slug (months/YYYY-MM/YYYY-MM-DD ...), the same
    // convention quartz.layout.ts's Explorer mapFn and the WatchButton
    // ConditionalRender already rely on - not from frontmatter.date, which
    // would require trusting gray-matter/js-yaml not to have coerced it to
    // a Date object.
    const dateSlugPart = f.slug!.split("/")[2] ?? ""
    const date = dateSlugPart.slice(0, "YYYY-MM-DD".length)
    if (!committee || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      // Can't group it reliably - always keep rather than risk dropping a
      // real page. Give it a unique key so it never collides with (and
      // suppresses, or gets suppressed by) an unrelated meeting.
      return { file: f, date: "", committeeSlug: `__ungrouped__:${f.slug}`, isPlaceholder: false }
    }
    return {
      file: f,
      date,
      committeeSlug: committee.slug,
      isPlaceholder: isPlaceholderMeeting(f.frontmatter ?? {}, f.text ?? ""),
    }
  })

  const { kept } = dedupePlaceholderMeetings(candidates)
  return kept.map((c) => c.file)
}
