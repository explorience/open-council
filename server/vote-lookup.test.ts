/**
 * Unit tests for the chatbot-facing vote formatting in server/vote-lookup.ts.
 *
 * These use synthetic fixtures (not real file-backed data) so they don't
 * depend on data/votes/*.json state, and specifically lock in that a
 * recusal/abstention/unrecognized vote is NEVER rendered as "ABSENT" in
 * text the chatbot sends to users - the exact defect described in Bug 1.
 */

import test, { describe } from "node:test"
import assert from "node:assert"
import { voteLookupService, type MotionVotesResult, type VoteRecord, type VoteLookupResult } from "./vote-lookup.js"

function makeMotionResult(overrides: Partial<MotionVotesResult> = {}): MotionVotesResult {
  return {
    motionTitle: "Test Motion",
    motionText: "That the test motion BE APPROVED.",
    date: "2026-07-21",
    meetingTitle: "12th Meeting of Council",
    result: "Motion Passed (12 to 2)",
    passed: true,
    yeas: ["Josh Morgan"],
    nays: ["Shawn Lewis"],
    absent: [],
    recused: [],
    abstained: [],
    other: [],
    ...overrides,
  }
}

describe("formatMotionVotesForContext: recuse/abstain/other are never rendered as absent", () => {
  test("a recusal is labeled as recused, not absent", () => {
    const result = makeMotionResult({ recused: ["Paul Van Meerbergen"] })
    const text = voteLookupService.formatMotionVotesForContext(result)

    assert.match(text, /Recused - declared conflict of interest \(1\):.*Paul Van Meerbergen/s)
    assert.doesNotMatch(text, /Paul Van Meerbergen.*Absent/s)
  })

  test("an abstention is labeled as abstained, not absent", () => {
    const result = makeMotionResult({ abstained: ["Sam Trosow"] })
    const text = voteLookupService.formatMotionVotesForContext(result)

    assert.match(text, /Abstained \(1\):.*Sam Trosow/s)
    assert.doesNotMatch(text, /Sam Trosow.*Absent/s)
  })

  test("an unrecognized vote label is surfaced as other/unrecorded, not silently dropped or marked absent", () => {
    const result = makeMotionResult({ other: ["Susan Stevenson"] })
    const text = voteLookupService.formatMotionVotesForContext(result)

    assert.match(text, /Other\/unrecorded vote \(1\):.*Susan Stevenson/s)
    assert.doesNotMatch(text, /Susan Stevenson.*Absent/s)
  })

  test("a genuine absence is still labeled Absent (regression guard: fix must not blank out real absences)", () => {
    const result = makeMotionResult({ absent: ["Elizabeth Peloza"] })
    const text = voteLookupService.formatMotionVotesForContext(result)

    assert.match(text, /Absent \(1\):.*Elizabeth Peloza/)
  })

  test("includes an explicit warning that recusal is not the same as absence", () => {
    const result = makeMotionResult({ recused: ["Paul Van Meerbergen"] })
    const text = voteLookupService.formatMotionVotesForContext(result)
    assert.match(text, /NOT the same as being absent/i)
  })
})

describe("formatAllMotionVotesForContext: recuse/abstain/other are never rendered as absent", () => {
  test("a recusal on one of two related motions is labeled as recused, not absent", () => {
    const results: MotionVotesResult[] = [
      makeMotionResult({ passed: false, recused: ["Paul Van Meerbergen"] }),
      makeMotionResult({ passed: true }),
    ]
    const text = voteLookupService.formatAllMotionVotesForContext(results)

    assert.match(text, /Recused - declared conflict of interest \(1\):.*Paul Van Meerbergen/)
    // "Van Meerbergen" must never appear on the same line as an Absent tally.
    const absentLines = text.split("\n").filter(line => line.includes("**Absent"))
    for (const line of absentLines) {
      assert.doesNotMatch(line, /Van Meerbergen/, `Van Meerbergen must not appear on an Absent line: "${line}"`)
    }
  })
})

describe("formatVoteForContext: per-councillor vote word is never 'ABSENT' for a recusal/abstention", () => {
  function makeVoteLookupResult(vote: VoteRecord["vote"]): VoteLookupResult {
    return {
      councillor: "Paul Van Meerbergen",
      councillorSlug: "p-van-meerbergen",
      confidence: "exact",
      vote: {
        date: "2026-07-21",
        meetingSlug: "months/2026-07/2026-07-21 12th Meeting of Council",
        meetingTitle: "12th Meeting of Council",
        meetingType: "Council",
        itemTitle: "Bill No. 267",
        motionText: "That Introduction and First Reading of Bill No. 267 BE APPROVED.",
        vote,
        result: "Motion Passed",
        passed: true,
        unanimous: false,
      },
    }
  }

  test("recuse renders as RECUSED, not ABSENT", () => {
    const text = voteLookupService.formatVoteForContext(makeVoteLookupResult("recuse"))
    assert.match(text, /\*\*Vote:\*\* RECUSED/)
    assert.doesNotMatch(text, /\*\*Vote:\*\* ABSENT/)
  })

  test("abstain renders as ABSTAINED, not ABSENT", () => {
    const text = voteLookupService.formatVoteForContext(makeVoteLookupResult("abstain"))
    assert.match(text, /\*\*Vote:\*\* ABSTAINED/)
    assert.doesNotMatch(text, /\*\*Vote:\*\* ABSENT/)
  })

  test("an unrecognized ('other') vote label does not silently render as ABSENT", () => {
    const text = voteLookupService.formatVoteForContext(makeVoteLookupResult("other"))
    assert.doesNotMatch(text, /\*\*Vote:\*\* ABSENT/)
  })

  test("a genuine absence still renders as ABSENT (regression guard)", () => {
    const text = voteLookupService.formatVoteForContext(makeVoteLookupResult("absent"))
    assert.match(text, /\*\*Vote:\*\* ABSENT/)
  })
})
