import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import {
  buildCouncillorRosterSection,
  partitionRoster,
  getTermCoveringYear,
} from "./roster.js"
import type { CouncillorRegistry } from "./types.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// A small synthetic registry standing in for data/councillors/registry.json,
// so these tests don't depend on (or need updating for) the real roster.
const SYNTHETIC_REGISTRY: CouncillorRegistry = {
  "J. Morgan": {
    displayName: "Josh Morgan",
    slug: "j-morgan",
    terms: [
      { start: 2014, end: 2022, role: "Councillor", ward: 7 },
      { start: 2022, end: 2026, role: "Mayor" },
    ],
  },
  "S. Lewis": {
    displayName: "Shawn Lewis",
    slug: "s-lewis",
    terms: [{ start: 2018, end: 2026, role: "Councillor", ward: 2 }],
  },
  "H. McAlister": {
    displayName: "Hadleigh McAlister",
    slug: "h-mcalister",
    terms: [{ start: 2022, end: 2026, role: "Councillor", ward: 1 }],
  },
  "E. Holder": {
    displayName: "Ed Holder",
    slug: "e-holder",
    terms: [{ start: 2018, end: 2022, role: "Mayor" }],
  },
  "M. Salih": {
    displayName: "Mo Salih",
    slug: "m-salih",
    terms: [{ start: 2018, end: 2022, role: "Councillor", ward: 3 }],
  },
}

describe("getTermCoveringYear", () => {
  test("finds the term that covers the given year", () => {
    const morgan = SYNTHETIC_REGISTRY["J. Morgan"]
    assert.deepStrictEqual(getTermCoveringYear(morgan, 2026), { start: 2022, end: 2026, role: "Mayor" })
    assert.deepStrictEqual(getTermCoveringYear(morgan, 2018), {
      start: 2014,
      end: 2022,
      role: "Councillor",
      ward: 7,
    })
  })

  test("returns null when no term covers the year", () => {
    const holder = SYNTHETIC_REGISTRY["E. Holder"]
    assert.strictEqual(getTermCoveringYear(holder, 2026), null)
  })
})

describe("partitionRoster", () => {
  test("splits current vs former based on the supplied date's year, not a hardcoded year", () => {
    const { current, former } = partitionRoster(SYNTHETIC_REGISTRY, new Date("2026-08-22"))
    const currentNames = current.map(c => c.canonicalName).sort()
    const formerNames = former.map(f => f.canonicalName).sort()

    assert.deepStrictEqual(currentNames, ["H. McAlister", "J. Morgan", "S. Lewis"])
    assert.deepStrictEqual(formerNames, ["E. Holder", "M. Salih"])
  })

  test("BUG 3 regression: after an election year passes, yesterday's current councillor becomes former WITHOUT a code change - only the date argument changes", () => {
    // Simulates "today" being well after the 2022-2026 term ends, with NO
    // registry update yet (the real-world gap between an election and
    // someone updating registry.json). This is the exact staleness Bug 3
    // is about: the old hardcoded table in system-prompt.ts would keep
    // vouching for these three forever. The registry-derived version must
    // re-derive correctly the moment `asOf` (i.e. "today") moves past the
    // term's end year, using ONLY the date - the registry.json content is
    // identical to the "current" test above.
    const { current, former } = partitionRoster(SYNTHETIC_REGISTRY, new Date("2027-01-01"))
    const currentNames = current.map(c => c.canonicalName)
    assert.deepStrictEqual(currentNames, [], "nobody's term (ending 2026) covers 2027 in this synthetic registry")
    assert.ok(former.some(f => f.canonicalName === "J. Morgan"), "Morgan must now show as former once his term's end year has passed")
  })

  test("sorts current councillors Mayor-first, then by ward ascending", () => {
    const { current } = partitionRoster(SYNTHETIC_REGISTRY, new Date("2026-08-22"))
    const order = current.map(c => c.canonicalName)
    assert.deepStrictEqual(order, ["J. Morgan", "H. McAlister", "S. Lewis"])
  })
})

describe("buildCouncillorRosterSection", () => {
  test("only includes names present in the supplied registry (never invents names)", () => {
    const section = buildCouncillorRosterSection(SYNTHETIC_REGISTRY, new Date("2026-08-22"))
    // Current-council table rows carry both canonical and display names.
    for (const name of ["Josh Morgan", "Shawn Lewis", "Hadleigh McAlister"]) {
      assert.ok(section.includes(name), `expected roster section to include "${name}"`)
    }
    // Former-councillors list uses canonical (short) names only, matching
    // the original hand-typed format's convention.
    for (const name of ["E. Holder", "M. Salih"]) {
      assert.ok(section.includes(name), `expected roster section to include "${name}"`)
    }
    // Sanity: nothing outside the synthetic registry leaks in.
    assert.ok(!section.includes("Paul Van Meerbergen"))
  })

  test("current-council table and former-councillors list are both present", () => {
    const section = buildCouncillorRosterSection(SYNTHETIC_REGISTRY, new Date("2026-08-22"))
    assert.match(section, /### Current Council/)
    assert.match(section, /### Former Councillors/)
    assert.match(section, /\| J\. Morgan \| Josh Morgan \| Mayor \|/)
    assert.match(section, /\| S\. Lewis \| Shawn Lewis \| Ward 2 \|/)
  })

  test("membership shifts correctly across an election boundary using only the date argument", () => {
    const before = buildCouncillorRosterSection(SYNTHETIC_REGISTRY, new Date("2026-08-22"))
    const after = buildCouncillorRosterSection(SYNTHETIC_REGISTRY, new Date("2027-01-01"))

    // Before the term ends, Morgan is in the Current table.
    assert.match(before, /### Current Council[\s\S]*Josh Morgan[\s\S]*### Former/)
    // After it ends (per this synthetic registry's term data), Morgan has
    // moved to Former - with no code change, just a different "as of" date.
    const afterCurrentSection = after.split("### Former Councillors")[0]
    assert.ok(!afterCurrentSection.includes("Josh Morgan"), "Morgan must not still be listed as current after his term's end year")
    assert.match(after, /### Former Councillors[\s\S]*J\. Morgan/)
  })
})

describe("integration: the real data/councillors/registry.json", () => {
  test("generates a non-empty, well-formed roster from the actual registry (smoke test)", () => {
    const registryPath = path.join(__dirname, "..", "..", "data", "councillors", "registry.json")
    const registry: CouncillorRegistry = JSON.parse(fs.readFileSync(registryPath, "utf-8"))

    const section = buildCouncillorRosterSection(registry, new Date("2026-08-22"))
    const { current, former } = partitionRoster(registry, new Date("2026-08-22"))

    assert.ok(current.length > 0, "expected at least one current councillor")
    assert.ok(former.length > 0, "expected at least one former councillor")
    assert.match(section, /### Current Council/)
    assert.match(section, /### Former Councillors/)

    // Every current councillor's canonical name and display name must
    // appear verbatim in the generated section - this is the actual
    // anti-hallucination guarantee Bug 3 is about.
    for (const { canonicalName, info } of current) {
      assert.ok(section.includes(canonicalName), `missing canonical name "${canonicalName}" in generated roster`)
      assert.ok(section.includes(info.displayName), `missing display name "${info.displayName}" in generated roster`)
    }
  })
})
