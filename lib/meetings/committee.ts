/**
 * Committee name extraction, shared between scripts/generate-pages.ts (which
 * builds the committee/year/councillor index pages from meeting titles) and
 * quartz component code (which needs the same committee identity to dedupe
 * placeholder meetings on the homepage - see filter-real-meetings.ts).
 *
 * Moved out of scripts/generate-pages.ts on 2026-08-31 so both callers share
 * one COMMITTEE_MAPPINGS table: two independent copies is exactly how the
 * committee page navigation ended up with two different slugs for the same
 * committee (infrastructure-corporate-services vs infrastructure-corporate)
 * - see the 30 Aug audit's FOLLOW-UP finding on quartz/components/UnifiedHeader.tsx.
 */

// Committee name normalization map
export const COMMITTEE_MAPPINGS: Record<string, { name: string; slug: string }> = {
  "planning and environment": { name: "Planning and Environment Committee", slug: "planning-environment" },
  "planning & environment": { name: "Planning and Environment Committee", slug: "planning-environment" },
  "corporate services": { name: "Corporate Services Committee", slug: "corporate-services" },
  "strategic priorities and policy": { name: "Strategic Priorities and Policy Committee", slug: "strategic-priorities" },
  "strategic priorities & policy": { name: "Strategic Priorities and Policy Committee", slug: "strategic-priorities" },
  "civic works": { name: "Civic Works Committee", slug: "civic-works" },
  "community and protective services": { name: "Community and Protective Services Committee", slug: "community-protective-services" },
  "community & protective services": { name: "Community and Protective Services Committee", slug: "community-protective-services" },
  "audit": { name: "Audit Committee", slug: "audit" },
  "audit committee": { name: "Audit Committee", slug: "audit" },
  "budget": { name: "Budget Committee", slug: "budget" },
  "budget committee": { name: "Budget Committee", slug: "budget" },
  "city council": { name: "City Council", slug: "city-council" },
  "council": { name: "City Council", slug: "city-council" },
  "infrastructure and corporate services": { name: "Infrastructure and Corporate Services Committee", slug: "infrastructure-corporate-services" },
  "infrastructure & corporate services": { name: "Infrastructure and Corporate Services Committee", slug: "infrastructure-corporate-services" },
}

// Slugify helper
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Extract committee from title
export function extractCommittee(title: string): { name: string; slug: string } | null {
  const lowerTitle = title.toLowerCase()

  // Try to match known committees. Pick the LONGEST matching pattern, not the
  // first one in object-insertion order: several patterns are substrings of
  // others (e.g. "corporate services" is a substring of "infrastructure and
  // corporate services"), so a first-match loop silently misfiles the more
  // specific committee under the shorter one. See COMMITTEE_MAPPINGS key
  // ordering bug (flagged 22 Aug 2026, never fixed until this change).
  let bestMatch: { name: string; slug: string } | null = null
  let bestMatchLength = -1
  for (const [pattern, committee] of Object.entries(COMMITTEE_MAPPINGS)) {
    if (lowerTitle.includes(pattern) && pattern.length > bestMatchLength) {
      bestMatch = committee
      bestMatchLength = pattern.length
    }
  }
  if (bestMatch) {
    return bestMatch
  }

  // Fallback: try to extract from "Meeting of the X Committee" pattern
  const match = title.match(/meeting of (?:the )?(.+?)(?:\s*-|$)/i)
  if (match) {
    const name = match[1].trim()
    return { name, slug: slugify(name) }
  }

  return null
}
