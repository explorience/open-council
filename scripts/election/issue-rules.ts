/**
 * Election Hub — issue classification rules
 *
 * Transparent, reviewable keyword rules for sorting divided (non-unanimous,
 * non-procedural) motions since 2023-01-01 into the eight issue clusters
 * from ELECTION_HUB_RESEARCH.md. This is deliberately dumb substring
 * matching (lowercased) rather than an LLM classifier so a human can read
 * every rule that fired.
 *
 * Calibration notes (2026-08-30, against the full 2023+ divided-motion set):
 * - Bare "police" / "residential" / "reserve fund" / "active transportation"
 *   were tried and dropped — each pulled in unrelated items (first-responder
 *   consultation clauses, generic reserve-fund reimbursements, council
 *   procedure by-law reshuffles). Keywords below are the ones that survived
 *   manual review of their hits.
 * - Planning-application item codes (Z-####, OZ-####, O-####, TZ-####) are a
 *   strong, structural signal for housing/rezoning items whose itemTitle is
 *   just an address + code with no prose — see CODE_PATTERNS below.
 * - GLOBAL_EXCLUDE catches governance/procedure-of-council motions that
 *   happen to name an issue in passing (e.g. a Council Procedure By-law
 *   amendment that mentions "bike lanes" while reassigning committee
 *   mandates) — these are not substantive positions on the issue.
 */

export interface IssueRule {
  id: string
  label: string
  /** lowercase substrings; a match counts once per distinct phrase */
  include: string[]
}

export const ISSUE_ORDER = [
  "encampments",
  "policing",
  "bikes",
  "downtown",
  "transit",
  "budget",
  "climate",
  "housing",
] as const

export type IssueId = (typeof ISSUE_ORDER)[number]

/** Motions matching any of these phrases are never classified, regardless
 * of issue keyword hits — they're about how council governs itself, not a
 * substantive position on a public issue. */
export const GLOBAL_EXCLUDE: string[] = [
  "council procedure by-law",
  "committee mandate",
  "terms of reference",
  "striking committee",
  "code of conduct",
  "integrity commissioner",
  "council remuneration",
  "conflict of interest",
]

/** Item-number "codes" (address-only titles) that are strong structural
 * evidence of a planning/rezoning application, independent of keyword text.
 * Matched against itemTitle only. */
export const CODE_PATTERNS: Record<IssueId, RegExp[]> = {
  housing: [/\b(Z|OZ|O|TZ)-\d{3,6}\b/],
  encampments: [],
  policing: [],
  bikes: [],
  downtown: [],
  transit: [],
  budget: [],
  climate: [],
}

export const ISSUES: Record<IssueId, IssueRule> = {
  encampments: {
    id: "encampments",
    label: "Homelessness & Encampments",
    include: [
      "encampment",
      "homeless",
      "homelessness",
      "whole of community system response",
      "unsheltered",
      "coordinated response",
      "emergency shelter",
      "micro-modular shelter",
      "warming centre",
      "by-name list",
    ],
  },
  policing: {
    id: "policing",
    label: "Policing",
    include: [
      "london police services board",
      "police services board",
      "chief of police",
      "police budget",
      "special constable",
      "policing budget",
      "police complement",
      "provincial policing",
      "police service",
    ],
  },
  bikes: {
    id: "bikes",
    label: "Bike Lanes / Cycling",
    include: [
      "bike lane",
      "bike lanes",
      "cycling infrastructure",
      "cycle track",
      "protected bike lane",
      "bicycle facilit",
      "cycling network",
      "bike network",
      "cycling master plan",
      "cycling map",
      "network cycling",
    ],
  },
  downtown: {
    id: "downtown",
    label: "Downtown & Core",
    include: ["downtown", "core area", "dundas place", "downtown plan", "core-area"],
  },
  transit: {
    id: "transit",
    label: "Transit & Roads",
    include: [
      "transit",
      "bus rapid transit",
      " brt ",
      "mobility master plan",
      "london transit",
      "rapid transit",
      "transportation master plan",
      "road widening",
      "traffic calming",
      "bus route",
      "transit service",
    ],
  },
  budget: {
    id: "budget",
    label: "Taxes & Budget",
    include: [
      "multi-year budget",
      "tax levy",
      "property tax",
      "business case",
      "capital budget",
      "development charges",
      "dc by-law",
      "operating budget",
      "budget amendment",
      "annual budget update",
      "budget book",
      "2024 budget",
      "2025 budget",
      "2026 budget",
      "2027 budget",
      "2024-2027 budget",
      "multi-year budget update",
    ],
  },
  climate: {
    id: "climate",
    label: "Climate & Green Space",
    include: [
      "climate",
      "greenhouse gas",
      " ghg ",
      "tree canopy",
      "urban forest",
      "natural heritage",
      "environmentally significant area",
      "climate emergency",
      "net zero",
      "renewable energy",
      "electric vehicle charging",
      "stormwater management",
      "flood plain",
      "conservation authority",
      "wetland",
      "tree protection",
      "climate action",
      "emissions",
      "energy transition",
      "climate adaptation",
    ],
  },
  housing: {
    id: "housing",
    label: "Housing & Density",
    include: [
      "affordable housing",
      "rezoning",
      "rezone",
      "zoning by-law amendment",
      "official plan amendment",
      "the london plan",
      "units per hectare",
      "dwelling unit",
      "secondary suite",
      "secondary dwelling",
      "site plan approval",
      "plan of subdivision",
      "severance",
      "inclusionary zoning",
      "rental replacement",
      "housing accelerator",
      "supportive housing",
      "townhouse",
      "laneway house",
      "additional dwelling",
      "affordable housing community improvement plan",
      "housing needs",
      "missing middle",
      "as-of-right",
      "official plan",
      "housing supply",
    ],
  },
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// A plain substring test ("transit" ⊂ "Transition", "climate" ⊂
// "acclimate") produced a false-positive hit during spot-check
// (2026-08-30: a healthcare-recruitment funding motion was classified
// "transit" purely because its item title contains "Transition into
// Practice"). Every keyword is matched with word boundaries instead —
// still a plain-text rule a human can read, just anchored to whole words.
const keywordRegexCache = new Map<string, RegExp>()
function keywordMatches(keyword: string, text: string): boolean {
  let re = keywordRegexCache.get(keyword)
  if (!re) {
    // Keywords may themselves start/end with a padding space (e.g. " ghg ")
    // as a hand-rolled word-boundary hack from before this function existed;
    // trim that and let \b do the real work.
    re = new RegExp(`\\b${escapeRegExp(keyword.trim())}\\b`, "i")
    keywordRegexCache.set(keyword, re)
  }
  return re.test(text)
}

/**
 * Classify a motion (itemTitle + motionText) into at most one issue.
 * Returns null (unclassified) when nothing matches — never force-fit.
 */
export function classifyIssue(
  itemTitle: string,
  motionText: string
): { issue: IssueId; matchedKeywords: string[]; score: number } | null {
  const text = `${itemTitle} ${motionText}`.toLowerCase()

  if (GLOBAL_EXCLUDE.some((ex) => text.includes(ex))) return null

  const scores: Partial<Record<IssueId, string[]>> = {}

  for (const issueId of ISSUE_ORDER) {
    const rule = ISSUES[issueId]
    const hits = rule.include.filter((kw) => keywordMatches(kw, text))
    const codeHits = CODE_PATTERNS[issueId].filter((re) => re.test(itemTitle))
    const matched = [...new Set(hits)]
    if (codeHits.length > 0) matched.push("planning-application-code")
    if (matched.length > 0) scores[issueId] = matched
  }

  const entries = Object.entries(scores) as [IssueId, string[]][]
  if (entries.length === 0) return null

  const maxScore = Math.max(...entries.map(([, m]) => m.length))
  const candidates = entries.filter(([, m]) => m.length === maxScore)

  // Tie-break by ISSUE_ORDER (more specific issues first)
  for (const issueId of ISSUE_ORDER) {
    const found = candidates.find(([id]) => id === issueId)
    if (found) return { issue: issueId, matchedKeywords: found[1], score: maxScore }
  }

  return null
}
