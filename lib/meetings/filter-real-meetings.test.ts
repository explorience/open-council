import test, { describe } from "node:test"
import assert from "node:assert"
import { filterRealMeetingFiles, type MeetingFileLike } from "./filter-real-meetings.js"

// Minimal QuartzPluginData-shaped fixtures. Real Quartz populates `text`
// via the Description transformer (plain-text rendering of the page body)
// before any component sees `allFiles` - see filter-real-meetings.ts.
function meetingFile(opts: {
  slug: string
  title: string
  text?: string
}): MeetingFileLike {
  return { slug: opts.slug, frontmatter: { title: opts.title }, text: opts.text ?? "" }
}

describe("filterRealMeetingFiles", () => {
  test("drops non-meeting pages (topics, guide, index, committees/years/councillors index pages)", () => {
    const files: MeetingFileLike[] = [
      { slug: "index" },
      { slug: "guide" },
      { slug: "topics/fireworks-bylaw" },
      { slug: "committees/budget" },
      { slug: "years/2026" },
      { slug: "councillors/current/s-franke" },
      meetingFile({ slug: "months/2026-08/2026-08-12 13th Meeting of the Infrastructure and Corporate Services Committee", title: "13th Meeting of the Infrastructure and Corporate Services Committee" }),
    ]
    const kept = filterRealMeetingFiles(files)
    assert.strictEqual(kept.length, 1)
    assert.strictEqual(kept[0].slug, "months/2026-08/2026-08-12 13th Meeting of the Infrastructure and Corporate Services Committee")
  })

  test("suppresses a stale placeholder duplicate when a real sibling exists for the same date+committee (2026-08-12 ICSC)", () => {
    const placeholder = meetingFile({
      slug: "months/2026-08/2026-08-12 - Infrastructure and Corporate Services Committee",
      title: "Infrastructure and Corporate Services Committee",
      text: "August 12, 2026 Original link Official minutes have not been published yet for this meeting.",
    })
    const real = meetingFile({
      slug: "months/2026-08/2026-08-12 13th Meeting of the Infrastructure and Corporate Services Committee",
      title: "13th Meeting of the Infrastructure and Corporate Services Committee",
      text: "August 12, 2026, at 1:00 PM Present: H. McAlister, S. Stevenson, ...",
    })
    const kept = filterRealMeetingFiles([placeholder, real])
    assert.strictEqual(kept.length, 1)
    assert.strictEqual(kept[0], real)
  })

  test("keeps a placeholder with no real sibling (genuinely still-pending meeting)", () => {
    const placeholder = meetingFile({
      slug: "months/2026-08/2026-08-20 - Council",
      title: "Council",
      text: "Official minutes have not been published yet for this meeting.",
    })
    const kept = filterRealMeetingFiles([placeholder])
    assert.strictEqual(kept.length, 1)
  })

  test("does not confuse two different committees meeting on the same date", () => {
    const files: MeetingFileLike[] = [
      meetingFile({
        slug: "months/2026-08/2026-08-10 - Community and Protective Services Committee",
        title: "Community and Protective Services Committee",
        text: "Official minutes have not been published yet for this meeting.",
      }),
      meetingFile({
        slug: "months/2026-08/2026-08-10 - Planning and Environment Committee",
        title: "Planning and Environment Committee",
        text: "Official minutes have not been published yet for this meeting.",
      }),
    ]
    const kept = filterRealMeetingFiles(files)
    assert.strictEqual(kept.length, 2)
  })

  test("a file whose committee can't be extracted from its title is always kept (fail-safe, not fail-open)", () => {
    const mystery = meetingFile({
      slug: "months/2026-08/2026-08-15 Some Unrecognizable Title",
      title: "Some Unrecognizable Title With No Committee Words",
    })
    const kept = filterRealMeetingFiles([mystery])
    assert.strictEqual(kept.length, 1)
  })
})
