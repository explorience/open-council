/**
 * Regression test for the COMMITTEE_MAPPINGS key-ordering bug in
 * scripts/generate-pages.ts's extractCommittee().
 *
 * Before the fix, extractCommittee() returned the FIRST pattern in
 * COMMITTEE_MAPPINGS' object-insertion order whose text appeared as a
 * substring of the meeting title, not the most specific (longest) match.
 * "corporate services" is a substring of "infrastructure and corporate
 * services" and comes earlier in the map, so every Infrastructure and
 * Corporate Services Committee (ICSC) meeting was misfiled as a plain
 * Corporate Services Committee meeting - and ICSC had no committee page
 * of its own at all. A second collision ("budget" preceding "council")
 * misfiled "19th Special Meeting of City Council - BUDGET" under Budget
 * Committee instead of City Council.
 *
 * Verified against the full corpus (data/*.json, cross-checked against
 * eSCRIBE's own meeting_type field) before landing this fix: exactly 40
 * meetings flip from wrong to correct, 0 regressions.
 */

import test, { describe } from "node:test"
import assert from "node:assert"
import { extractCommittee } from "./generate-pages.js"

describe("extractCommittee: longest-match wins, not first-in-insertion-order", () => {
  test("Infrastructure and Corporate Services Committee is NOT folded into Corporate Services", () => {
    const result = extractCommittee("13th Meeting of the Infrastructure and Corporate Services Committee")
    assert.strictEqual(result?.name, "Infrastructure and Corporate Services Committee")
    assert.strictEqual(result?.slug, "infrastructure-corporate-services")
  })

  test("Infrastructure & Corporate Services Committee (ampersand variant) also resolves correctly", () => {
    const result = extractCommittee("6th Meeting of the Infrastructure & Corporate Services Committee")
    assert.strictEqual(result?.name, "Infrastructure and Corporate Services Committee")
  })

  test("plain Corporate Services Committee still resolves to itself (no false negative from the fix)", () => {
    const result = extractCommittee("15th Meeting of the Corporate Services Committee")
    assert.strictEqual(result?.name, "Corporate Services Committee")
    assert.strictEqual(result?.slug, "corporate-services")
  })

  test("'19th Special Meeting of City Council - BUDGET' resolves to City Council, not Budget Committee", () => {
    const result = extractCommittee("19th Special Meeting of City Council - BUDGET")
    assert.strictEqual(result?.name, "City Council")
    assert.strictEqual(result?.slug, "city-council")
  })

  test("a genuine Budget Committee meeting still resolves to Budget Committee", () => {
    const result = extractCommittee("6th Meeting of the Budget Committee")
    assert.strictEqual(result?.name, "Budget Committee")
  })

  test("plain City Council meetings are unaffected", () => {
    const result = extractCommittee("12th Meeting of Council")
    assert.strictEqual(result?.name, "City Council")
  })

  test("Community and Protective Services Committee is unaffected (not a substring collision)", () => {
    const result = extractCommittee("17th Meeting of the Community and Protective Services Committee")
    assert.strictEqual(result?.name, "Community and Protective Services Committee")
  })

  test("unrecognized title falls through to the 'Meeting of the X' regex fallback, not a hard failure", () => {
    const result = extractCommittee("Meeting of the Made Up Committee")
    assert.strictEqual(result?.name, "Made Up Committee")
  })
})
