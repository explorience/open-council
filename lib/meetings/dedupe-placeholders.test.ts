import test, { describe } from "node:test"
import assert from "node:assert"
import {
  dedupePlaceholderMeetings,
  isPlaceholderMeeting,
  type DedupableMeeting,
} from "./dedupe-placeholders.js"

describe("isPlaceholderMeeting", () => {
  test("true when placeholder frontmatter is set", () => {
    assert.strictEqual(isPlaceholderMeeting({ placeholder: true }, "anything"), true)
  })

  test("true when the body contains the known placeholder marker text (retroactive detection)", () => {
    assert.strictEqual(
      isPlaceholderMeeting({}, "> [!info] Official minutes have not been published yet for this meeting.\n"),
      true
    )
  })

  test("false for a real meeting page", () => {
    assert.strictEqual(
      isPlaceholderMeeting({}, "> [!abstract]- Present:\n> J. Morgan, ...\n"),
      false
    )
  })

  test("true for the legacy word-order marker found on some existing March 2026 pages (regression guard)", () => {
    // e.g. content/months/2026-03/2026-03-03 - Council.md: this older
    // wording predates the current create_basic_markdown() template and
    // was initially missed by a marker check that only recognized "have
    // not been published yet" (not "have not yet been published").
    assert.strictEqual(
      isPlaceholderMeeting(
        {},
        "> **Note:** Official minutes for this meeting have not yet been published. This page currently shows the meeting transcript only.\n"
      ),
      true
    )
  })
})

describe("dedupePlaceholderMeetings", () => {
  test("drops a placeholder when a real sibling exists for the same date+committee (the 2026-07-21 Council case)", () => {
    const meetings: DedupableMeeting[] = [
      { date: "2026-07-21", committeeSlug: "city-council", isPlaceholder: true },
      { date: "2026-07-21", committeeSlug: "city-council", isPlaceholder: false },
    ]
    const { kept, suppressedCount } = dedupePlaceholderMeetings(meetings)
    assert.strictEqual(suppressedCount, 1)
    assert.strictEqual(kept.length, 1)
    assert.strictEqual(kept[0].isPlaceholder, false)
  })

  test("keeps a placeholder with no real sibling (genuinely still-pending meeting, e.g. 2026-08-12 ICSC)", () => {
    const meetings: DedupableMeeting[] = [
      { date: "2026-08-12", committeeSlug: "infrastructure-corporate-services", isPlaceholder: true },
    ]
    const { kept, suppressedCount } = dedupePlaceholderMeetings(meetings)
    assert.strictEqual(suppressedCount, 0)
    assert.strictEqual(kept.length, 1)
  })

  test("does not touch meetings on the same date for a DIFFERENT committee", () => {
    const meetings: DedupableMeeting[] = [
      { date: "2026-07-21", committeeSlug: "city-council", isPlaceholder: true },
      { date: "2026-07-21", committeeSlug: "city-council", isPlaceholder: false },
      { date: "2026-07-21", committeeSlug: "planning-environment", isPlaceholder: true },
    ]
    const { kept, suppressedCount } = dedupePlaceholderMeetings(meetings)
    assert.strictEqual(suppressedCount, 1)
    assert.strictEqual(kept.length, 2)
    assert.ok(kept.some(m => m.committeeSlug === "planning-environment" && m.isPlaceholder))
  })

  test("two real meetings on the same date+committee are both kept (no placeholder involved)", () => {
    const meetings: DedupableMeeting[] = [
      { date: "2026-03-13", committeeSlug: "community-protective-services", isPlaceholder: false },
      { date: "2026-03-13", committeeSlug: "community-protective-services", isPlaceholder: false },
    ]
    const { kept, suppressedCount } = dedupePlaceholderMeetings(meetings)
    assert.strictEqual(suppressedCount, 0)
    assert.strictEqual(kept.length, 2)
  })

  test("a lone real meeting is unaffected", () => {
    const meetings: DedupableMeeting[] = [
      { date: "2026-07-21", committeeSlug: "city-council", isPlaceholder: false },
    ]
    const { kept, suppressedCount } = dedupePlaceholderMeetings(meetings)
    assert.strictEqual(suppressedCount, 0)
    assert.strictEqual(kept.length, 1)
  })
})
