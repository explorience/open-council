import test, { describe } from "node:test"
import assert from "node:assert"
import {
  classifyVoteType,
  isParticipatingVote,
  isMotionTextTruncated,
  hasRecordedDissent,
  isProcedural,
  MOTION_TEXT_TRUNCATION_MARKER,
  type VoteType,
} from "./vote-type.js"

describe("classifyVoteType", () => {
  test("classifies real yea/nay labels", () => {
    assert.strictEqual(classifyVoteType("Yeas:"), "yea")
    assert.strictEqual(classifyVoteType("Nays:"), "nay")
  })

  test("classifies true absences", () => {
    assert.strictEqual(classifyVoteType("Absent:"), "absent")
    assert.strictEqual(classifyVoteType("Absent"), "absent")
    // Observed scraper variants with trailing vote-count fragments
    assert.strictEqual(classifyVoteType("Absent(0.00"), "absent")
    assert.strictEqual(classifyVoteType("Absent(7.14"), "absent")
  })

  test("classifies pecuniary-interest recusal as recuse, NOT absent", () => {
    assert.strictEqual(classifyVoteType("Recuse:"), "recuse")
  })

  test("classifies declared conflict of interest as recuse, NOT absent", () => {
    assert.strictEqual(classifyVoteType("Conflict"), "recuse")
  })

  test("classifies abstentions as abstain, NOT absent", () => {
    assert.strictEqual(classifyVoteType("Abstain(0.00"), "abstain")
    assert.strictEqual(classifyVoteType("Abstain"), "abstain")
  })

  test("classifies unrecognized scraper noise as other, NOT absent", () => {
    // Real noise observed in data/*/*.json: stray first names, generic
    // "Councillor" labels from a broken multi-candidate appointment
    // ballot format, page-number-looking fragments.
    const noiseLabels = ["Susan", "David", "Councillor", "1.", "S.", "Mike"]
    for (const label of noiseLabels) {
      assert.strictEqual(
        classifyVoteType(label),
        "other",
        `expected "${label}" to classify as "other", not be silently bucketed as absent`
      )
    }
  })

  test("never classifies a non-yea/nay/absent label as absent (regression guard)", () => {
    const nonAbsentLabels = ["Recuse:", "Conflict", "Abstain(0.00", "Councillor", "Susan"]
    for (const label of nonAbsentLabels) {
      assert.notStrictEqual(
        classifyVoteType(label),
        "absent",
        `"${label}" must not be classified as absent`
      )
    }
  })

  test("handles null/undefined/empty gracefully", () => {
    assert.strictEqual(classifyVoteType(null), "other")
    assert.strictEqual(classifyVoteType(undefined), "other")
    assert.strictEqual(classifyVoteType(""), "other")
  })

  test("is case-insensitive", () => {
    assert.strictEqual(classifyVoteType("YEAS:"), "yea")
    assert.strictEqual(classifyVoteType("recuse:"), "recuse")
    assert.strictEqual(classifyVoteType("ABSTAIN"), "abstain")
  })
})

describe("isMotionTextTruncated", () => {
  test("detects the new explicit truncation marker", () => {
    assert.strictEqual(
      isMotionTextTruncated(`Some cut-off text${MOTION_TEXT_TRUNCATION_MARKER}`),
      true
    )
  })

  test("detects the legacy (pre-marker) hard truncation length (exactly 500 chars)", () => {
    // The ~199k data/votes/*.json records already committed were generated under the
    // OLD 500-char cap with no marker, before this fix raised the cap to 2000 and
    // started appending MOTION_TEXT_TRUNCATION_MARKER. Regenerating that dataset is out
    // of scope for this fix, so this legacy heuristic is what actually prevents those
    // records from being mislabeled "Full Motion Text" in production today.
    assert.strictEqual(isMotionTextTruncated("x".repeat(500)), true)
  })

  test("does not flag ordinary short/complete motion text", () => {
    assert.strictEqual(isMotionTextTruncated("That the motion BE APPROVED."), false)
    assert.strictEqual(isMotionTextTruncated("x".repeat(499)), false)
    assert.strictEqual(isMotionTextTruncated("x".repeat(501)), false)
  })

  test("handles null/undefined/empty gracefully", () => {
    assert.strictEqual(isMotionTextTruncated(null), false)
    assert.strictEqual(isMotionTextTruncated(undefined), false)
    assert.strictEqual(isMotionTextTruncated(""), false)
  })
})

describe("isParticipatingVote", () => {
  test("yea and nay are participating votes", () => {
    assert.strictEqual(isParticipatingVote("yea"), true)
    assert.strictEqual(isParticipatingVote("nay"), true)
  })

  test("absent, recuse, abstain, and other are not participating votes", () => {
    const nonParticipating: VoteType[] = ["absent", "recuse", "abstain", "other"]
    for (const vt of nonParticipating) {
      assert.strictEqual(isParticipatingVote(vt), false, `${vt} should not be a participating vote`)
    }
  })
})

// issue #199 final verify, punch list item 2: generate-stats.ts's
// `v.unanimousSource === "votes"` regression (never true for a 2018+
// tally-derived record -> 1,046 divided motions wrongly flagged
// procedural). hasRecordedDissent() is the shared signal that replaced
// it, matching generate-votes.ts's `nays.length > 0` exactly.
describe("hasRecordedDissent", () => {
  test("tally records: dissent tracks !unanimous exactly (2018+ eSCRIBE, always a tally)", () => {
    assert.strictEqual(hasRecordedDissent("tally", false), true) // e.g. "(8 to 7)"
    assert.strictEqual(hasRecordedDissent("tally", true), false) // e.g. "(15 to 0)"
  })

  test("votes records: always confirmed dissent, regardless of `unanimous`", () => {
    // "votes" is only ever set by generate-votes.ts's parseResult() when a
    // resolvable Nay was actually found - `unanimous` alongside it is
    // always false in real data, but the signal must not depend on that.
    assert.strictEqual(hasRecordedDissent("votes", false), true)
  })

  test("unresolved records: NOT confirmed dissent, even though unanimous is false", () => {
    // "unresolved" means either the roll call was demoted as garbled (no
    // per-councillor records at all) or a Nay row named voters that all
    // failed to resolve - real, recorded dissent, but not attributable to
    // a specific councillor, so it must not count as "confirmed".
    assert.strictEqual(hasRecordedDissent("unresolved", false), false)
  })

  test("unknown records: presumed unanimous, never dissent", () => {
    assert.strictEqual(hasRecordedDissent("unknown", true), false)
  })

  test("undefined unanimousSource (legacy/malformed record): never dissent", () => {
    assert.strictEqual(hasRecordedDissent(undefined, false), false)
  })

  // THE regression this replaces: `unanimousSource === "votes"` alone is
  // NEVER true for a 2018+ record (always "tally"), so it silently
  // treated every genuinely divided 2018+ motion as having no dissent -
  // reintroducing that exact defect here must fail this test.
  test("negative: the old buggy `unanimousSource === \"votes\"` signal misses all tally-sourced dissent", () => {
    const buggySignal = (unanimousSource: string | undefined, _unanimous: boolean) => unanimousSource === "votes"
    // A real 2018+ divided motion: unanimousSource "tally", unanimous false.
    assert.strictEqual(buggySignal("tally", false), false, "the buggy signal wrongly reports no dissent")
    assert.strictEqual(hasRecordedDissent("tally", false), true, "the fixed signal correctly reports dissent")
  })
})

describe("isProcedural with hasRecordedDissent (generate-stats.ts's actual call shape)", () => {
  test("a boilerplate-text 2018+ motion with confirmed tally dissent is NOT procedural", () => {
    // e.g. 2026-07-21 item 13, "That Introduction and First Reading of
    // Bill No. 268 BE APPROVED.", nays=2 (issue #199 final verify).
    const motionText = "That Introduction and First Reading of Bill No. 268 BE APPROVED."
    assert.strictEqual(isProcedural(motionText, hasRecordedDissent("tally", false)), false)
  })

  test("the same boilerplate text with NO dissent (unanimous tally) IS procedural", () => {
    const motionText = "That Introduction and First Reading of Bill No. 268 BE APPROVED."
    assert.strictEqual(isProcedural(motionText, hasRecordedDissent("tally", true)), true)
  })
})
