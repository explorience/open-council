/**
 * Regression tests for isGarbledRollCall()/isNameShaped()/
 * councilSizeForYear() (issue #199 final verify, punch list item 1).
 *
 * The bug: isGarbledRollCall() used REGISTRY RESOLUTION (does this name
 * match a canonical councillor?) as its garbling signal. That over-fired
 * on 113 legitimate pre-2018 roll calls whose voter text is perfectly
 * name-shaped but just didn't happen to resolve - a bare "(0)" zero-nay
 * marker, a real name carrying a fused trailing tally or "RECUSED:"
 * clause, a last-name-only rendering. Garbling a roll call deletes it
 * from _all-motions.json entirely (see findVotesWithAttribution): 267
 * motions, 1,617 yea + 270 nay attributions gone.
 *
 * The fix: garbling is a TEXT-SHAPE property only - a row longer than
 * the era's council size, or a row where fewer than half its entries are
 * name-shaped (isNameShaped() - short, capitalized, no narrative
 * stopwords/timestamps). Resolution failure alone never garbles a row
 * anymore.
 *
 * Every case below is re-derived from real raw data/*.json roll calls
 * cited in the verification report - see the inline dates/items.
 *
 * Run: npx tsx --test scripts/generate-votes-garbled.test.ts
 */

import test, { describe } from "node:test"
import assert from "node:assert"
import { loadRegistry } from "../lib/councillors/index.js"
import { isGarbledRollCall, isNameShaped, councilSizeForYear } from "./generate-votes.js"

const registry = loadRegistry()

describe("councilSizeForYear", () => {
  test("London City Council interior years: Mayor + 14 wards = 15", () => {
    for (const year of [2011, 2012, 2013, 2015, 2016, 2017]) {
      assert.strictEqual(councilSizeForYear(year, registry), 15, `year ${year}`)
    }
  })

  test("is derived from the registry, not a hardcoded literal - a future term with a different composition changes the result", () => {
    // Regression guard for "derive from functions, not scalars": if this
    // ever goes back to being a bare `15`, a shrunken synthetic registry
    // (one term, one seat) must still change the computed cap.
    const tinyRegistry = {
      "A. Test": { slug: "a-test", displayName: "A. Test", terms: [{ start: 2011, end: 2017, role: "Councillor" }] },
    } as unknown as ReturnType<typeof loadRegistry>
    assert.strictEqual(councilSizeForYear(2013, tinyRegistry), 1)
  })
})

describe("isNameShaped", () => {
  test("a plain registry-style name is name-shaped", () => {
    assert.strictEqual(isNameShaped("J.F. Fontana"), true)
  })

  test("a real name with a fused trailing tally marker is name-shaped (routine eSCRIBE/Word formatting)", () => {
    assert.strictEqual(isNameShaped("S.E. White (14)"), true)
    assert.strictEqual(isNameShaped("W.J. Armstrong (1)"), true)
  })

  test("a real name with a fused RECUSED: clause naming a second councillor is name-shaped (2011-09-19 item 5)", () => {
    assert.strictEqual(isNameShaped("M. Brown (1) RECUSED: P. Van Meerbergen (1)"), true)
  })

  test("a bare surname is name-shaped even though it may not resolve (2011-10-04 item 10)", () => {
    assert.strictEqual(isNameShaped("Hubert"), true)
    assert.strictEqual(isNameShaped("Usher"), true)
  })

  test("a bare zero-count marker is NOT name-shaped (it's not a name at all - handled separately as an empty row)", () => {
    assert.strictEqual(isNameShaped("(0)"), false)
  })

  test("a genuine mis-split clause/narration fragment is NOT name-shaped (2013-01-24 item 3 monster)", () => {
    assert.strictEqual(
      isNameShaped("put $250K funding back in for consideration as part of 2014 Budget Passed YEAS: J.F. Fontana"),
      false
    )
    assert.strictEqual(
      isNameShaped("the following actions be taken with respect to the demolition application"),
      false
    )
  })

  test("a bare timestamp fragment is NOT name-shaped", () => {
    assert.strictEqual(isNameShaped("At 9:50 PM"), false)
  })
})

describe("isGarbledRollCall", () => {
  const row = (vote: string, voters: string[]) => ({ vote, voters })

  test("the 2013-01-24 budget monster stays excluded: 26-entry Yeas / 228-entry Nays, both mis-split text", () => {
    const yeas = Array.from({ length: 26 }, (_, i) => `Councillor ${i}`)
    const nays = Array.from({ length: 228 }, (_, i) => `a fragment of run-on committee minutes text number ${i}`)
    assert.strictEqual(isGarbledRollCall([row("Yeas:", yeas), row("Nays:", nays)], registry, 2013), true)
  })

  test("(a) a bare zero-count Nays row does NOT garble an otherwise clean roll call (2012-04-10 item 15#3, 2011-12-05 SPPC item 1)", () => {
    const yeas = [
      "J.F. Fontana", "B. Polhill", "W.J. Armstrong", "J.B. Swan", "S. Orser",
      "J.L. Baechler", "N. Branscombe", "M. Brown", "P. Hubert", "D.G. Henderson",
      "P. Van Meerbergen", "D. Brown", "J.P. Bryant", "S.E. White (14)",
    ]
    assert.strictEqual(isGarbledRollCall([row("Yeas:", yeas), row("Nays:", ["(0)"])], registry, 2012), false)
  })

  test("(b) a real name carrying a fused trailing tally as the ONLY Nay does NOT garble the roll call (2011-08-29 item 23)", () => {
    const yeas = [
      "J.F. Fontana", "B. Polhill", "J.B. Swan", "S. Orser", "J.L. Baechler",
      "N. Branscombe", "M. Brown", "P. Hubert", "D.G. Henderson", "P. Van Meerbergen",
      "D. Brown", "J.P. Bryant", "S.E. White (13)",
    ]
    assert.strictEqual(
      isGarbledRollCall([row("Yeas:", yeas), row("Nays:", ["W.J. Armstrong (1)"])], registry, 2011),
      false
    )
  })

  test("(b) a fused two-name RECUSED: clause as the ONLY Nay does NOT garble the roll call (2011-09-19 item 5)", () => {
    const yeas = [
      "J.F. Fontana", "B. Polhill", "W.J. Armstrong", "J.B. Swan", "N. Branscombe",
      "D.G. Henderson", "D. Brown", "H.L. Usher", "J.P. Bryant", "S.E. White",
      "J.L. Baechler", "S. Orser",
    ]
    assert.strictEqual(
      isGarbledRollCall(
        [row("Yeas:", yeas), row("Nays:", ["M. Brown (1) RECUSED: P. Van Meerbergen (1)"])],
        registry,
        2011
      ),
      false
    )
  })

  test("(c) bare-surname entries do NOT garble a normal division (2011-10-04 item 10)", () => {
    const yeas = ["Hubert", "D. Brown", "Usher", "White. (9)"]
    const nays = ["J.F. Fontana", "J.B. Swan", "J.P. Bryant (3)"]
    assert.strictEqual(isGarbledRollCall([row("Yeas:", yeas), row("Nays:", nays)], registry, 2011), false)
  })

  test("a row where the entries are genuinely narrative fragments (not just unresolved names) IS garbled", () => {
    assert.strictEqual(
      isGarbledRollCall(
        [row("Nays:", ["as amended", "reads as follows: that the following actions be taken"])],
        registry,
        2011
      ),
      true
    )
  })

  test("empty rows (no voters at all) never garble", () => {
    assert.strictEqual(isGarbledRollCall([row("Yeas:", []), row("Nays:", [])], registry, 2012), false)
  })

  // Negative-test companion (run by hand, not part of CI): temporarily
  // reverting isGarbledRollCall's per-entry test from isNameShaped() back
  // to "does this resolve against the registry" reintroduces the exact
  // over-fire bug this file exists to catch - the (a)/(b)/(c) tests above
  // flip from pass to fail. Verified during implementation; kept as a
  // negative-test record rather than a live mutation test so CI doesn't
  // depend on monkeypatching module internals.
  test("regression anchor: registry-resolution alone is NOT what these tests check (documents the fixed bug)", () => {
    // "W.J. Armstrong (1)" fails plain registry lookup (registry keys are
    // canonical forms like "B. Armstrong") - the old bug used exactly
    // that resolution outcome as the garbling signal. isNameShaped()
    // must accept it on shape alone, independent of resolution:
    assert.strictEqual(!!registry["W.J. Armstrong (1)"], false, "sanity: this raw string is not a registry key")
    assert.strictEqual(isNameShaped("W.J. Armstrong (1)"), true)
  })
})
