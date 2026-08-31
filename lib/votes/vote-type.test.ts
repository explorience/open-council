import test, { describe } from "node:test"
import assert from "node:assert"
import {
  classifyVoteType,
  isParticipatingVote,
  isMotionTextTruncated,
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
