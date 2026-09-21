/**
 * Division wall — shared derivations over data/frontpage/division-wall.json
 *
 * Pure functions used by FrontpageWall.tsx at Quartz build time to derive
 * everything the spec says must NOT be separately stored: wallCount, the
 * "decided by two votes or fewer" count, and the closest-20 table. The
 * generator (scripts/generate-frontpage-data.ts) only ever writes the raw
 * chronological records array — this is the one place that turns it into
 * those derived views, so there's exactly one implementation of the
 * closest-20 sort key.
 */

// [date, yea, nay, passed, title, issue, url] — mirrors
// scripts/generate-frontpage-data.ts's DivisionWallRecord exactly. Kept as
// a separate local type (not imported from the scripts/ tree) so this
// component module doesn't reach across into the build-scripts side of
// the repo at runtime — the shape is small and stable enough that
// duplicating the type declaration (not the data) is the right tradeoff.
export type DivisionWallRecord = [
  date: string,
  yea: number,
  nay: number,
  passed: 0 | 1,
  title: string,
  issue: string,
  url: string,
]

export interface DivisionWallFile {
  cutoffDate: string
  recordCount: number
  records: DivisionWallRecord[]
}

export const ISSUE_NAMES: Record<string, string> = {
  housing: "Housing",
  budget: "Budget",
  encampments: "Homelessness & Encampments",
  transit: "Transit",
  climate: "Climate",
  downtown: "Downtown",
  policing: "Policing",
  bikes: "Bike Infrastructure",
  other: "Other",
}

export function issueName(slug: string): string {
  return ISSUE_NAMES[slug] ?? ISSUE_NAMES.other
}

export function margin(r: DivisionWallRecord): number {
  return Math.abs(r[1] - r[2])
}

/** Records decided by a margin of two votes or fewer. */
export function decidedByTwoOrFewer(records: DivisionWallRecord[]): number {
  return records.filter((r) => margin(r) <= 2).length
}

/**
 * The twenty closest votes: margin ascending, then total votes cast
 * (yea+nay) descending — a 7-7 tie ranks as "closer" than a 2-2 tie
 * despite both having margin 0, because more councillors were engaged —
 * then date ascending. Verified (see spec) to reproduce the approved
 * prototype's 20 rows exactly, including which 21st near-tie is dropped.
 * Does not mutate the input array.
 */
export function deriveClosest20(records: DivisionWallRecord[]): DivisionWallRecord[] {
  return [...records]
    .sort((a, b) => {
      const marginDiff = margin(a) - margin(b)
      if (marginDiff !== 0) return marginDiff
      const totalDiff = b[1] + b[2] - (a[1] + a[2])
      if (totalDiff !== 0) return totalDiff
      return a[0].localeCompare(b[0])
    })
    .slice(0, 20)
}

/** "20230109" -> "Jan 9, 2023" */
export function formatWallDate(yyyymmdd: string): string {
  const y = yyyymmdd.slice(0, 4)
  const m = yyyymmdd.slice(4, 6)
  const d = yyyymmdd.slice(6, 8)
  const date = new Date(`${y}-${m}-${d}T00:00:00`)
  return date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })
}
