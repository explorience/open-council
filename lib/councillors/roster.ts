/**
 * Councillor roster generation for the chatbot's anti-hallucination
 * allow-list.
 *
 * BUG FIX (2026-08): server/system-prompt.ts used to embed a hand-typed
 * "Current Council (2022-2026)" table plus a "Former Councillors" list.
 * That goes stale the moment the council term changes (e.g. the Oct 2026
 * election) - it would keep vouching for defeated incumbents and would
 * reject the names of newly-elected councillors, both of which are exactly
 * the kind of hallucination-guard failure this list exists to prevent.
 *
 * This module derives the same table from data/councillors/registry.json
 * (the source of truth already used elsewhere in the codebase), computed
 * against a supplied "as of" date instead of a hardcoded year. Once
 * registry.json is updated with new/ended terms after an election, this
 * output updates automatically with no code change required.
 */

import type { CouncillorInfo, CouncillorRegistry, CouncillorTerm } from "./types.js"

export interface RosterEntry {
  canonicalName: string
  info: CouncillorInfo
  activeTerm: CouncillorTerm
}

/**
 * The term (if any) covering the given year for this councillor.
 * Terms are recorded at year granularity (e.g. {start: 2022, end: 2026}),
 * so "covers `year`" means start <= year <= end.
 */
export function getTermCoveringYear(info: CouncillorInfo, year: number): CouncillorTerm | null {
  return info.terms.find(t => t.start <= year && t.end >= year) ?? null
}

/**
 * Split the registry into "current" (has a term covering `asOf`'s year)
 * and "former" (no term covers it) councillors.
 *
 * Uses `asOf`'s UTC year rather than local time, so this doesn't flip a
 * councillor between current/former depending on which timezone the
 * server (or a test) happens to run in - most concretely around New
 * Year's, where a term ending in year N would otherwise appear to have
 * already ended (or not yet) purely based on the host machine's offset
 * from UTC.
 */
export function partitionRoster(
  registry: CouncillorRegistry,
  asOf: Date = new Date()
): { current: RosterEntry[]; former: Array<{ canonicalName: string; info: CouncillorInfo }> } {
  const year = asOf.getUTCFullYear()
  const current: RosterEntry[] = []
  const former: Array<{ canonicalName: string; info: CouncillorInfo }> = []

  for (const [canonicalName, info] of Object.entries(registry)) {
    const activeTerm = getTermCoveringYear(info, year)
    if (activeTerm) {
      current.push({ canonicalName, info, activeTerm })
    } else {
      former.push({ canonicalName, info })
    }
  }

  // Mayor first, then by ward ascending.
  current.sort((a, b) => {
    if (a.activeTerm.role === "Mayor" && b.activeTerm.role !== "Mayor") return -1
    if (b.activeTerm.role === "Mayor" && a.activeTerm.role !== "Mayor") return 1
    return (a.activeTerm.ward ?? Number.MAX_SAFE_INTEGER) - (b.activeTerm.ward ?? Number.MAX_SAFE_INTEGER)
  })

  // Most recently departed first, then alphabetically.
  former.sort((a, b) => {
    const aEnd = Math.max(...a.info.terms.map(t => t.end))
    const bEnd = Math.max(...b.info.terms.map(t => t.end))
    if (aEnd !== bEnd) return bEnd - aEnd
    return a.canonicalName.localeCompare(b.canonicalName)
  })

  return { current, former }
}

/**
 * Build the "COUNCILLOR NAMES - NEVER HALLUCINATE" roster markdown block
 * (current-council table + former-councillors list) used in the static
 * system prompt, generated live from registry.json instead of hardcoded.
 */
export function buildCouncillorRosterSection(
  registry: CouncillorRegistry,
  asOf: Date = new Date()
): string {
  const { current, former } = partitionRoster(registry, asOf)
  const dateLabel = asOf.toISOString().split("T")[0]

  const tableRows = current
    .map(({ canonicalName, info, activeTerm }) => {
      const role = activeTerm.role === "Mayor" ? "Mayor" : `Ward ${activeTerm.ward ?? "?"}`
      return `| ${canonicalName} | ${info.displayName} | ${role} |`
    })
    .join("\n")

  const formerList = former.map(({ canonicalName }) => canonicalName).join(", ")

  return `### Current Council (as of ${dateLabel}):
| Name | Full Name | Role |
|------|-----------|------|
${tableRows}

### Former Councillors (may appear in older records):
${formerList}`
}
