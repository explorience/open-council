/**
 * Election Hub — "what a yea did" direction rules
 *
 * Raw yea/nay is meaningless on its own: a yea on "increase density" and a
 * yea on "remove where townhouses are allowed" point opposite ways. This
 * module translates a motion's text into a neutral statement of what a YEA
 * vote did, on a named axis, with a valence (+1 = more expansive/permissive
 * outcome on that axis, -1 = more restrictive outcome).
 *
 * Design:
 * 1. Try issue-specific "content axis" patterns first (e.g. housing density,
 *    police budget size) — these read the substance of the clause.
 * 2. An explicit denial verb (BE DENIED / BE REFUSED / NOT BE APPROVED)
 *    flips the content-axis valence, because "the request to increase
 *    density BE DENIED" nets out as a restrictive outcome even though the
 *    clause text contains "increase".
 * 3. Falling back, use a generic approve/deny read of the clause's own
 *    outcome verb (BE APPROVED/DIRECTED/AUTHORIZED/... vs BE DENIED/REFUSED).
 * 4. A motion whose only verb is deferral/referral/receipt/noting (no
 *    approve or deny) — or one with no recognizable outcome verb at all —
 *    is marked direction: 'unclear' and is EXCLUDED from stance
 *    aggregation, per the responsible-build rule: never guess a position
 *    from a procedural non-decision.
 *
 * Every regex here is intentionally readable — this is the "reviewable
 * config" a human should be able to audit clause by clause.
 */

import type { IssueId } from "./issue-rules.js"

export interface Direction {
  axis: string
  /** +1 = a yea moved toward the expansive/permissive/larger-scope outcome
   *  on this axis; -1 = a yea moved toward the restrictive/smaller-scope
   *  outcome. */
  valence: 1 | -1
  /** Neutral, human-readable statement of what a YEA vote did (matches valence). */
  label: string
  /** The axis's canonical label pair, regardless of which one this
   * particular motion's valence matched — lets aggregation build one
   * consistent sentence across motions on the same axis with mixed wording. */
  axisLabels: { expansive: string; restrictive: string }
}

const DENY_RE = /\bBE\s+(DENIED|REFUSED|NOT\s+APPROVED)\b/i
const NOT_APPROVED_RE = /\bNOT\s+BE\s+APPROVED\b/i
const AFFIRM_RE =
  /\bBE\s+(APPROVED|ADOPTED|DIRECTED|AUTHORIZED|INTRODUCED|INCLUDED|ESTABLISHED|ENACTED|ENDORSED|FUNDED)\b/i
const DEFER_RE = /\bBE\s+(DEFERRED|REFERRED|TABLED|WITHDRAWN|RECEIVED|NOTED)\b/i
// "the Civic Administration BE DIRECTED to report back / provide information
// / undertake a study ..." decides nothing about the underlying issue — it
// asks staff for more information. Caught separately from DEFER_RE because
// the verb itself (BE DIRECTED) is a normal AFFIRM_RE hit; what marks this
// as a non-decision is the "ask for information" object of the directive,
// found via manual spot-check (2026-08-30): a motion directing a report
// back on West London transit/road planning was otherwise read as "approved
// the transit item", which overstates it.
const INFORMATIONAL_ASK_RE =
  /\bBE\s+DIRECTED\b[^.;]{0,60}\bto\s+(report\s+back|provide\s+(?:information|an?\s+update|a\s+report)|undertake\s+a\s+study|study\s+(?:the|this|options|of)|include\s+in\s+the\s+report)\b/gi

function isDenied(text: string): boolean {
  return DENY_RE.test(text) || NOT_APPROVED_RE.test(text)
}

/** True when the ONLY affirmative signal in the clause is one or more
 * "report back / study / provide information / include in the report" asks
 * — i.e. every AFFIRM_RE hit is a BE DIRECTED whose object is an
 * informational request, not an implementation. A single motion can carry
 * several such clauses (e.g. "a) ... BE DIRECTED to report back ...; b) ...
 * BE DIRECTED to include in the report a study of ..."), so every match is
 * stripped (global regex) before re-testing for a real AFFIRM_RE verb. */
function isInformationalAskOnly(text: string): boolean {
  INFORMATIONAL_ASK_RE.lastIndex = 0
  if (!INFORMATIONAL_ASK_RE.test(text)) return false
  const withoutInformationalAsks = text.replace(INFORMATIONAL_ASK_RE, " ")
  return !AFFIRM_RE.test(withoutInformationalAsks)
}

interface AxisPattern {
  axis: string
  /** Matches when the clause's content moves toward the EXPANSIVE outcome. */
  expansiveRe: RegExp
  expansiveLabel: string
  /** Matches when the clause's content moves toward the RESTRICTIVE outcome. */
  restrictiveRe: RegExp
  restrictiveLabel: string
}

// Shared distance-bounded verb phrases used across multiple issues.
const INCREASE = "(?:increas\\w+|higher|greater|additional|expand\\w*)"
const DECREASE = "(?:decreas\\w+|reduc\\w+|lower\\w+|cut|remov\\w+|eliminat\\w+)"

const AXIS_PATTERNS: Partial<Record<IssueId, AxisPattern[]>> = {
  housing: [
    {
      axis: "density",
      expansiveRe: new RegExp(
        `\\b${INCREASE}\\b[^.;]{0,80}\\b(density|height|storeys|units per hectare|permitted density)\\b`,
        "i"
      ),
      expansiveLabel: "increased permitted density or building height",
      restrictiveRe: new RegExp(
        `\\b${DECREASE}\\b[^.;]{0,80}\\b(density|height|storeys|units per hectare|permitted density)\\b`,
        "i"
      ),
      restrictiveLabel: "reduced permitted density or building height",
    },
    {
      axis: "use-permission",
      expansiveRe:
        /\bpermit\w*\b[^.;]{0,60}\b(additional dwelling unit|secondary suite|triplex|fourplex|multi-unit|townhouse|laneway house)\b/i,
      expansiveLabel: "expanded where additional housing types are permitted",
      restrictiveRe:
        /\b(remov\w+|prohibit\w*|not\s+permit\w*)\b[^.;]{0,60}\b(dwelling unit|secondary suite|triplex|fourplex|multi-unit|townhouse|laneway house|permitted use)\b/i,
      restrictiveLabel: "restricted where additional housing types are permitted",
    },
    {
      axis: "affordable-funding",
      expansiveRe: /\baffordable housing\b[^.;]{0,120}\b(award|contribution agreement|BE APPROVED|grant|fund\w*)\b/i,
      expansiveLabel: "approved funding or land for affordable housing",
      restrictiveRe: /\baffordable housing\b[^.;]{0,120}\b(BE DENIED|BE REFUSED|withdraw\w*)\b/i,
      restrictiveLabel: "denied funding or land for affordable housing",
    },
  ],
  climate: [
    {
      axis: "target-strength",
      expansiveRe: new RegExp(
        `\\b(${INCREASE}|strengthen\\w*)\\b[^.;]{0,80}\\b(target|renewable|net zero|emissions? reduction)\\b`,
        "i"
      ),
      expansiveLabel: "strengthened a climate or environmental target",
      restrictiveRe: new RegExp(
        `\\b(${DECREASE}|weaken\\w*)\\b[^.;]{0,80}\\b(target|renewable|net zero|emissions? reduction)\\b`,
        "i"
      ),
      restrictiveLabel: "weakened a climate or environmental target",
    },
    {
      axis: "natural-heritage",
      expansiveRe:
        /\b(protect\w*|designat\w*|expand\w*)\b[^.;]{0,60}\b(natural heritage|tree canopy|woodlot|wetland|environmentally significant area)\b/i,
      expansiveLabel: "increased tree canopy or natural-heritage protection",
      restrictiveRe:
        /\b(remov\w+|reduc\w+|de-?designat\w*)\b[^.;]{0,60}\b(natural heritage|tree canopy|woodlot|wetland|environmentally significant area)\b/i,
      restrictiveLabel: "reduced tree canopy or natural-heritage protection",
    },
  ],
  budget: [
    {
      axis: "levy-size",
      expansiveRe: new RegExp(`\\b${INCREASE}\\b[^.;]{0,60}\\b(levy|tax rate|budget|spending|funding)\\b`, "i"),
      expansiveLabel: "increased the tax levy or a budget item",
      restrictiveRe: new RegExp(`\\b${DECREASE}\\b[^.;]{0,60}\\b(levy|tax rate|budget|spending|funding)\\b`, "i"),
      restrictiveLabel: "reduced the tax levy or a budget item",
    },
    {
      // Two common phrasings appear in the corpus: "business case(s) BE
      // INCLUDED/EXCLUDED" and the reverse word order "the Civic
      // Administration BE DIRECTED to include/exclude the following
      // business case(s)". Both directions are matched either way round —
      // found via manual spot-check (2026-08-30) after the reverse order
      // fell through to the generic "approved the budget item" fallback,
      // which wrongly reads a spending EXCLUSION as expansive.
      axis: "business-case",
      expansiveRe:
        /\bbusiness cases?\b[^.;]{0,60}\bBE\s+INCLUDED\b|\binclude\w*\b[^.;]{0,60}\bbusiness cases?\b/i,
      expansiveLabel: "included a business case in the budget",
      restrictiveRe:
        /\bbusiness cases?\b[^.;]{0,60}\bBE\s+(EXCLUDED|REMOVED)\b|\bexclude\w*\b[^.;]{0,60}\bbusiness cases?\b/i,
      restrictiveLabel: "excluded a business case from the budget",
    },
  ],
  transit: [
    {
      axis: "service-expansion",
      expansiveRe: new RegExp(`\\b${INCREASE}\\b[^.;]{0,60}\\b(service|route|frequency|network|infrastructure)\\b`, "i"),
      expansiveLabel: "expanded transit or road service/infrastructure",
      restrictiveRe: new RegExp(`\\b${DECREASE}\\b[^.;]{0,60}\\b(service|route|frequency|network|infrastructure)\\b`, "i"),
      restrictiveLabel: "reduced transit or road service/infrastructure",
    },
  ],
  encampments: [
    {
      axis: "response-scale",
      expansiveRe: new RegExp(`\\b(${INCREASE}|fund\\w*)\\b[^.;]{0,60}\\b(response|shelter|outreach|support)\\b`, "i"),
      expansiveLabel: "expanded the encampment/homelessness response",
      restrictiveRe: new RegExp(`\\b(${DECREASE}|clos\\w*|defund\\w*)\\b[^.;]{0,60}\\b(response|shelter|outreach|support)\\b`, "i"),
      restrictiveLabel: "reduced the encampment/homelessness response",
    },
  ],
  policing: [
    {
      axis: "budget-size",
      expansiveRe: new RegExp(`\\b${INCREASE}\\b[^.;]{0,60}\\b(police budget|complement|officers?)\\b`, "i"),
      expansiveLabel: "increased the police budget or complement",
      restrictiveRe: new RegExp(`\\b${DECREASE}\\b[^.;]{0,60}\\b(police budget|complement|officers?)\\b`, "i"),
      restrictiveLabel: "reduced the police budget or complement",
    },
  ],
  bikes: [
    {
      axis: "infrastructure-expansion",
      expansiveRe:
        /\b(approve\w*|install\w*|add\w*|expand\w*)\b[^.;]{0,60}\b(bike lane|cycle track|cycling infrastructure)\b/i,
      expansiveLabel: "approved new cycling infrastructure",
      restrictiveRe:
        /\b(remov\w+|eliminat\w+|BE\s+DENIED|BE\s+REFUSED)\b[^.;]{0,60}\b(bike lane|cycle track|cycling infrastructure)\b/i,
      restrictiveLabel: "removed or denied cycling infrastructure",
    },
  ],
}

/** Custom nouns for the generic approve/deny fallback, per issue. */
const GENERIC_NOUN: Partial<Record<IssueId, string>> = {
  // Covers both individual rezoning/site-plan applications (the majority)
  // and broader housing-policy items (Official Plan / Land Needs Assessment
  // reviews, STR licensing) that land in this issue without an
  // application-specific code — spot-check (2026-08-30) found the narrower
  // "rezoning application" wording misdescribing the latter.
  housing: "the development, rezoning, or housing-policy item",
  climate: "the climate/environmental item",
  budget: "the budget item",
  transit: "the transit/roads item",
  encampments: "the encampment/homelessness item",
  downtown: "the downtown/core-area item",
  policing: "the policing item",
  bikes: "the cycling item",
}

export function deriveDirection(issue: IssueId, motionText: string): Direction | { axis: null; label: "unclear" } {
  const denied = isDenied(motionText)

  // A clause whose only operative verb is deferral/referral/receipt/noting
  // (no explicit approve or deny anywhere in it) hasn't actually decided
  // anything — mark unclear BEFORE checking content-axis wording, so e.g.
  // "the funding allocation BE REFERRED back to Civic Administration for
  // more information" doesn't get read as an approved funding increase
  // just because it mentions "funding".
  const deferOnly = DEFER_RE.test(motionText) && !AFFIRM_RE.test(motionText) && !denied
  if (deferOnly) {
    return { axis: null, label: "unclear" }
  }

  // Likewise, a clause whose only affirmative content is "BE DIRECTED to
  // report back / study / provide information" hasn't decided the
  // underlying question either — it's a request for more information, not
  // a position. Checked before axis matching for the same reason as above.
  if (!denied && isInformationalAskOnly(motionText)) {
    return { axis: null, label: "unclear" }
  }

  const axisPatterns = AXIS_PATTERNS[issue] ?? []
  for (const ap of axisPatterns) {
    const axisLabels = { expansive: ap.expansiveLabel, restrictive: ap.restrictiveLabel }
    if (ap.expansiveRe.test(motionText)) {
      return {
        axis: ap.axis,
        valence: denied ? -1 : 1,
        label: denied ? ap.restrictiveLabel : ap.expansiveLabel,
        axisLabels,
      }
    }
    if (ap.restrictiveRe.test(motionText)) {
      return {
        axis: ap.axis,
        valence: denied ? 1 : -1,
        label: denied ? ap.expansiveLabel : ap.restrictiveLabel,
        axisLabels,
      }
    }
  }

  // Generic fallback: read the clause's own outcome verb. (deferOnly was
  // already handled above, before axis matching.)
  const noun = GENERIC_NOUN[issue] ?? "the item"
  const genericAxisLabels = { expansive: `approved ${noun}`, restrictive: `denied ${noun}` }

  if (denied) {
    return { axis: "application-approval", valence: -1, label: `denied ${noun}`, axisLabels: genericAxisLabels }
  }
  if (AFFIRM_RE.test(motionText)) {
    return { axis: "application-approval", valence: 1, label: `approved ${noun}`, axisLabels: genericAxisLabels }
  }
  return { axis: null, label: "unclear" }
}
