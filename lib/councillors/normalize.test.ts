import test, { describe } from "node:test"
import assert from "node:assert"
import { normalizeCouncillorName } from "./normalize.js"

describe("normalizeCouncillorName: no-space initial (\"X.Surname\")", () => {
  // Regression coverage for the 30 Aug 2026 audit's BLOCKER finding: the
  // committee-mapping fix correctly moved the misfiled "City Council -
  // BUDGET" meeting off Skylar Franke's Budget Committee page, unmasking
  // that her ONLY other Budget attendance record used "S.Franke" (no space
  // after the initial) in the Present: callout, which the old regex
  // rejected outright. Seen ~101 times across the corpus: S.Franke x17,
  // C.Rahman x20, J.Bunn x10, S.Turner x2, M.Brown x2, M.Czechowicz x2,
  // S.Trosow x1, and others.
  test("resolves a currently-registered councillor written with no space after the initial", () => {
    assert.strictEqual(normalizeCouncillorName("S.Franke"), "S. Franke")
    assert.strictEqual(normalizeCouncillorName("C.Rahman"), "C. Rahman")
    assert.strictEqual(normalizeCouncillorName("S.Turner"), "S. Turner")
    assert.strictEqual(normalizeCouncillorName("M.Brown"), "M. Brown")
    assert.strictEqual(normalizeCouncillorName("S.Trosow"), "S. Trosow")
  })

  test("still resolves the already-spaced form (no regression)", () => {
    assert.strictEqual(normalizeCouncillorName("S. Franke"), "S. Franke")
  })

  test("a trailing comma/semicolon from a Present: list is still stripped first", () => {
    assert.strictEqual(normalizeCouncillorName("S.Franke,"), "S. Franke")
  })

  test("still returns null for a genuinely non-councillor name (e.g. a committee secretary)", () => {
    // "J. Bunn (Secretary)" appears in several 2016-2017 Present: callouts
    // and is correctly never a registered councillor - the fix must not
    // start matching arbitrary "Initial.Surname"-shaped strings.
    assert.strictEqual(normalizeCouncillorName("J.Bunn"), null)
  })

  test("bonus: also resolves a councillor whose canonical name has a middle initial (H.L. Usher) via the last-name/initial-compatibility path", () => {
    // Not itself part of the "X.Surname" pattern, but the space-insertion
    // fix incidentally makes split(/\s+/) work correctly here too, where
    // it previously treated the whole no-space string as one token.
    assert.strictEqual(normalizeCouncillorName("H.Usher"), "H.L. Usher")
  })

  test("does not touch a name that already has multiple space-separated parts (e.g. 'M. van Holst')", () => {
    assert.strictEqual(normalizeCouncillorName("M. van Holst"), "M. van Holst")
  })
})
