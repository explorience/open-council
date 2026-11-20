/**
 * Committee and councillor roster — single source of truth.
 *
 * Pulled out of DashboardView.tsx (which owned these inline before the
 * Front Page v3 build) so a second component (FrontpageWall.tsx, the
 * broadsheet stats column) can show the same Meetings/Committees/
 * Councillors counts without a second, independently-drifting copy of
 * the same nine committees and fifteen councillors. Both components
 * import from here now; there is exactly one array to re-snapshot when
 * these change.
 *
 * Counts snapshotted from content/committees/*.md's `meetingCount`
 * frontmatter after the committee-mapping fix + historical vote/data
 * repair (30 Aug 2026 audit) — they WILL drift again as new meetings are
 * scraped, same as before this move.
 */

export interface Committee {
  name: string
  slug: string
  count?: number
}

export interface Councillor {
  name: string
  slug: string
  role?: string
}

export const committees: Committee[] = [
  { name: "Planning and Environment", slug: "planning-environment", count: 298 },
  { name: "Strategic Priorities and Policy", slug: "strategic-priorities", count: 282 },
  { name: "Corporate Services", slug: "corporate-services", count: 263 },
  { name: "Community and Protective Services", slug: "community-protective-services", count: 209 },
  { name: "Civic Works", slug: "civic-works", count: 203 },
  { name: "City Council", slug: "city-council", count: 185 },
  { name: "Audit Committee", slug: "audit", count: 70 },
  { name: "Infrastructure and Corporate Services", slug: "infrastructure-corporate-services", count: 30 },
  { name: "Budget Committee", slug: "budget", count: 22 },
]

export const councillors: Councillor[] = [
  { name: "J. Morgan", slug: "j-morgan", role: "Mayor" },
  { name: "P. Cuddy", slug: "p-cuddy" },
  { name: "D. Ferreira", slug: "d-ferreira" },
  { name: "S. Franke", slug: "s-franke" },
  { name: "S. Hillier", slug: "s-hillier" },
  { name: "A. Hopkins", slug: "a-hopkins" },
  { name: "S. Lehman", slug: "s-lehman" },
  { name: "S. Lewis", slug: "s-lewis" },
  { name: "H. McAlister", slug: "h-mcalister" },
  { name: "E. Peloza", slug: "e-peloza" },
  { name: "J. Pribil", slug: "j-pribil" },
  { name: "C. Rahman", slug: "c-rahman" },
  { name: "S. Stevenson", slug: "s-stevenson" },
  { name: "S. Trosow", slug: "s-trosow" },
  { name: "P. Van Meerbergen", slug: "p-van-meerbergen" },
]
