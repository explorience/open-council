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

import type { IssueId } from "./issue-rules.js";

export interface Direction {
  axis: string;
  /** +1 = a yea moved toward the expansive/permissive/larger-scope outcome
   *  on this axis; -1 = a yea moved toward the restrictive/smaller-scope
   *  outcome. */
  valence: 1 | -1;
  /** Neutral, human-readable statement of what a YEA vote did (matches valence). */
  label: string;
  /** The axis's canonical label pair, regardless of which one this
   * particular motion's valence matched — lets aggregation build one
   * consistent sentence across motions on the same axis with mixed wording. */
  axisLabels: { expansive: string; restrictive: string };
}

// Broadened 2026-08-31 (finding 13, hub-recheck verdict): the corpus was
// swept for every denial phrasing actually used in a non-truncated, divided
// motion ("denied", "refused", "rejected", "not be granted", "turned down",
// "not be permitted", "not approved" in both word orders) — the ONLY hits
// anywhere are two "... BE REFUSED" heritage-designation motions, and
// "heritage" isn't one of the eight tracked issues, so DENY_RE has zero
// opportunity to fire on tracked, non-truncated data as of this pass. The
// vocabulary is still broadened here (REJECTED, NOT BE GRANTED/PERMITTED)
// so a future denial phrasing the corpus doesn't currently contain isn't
// silently missed — this is deliberately kept alive rather than deleted.
// See the "application-approval" axis comment below for the honest
// consequence of this: the generic fallback axis mostly deducts directly to
// the motion's own yea/nay outcome, disclosed rather than hidden.
const DENY_RE =
  /\bBE\s+(DENIED|REFUSED|REJECTED|NOT\s+APPROVED|NOT\s+GRANTED|NOT\s+PERMITTED)\b/i;
const NOT_APPROVED_RE = /\bNOT\s+BE\s+(APPROVED|GRANTED|PERMITTED)\b/i;
const AFFIRM_RE =
  /\bBE\s+(APPROVED|ADOPTED|DIRECTED|AUTHORIZED|INTRODUCED|INCLUDED|ESTABLISHED|ENACTED|ENDORSED|FUNDED)\b/i;
const DEFER_RE =
  /\bBE\s+(DEFERRED|REFERRED|TABLED|WITHDRAWN|RECEIVED|NOTED)\b/i;

// Procedural preamble wrapper: many motions in this corpus are phrased as
// "That [part b) / the following motion / item 5, clause 2.2, as amended]
// BE APPROVED [and reads as follows|as follows]: <the actual clause>" — the
// wrapper's own "BE APPROVED" announces that a vote is happening on the
// clause that follows; it is not itself a second, independent decision.
// Left in place, it makes AFFIRM_RE fire even when the REAL clause's own
// verb is a pure referral/deferral, defeating the deferOnly guard below.
// Spot-check (2026-08-31, hub-recheck verdict finding re: VHA Extreme
// Clean): "That b) be approved and reads as follows: b) the request for
// funding the VHA Home HealthCare and its Extreme Clean Program BE REFERRED
// to the Budget Committee ..." (dde088237cfe, 8-7) read as "approved the
// budget item" purely because of the wrapper's "be approved", when the
// clause's own, only real verb is BE REFERRED (a referral — a non-decision).
// Matched narrowly: only a "BE APPROVED" whose own subject is a bare
// procedural reference (a part/item/clause label, "the motion", "the
// following motion") — never a substantive noun phrase — so a real approval
// like "the Cycling Network maps BE APPROVED, except: ..." is left intact
// for axis matching below.
const WRAPPER_SUBJECT =
  "(?:(?:part[s]?\\s+)?(?:[a-z0-9]+\\)[\\s,]*(?:and\\s+)?){1,4}(?:of\\s+(?:the\\s+motion\\b|item\\s+\\d+[^,:]*,?\\s*clause\\s+[\\d.]+[^,:]*))?|the\\s+following\\s+motion\\b|the\\s+motion\\b|preamble\\s+and\\s+part[s]?\\s+[a-z0-9]+\\)|item\\s+\\d+[^,:]*,?\\s*clause\\s+[\\d.]+[^,:]*)";
// The colon-lookahead is restricted to non-period characters ([^:.] rather
// than [^:]) so a genuinely standalone, complete decision like "That item
// 10, clause 3.5, as amended, BE APPROVED." — followed only by an unrelated
// scraper-inserted timestamp aside ("At 2:56 PM, Chair Deputy Mayor S.
// Lewis, places Councillor H. McAlister in the Chair.") — doesn't get
// treated as a wrapper just because a clock time later in the sentence
// happens to contain a ":" character (found 2026-08-31 while validating
// this fix against the full corpus: 6 real, complete rezoning approvals hit
// this false positive and wrongly became "unclear").
const WRAPPER_PREAMBLE_RE = new RegExp(
  `\\b(?:that\\s+)?${WRAPPER_SUBJECT}(?:,?\\s*as\\s+amended)?,?\\s*be\\s+approved\\b[^:.]{0,60}:`,
  "gi",
);

/** Strip procedural wrapper preambles (see WRAPPER_PREAMBLE_RE) before any
 * affirmation/deferral/informational testing below, so a wrapper's own "BE
 * APPROVED" never masks the real clause's own verb — but ONLY when the
 * clause it introduces has its own, independent operative verb (approve,
 * deny, or defer/refer). Some motions use "SUBJECT BE APPROVED: <sub-parts>"
 * where the sub-parts are plain instructions with no separate approve/deny
 * verb of their own (e.g. "parts a) ix) and x) BE APPROVED: ix) AMEND
 * Schedule 1 from 18 storeys to 22 storeys; ..." — found 2026-08-31 while
 * validating this fix against the full corpus) — there, the wrapper's "BE
 * APPROVED" IS the only decision signal for the whole clause and must
 * survive, or the clause wrongly loses its only verb and becomes
 * "unclear". */
function stripWrapperPreamble(text: string): string {
  return text.replace(WRAPPER_PREAMBLE_RE, (match, offset: number) => {
    const rest = text.slice(offset + match.length);
    const restHasOwnVerb =
      AFFIRM_RE.test(rest) ||
      DEFER_RE.test(rest) ||
      DENY_RE.test(rest) ||
      NOT_APPROVED_RE.test(rest);
    return restHasOwnVerb ? " " : match;
  });
}

// "the Civic Administration BE DIRECTED to report back / provide information
// / undertake a study ..." decides nothing about the underlying issue — it
// asks staff for more information. Caught separately from DEFER_RE because
// the verb itself (BE DIRECTED) is a normal AFFIRM_RE hit; what marks this
// as a non-decision is the "ask for information" object of the directive,
// found via manual spot-check (2026-08-30): a motion directing a report
// back on West London transit/road planning was otherwise read as "approved
// the transit item", which overstates it.
// Broadened 2026-08-31: the original pattern required an explicit "BE
// DIRECTED ... to" immediately before the informational verb, which missed
// report-back-style clauses phrased as plain amendment parts (e.g. "e) to
// map the relative availability of on-street parking ...; f) to explore
// best practices ..., and report back about options ...") with no "BE
// DIRECTED" nearby — found via manual spot-check (2026-08-31) after a
// parking-changes report-back-and-map amendment was read as "approved 0 of
// 2 measures that increased permitted density" purely because the phrase
// "higher-density" appeared inside one of its report-back clauses. "BE
// DIRECTED to ..." is still matched (as before); it's no longer required.
// A bare "to <verb>" already matches inside "BE DIRECTED to <verb>" too, so
// one pattern covers both the original BE-DIRECTED phrasing and the plain
// amendment-clause phrasing found in the parking-changes spot-check above.
//
// Fixed 2026-08-31 (hub-recheck verdict blocker 2): the optional
// "BE\s+DIRECTED\s+" lead-in is now consumed as PART of this same match
// when it's immediately adjacent, instead of being left behind for
// isInformationalAskOnly's later AFFIRM_RE re-test to trip over. Before
// this fix, stripping only "to report back" from "the Civic Administration
// BE DIRECTED to report back ..." left "BE DIRECTED" standing alone in the
// text, which itself matches AFFIRM_RE — so the guard fired on ~0 of the
// motions it was meant to catch (corpus-wide: 1 of the 8 known cases). The
// canonical example (fa154ae19f7b, 2025-05-13, 14-1, a Whole of Community
// System Response dashboard report-back) was published as "denied the
// encampment/homelessness item" for the sole nay — a report-back has no
// direction at all.
const INFORMATIONAL_ASK_RE =
  /\b(?:BE\s+DIRECTED\s+)?to\s+(report\s+back|provide\s+(?:information|an?\s+update|a\s+report)|undertake\s+a\s+study|study\s+(?:the|this|options|of)|include\s+in\s+the\s+report|explore\s+(?:best\s+practices|options|opportunities)|map\s+(?:the|out)|evaluate\s+(?:on[\s-]?street|options|the))\b/gi;

function isDenied(text: string): boolean {
  return DENY_RE.test(text) || NOT_APPROVED_RE.test(text);
}

/** True when the ONLY affirmative signal in the clause is one or more
 * "report back / study / provide information / include in the report" asks
 * — i.e. every AFFIRM_RE hit is a BE DIRECTED whose object is an
 * informational request, not an implementation. A single motion can carry
 * several such clauses (e.g. "a) ... BE DIRECTED to report back ...; b) ...
 * BE DIRECTED to include in the report a study of ..."), so every match is
 * stripped (global regex) before re-testing for a real AFFIRM_RE verb. Note
 * this strips "BE DIRECTED to <verb>" as one unit when adjacent (see
 * INFORMATIONAL_ASK_RE above) — a "BE DIRECTED" governing a genuinely
 * different, substantive action elsewhere in the same clause survives,
 * because it isn't adjacent to an informational verb and so isn't matched. */
function isInformationalAskOnly(text: string): boolean {
  INFORMATIONAL_ASK_RE.lastIndex = 0;
  if (!INFORMATIONAL_ASK_RE.test(text)) return false;
  const withoutInformationalAsks = text.replace(INFORMATIONAL_ASK_RE, " ");
  return !AFFIRM_RE.test(withoutInformationalAsks);
}

interface AxisPattern {
  axis: string;
  /** Matches when the clause's content moves toward the EXPANSIVE outcome. */
  expansiveRe: RegExp;
  expansiveLabel: string;
  /** Matches when the clause's content moves toward the RESTRICTIVE outcome. */
  restrictiveRe: RegExp;
  restrictiveLabel: string;
}

// Shared distance-bounded verb phrases used across multiple issues.
const INCREASE = "(?:increas\\w+|higher|greater|additional|expand\\w*)";
const DECREASE =
  "(?:decreas\\w+|reduc\\w+|lower\\w+|cut|remov\\w+|eliminat\\w+)";

// One noun set shared by both the bikes expansiveRe and restrictiveRe (see
// below) — previously the restrictive side alone was widened to include
// "cycling network|cycling map|network cycling" (2026-08-31 spot-check),
// leaving the expansive side unable to match the same vocabulary at all.
const BIKE_NOUNS =
  "(?:bike lane|cycle track|cycling infrastructure|cycling network|cycling map|network cycling|bicycle facilit\\w*)";

const AXIS_PATTERNS: Partial<Record<IssueId, AxisPattern[]>> = {
  housing: [
    {
      axis: "density",
      expansiveRe: new RegExp(
        `\\b${INCREASE}\\b[^.;]{0,80}\\b(density|height|storeys|units per hectare|permitted density)\\b`,
        "i",
      ),
      expansiveLabel: "increased permitted density or building height",
      restrictiveRe: new RegExp(
        `\\b${DECREASE}\\b[^.;]{0,80}\\b(density|height|storeys|units per hectare|permitted density)\\b`,
        "i",
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
      restrictiveLabel:
        "restricted where additional housing types are permitted",
    },
    {
      axis: "affordable-funding",
      expansiveRe:
        /\baffordable housing\b[^.;]{0,120}\b(award|contribution agreement|BE APPROVED|grant|fund\w*)\b/i,
      expansiveLabel: "approved funding or land for affordable housing",
      restrictiveRe:
        /\baffordable housing\b[^.;]{0,120}\b(BE DENIED|BE REFUSED|withdraw\w*)\b/i,
      restrictiveLabel: "denied funding or land for affordable housing",
    },
  ],
  climate: [
    {
      axis: "target-strength",
      expansiveRe: new RegExp(
        `\\b(${INCREASE}|strengthen\\w*)\\b[^.;]{0,80}\\b(target|renewable|net zero|emissions? reduction)\\b`,
        "i",
      ),
      expansiveLabel: "strengthened a climate or environmental target",
      restrictiveRe: new RegExp(
        `\\b(${DECREASE}|weaken\\w*)\\b[^.;]{0,80}\\b(target|renewable|net zero|emissions? reduction)\\b`,
        "i",
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
      expansiveRe: new RegExp(
        `\\b${INCREASE}\\b[^.;]{0,60}\\b(levy|tax rate|budget|spending|funding)\\b`,
        "i",
      ),
      expansiveLabel: "increased the tax levy or a budget item",
      restrictiveRe: new RegExp(
        `\\b${DECREASE}\\b[^.;]{0,60}\\b(levy|tax rate|budget|spending|funding)\\b`,
        "i",
      ),
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
      expansiveRe: new RegExp(
        `\\b${INCREASE}\\b[^.;]{0,60}\\b(service|route|frequency|network|infrastructure)\\b`,
        "i",
      ),
      expansiveLabel: "expanded transit or road service/infrastructure",
      restrictiveRe: new RegExp(
        `\\b${DECREASE}\\b[^.;]{0,60}\\b(service|route|frequency|network|infrastructure)\\b`,
        "i",
      ),
      restrictiveLabel: "reduced transit or road service/infrastructure",
    },
  ],
  encampments: [
    {
      axis: "response-scale",
      expansiveRe: new RegExp(
        `\\b(${INCREASE}|fund\\w*)\\b[^.;]{0,60}\\b(response|shelter|outreach|support)\\b`,
        "i",
      ),
      expansiveLabel: "expanded the encampment/homelessness response",
      restrictiveRe: new RegExp(
        `\\b(${DECREASE}|clos\\w*|defund\\w*)\\b[^.;]{0,60}\\b(response|shelter|outreach|support)\\b`,
        "i",
      ),
      restrictiveLabel: "reduced the encampment/homelessness response",
    },
  ],
  policing: [
    {
      axis: "budget-size",
      expansiveRe: new RegExp(
        `\\b${INCREASE}\\b[^.;]{0,60}\\b(police budget|complement|officers?)\\b`,
        "i",
      ),
      expansiveLabel: "increased the police budget or complement",
      restrictiveRe: new RegExp(
        `\\b${DECREASE}\\b[^.;]{0,60}\\b(police budget|complement|officers?)\\b`,
        "i",
      ),
      restrictiveLabel: "reduced the police budget or complement",
    },
  ],
  bikes: [
    {
      axis: "infrastructure-expansion",
      // Both regexes share one noun set and — new 2026-08-31 (hub-recheck
      // verdict blocker 5) — both match EITHER word order: "APPROVE the
      // Cycling Network maps" (verb before noun) AND "the Cycling Network
      // maps BE APPROVED" (noun before verb, passive voice). The corpus
      // phrases approvals almost exclusively in the passive, noun-first
      // order ("the Cycling Network maps BE APPROVED, except: ...") but
      // removals in the active, verb-first order ("the following Proposed
      // Network Additions BE REMOVED from the Network Cycling maps") —
      // before this fix, expansiveRe only matched verb-first, so it could
      // never match a single real approval clause in the corpus, no matter
      // how the noun set was widened. That structural asymmetry is what
      // produced "Shawn Lewis: 0 for cycling, 8 against" on a route the
      // councillor's own evidence rows show voting to approve — verified
      // against 0bb386581df6 ("the Cycling Network maps BE APPROVED,
      // except:", 2025-04-01, 11-4), which fell through to the generic
      // "application-approval" axis and never counted here at all.
      // "add\w*" deliberately excludes "addition(s)" (add(?:ed|ing)? only):
      // the corpus's own noun for a proposed new route is "Proposed Network
      // Additions" — "the following Proposed Network Additions BE REMOVED"
      // is a REMOVAL clause, and a bare "add\w*" verb pattern matched
      // "Additions" itself, flipping every removal clause containing that
      // noun to read as an approval (caught 2026-08-31 while widening the
      // noun set below — this bug was latent in the narrower noun set
      // because "Network Cycling maps" wasn't in-scope for it yet).
      // The noun-first alternative carries a negative lookahead against a
      // LATER removal/denial verb anywhere else in the same clause — the
      // corpus's own phrasing for these motions restates the blanket "the
      // Cycling Network maps BE APPROVED, except:" preamble inside EVERY
      // per-street sub-amendment, immediately followed by that specific
      // street's own "BE REMOVED" (e.g. "c) the Cycling Network maps BE
      // APPROVED, except: i) the following Proposed Network Additions BE
      // REMOVED from the Network Cycling maps: A. Royal Crescent ..."). The
      // "except:" carve-out is the actual, specific thing being voted on in
      // that sub-motion; the restated blanket approval is context copied
      // from the parent clause, not a separate decision. Found 2026-08-31
      // while validating the bidirectional match above against the full
      // corpus: without this guard, all 5 of these per-street removal
      // sub-motions from the 2025-03-25 committee stage flipped to read as
      // approvals.
      expansiveRe: new RegExp(
        `\\b(approve\\w*|install\\w*|add(?:ed|ing)?\\b|expand\\w*)\\b[^.;]{0,60}\\b${BIKE_NOUNS}\\b|\\b${BIKE_NOUNS}\\b[^.;]{0,60}\\bBE\\s+APPROVED\\b(?![\\s\\S]*\\bBE\\s+(?:REMOVED|DENIED|REFUSED)\\b)`,
        "i",
      ),
      expansiveLabel: "approved new cycling infrastructure",
      restrictiveRe: new RegExp(
        `\\b(remov\\w+|eliminat\\w+|BE\\s+DENIED|BE\\s+REFUSED)\\b[^.;]{0,60}\\b${BIKE_NOUNS}\\b|\\b${BIKE_NOUNS}\\b[^.;]{0,60}\\bBE\\s+(REMOVED|DENIED|REFUSED)\\b`,
        "i",
      ),
      restrictiveLabel: "removed or denied cycling infrastructure",
    },
  ],
};

// A motion that directs relocating PEOPLE or SERVICES away from their
// current location isn't well described by generic "approved/denied the
// budget item" or "approved/denied the encampment/homelessness item"
// framing — a nay against relocating a shelter service off a street, or a
// yea directing people out of a park, doesn't mean what "approved/denied
// funding" or "approved/denied the homelessness response" implies to a
// reader. Checked across every issue (after issue-specific content axes,
// before the generic approve/deny fallback), so it applies wherever this
// phrasing turns up rather than being tied to one issue cluster. Two
// documented cases fixed by this (hub-recheck verdict blockers 3 and 4,
// 2026-08-31):
//  - Ark Aid (5ac012d88d30, 2024-07-18, Failed 4-8, budget issue): a nay
//    against directing Ark Aid to "relocate the front door services off
//    Dundas Street" published as "denied the budget item" — reads as
//    opposing FUNDING Ark Aid; the record is the opposite (the nay opposed
//    moving the service, not funding it).
//  - Watson Park (e3801f6411ff, 2025-04-22, Passed 14-1, encampments
//    issue): a yea directing "the relocation of those living unhoused in
//    Watson Park ... to ensure that Watson Park is in compliance with
//    established encampment protocols" published as "approved the
//    encampment/homelessness item" — reads as a pro-support vote when the
//    substance is a directive to clear the park, and the lone dissenter
//    read as having "denied" support for homelessness services.
// Neither case is about funding levels or response scale — both are about
// whether people or services stay put or move — so this gets its own
// neutral, location-continuity axis instead of being forced into an
// approve/support framing the source text doesn't support.
const RELOCATION_AWAY_RE =
  /\brelocat\w*\b[^.;]{0,100}\b(off|away\s+from|out\s+of|those\s+living\s+unhoused|unhoused\s+resident\w*|persons?\s+living\s+unhoused|people\s+living\s+unhoused)\b|\bmov(?:e|ed|ing)\w*\b[^.;]{0,60}\b(off|away\s+from|out\s+of)\b/i;

const RELOCATION_AXIS_LABELS = {
  expansive: "kept people or services at their current location",
  restrictive:
    "directed relocating people or services away from their current location",
};

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
};

export function deriveDirection(
  issue: IssueId,
  motionText: string,
): Direction | { axis: null; label: "unclear" } {
  // Strip procedural wrapper preambles first (see WRAPPER_PREAMBLE_RE) —
  // every check below (denial, deferral, informational-ask, content axes,
  // generic fallback) reads this cleaned text, never the raw motionText, so
  // a wrapper's own "BE APPROVED" can never masquerade as the real clause's
  // decision.
  const text = stripWrapperPreamble(motionText);

  const denied = isDenied(text);

  // A clause whose only operative verb is deferral/referral/receipt/noting
  // (no explicit approve or deny anywhere in it) hasn't actually decided
  // anything — mark unclear BEFORE checking content-axis wording, so e.g.
  // "the funding allocation BE REFERRED back to Civic Administration for
  // more information" doesn't get read as an approved funding increase
  // just because it mentions "funding".
  const deferOnly = DEFER_RE.test(text) && !AFFIRM_RE.test(text) && !denied;
  if (deferOnly) {
    return { axis: null, label: "unclear" };
  }

  // Likewise, a clause whose only affirmative content is "BE DIRECTED to
  // report back / study / provide information" hasn't decided the
  // underlying question either — it's a request for more information, not
  // a position. Checked before axis matching for the same reason as above.
  if (!denied && isInformationalAskOnly(text)) {
    return { axis: null, label: "unclear" };
  }

  const axisPatterns = AXIS_PATTERNS[issue] ?? [];
  for (const ap of axisPatterns) {
    const axisLabels = {
      expansive: ap.expansiveLabel,
      restrictive: ap.restrictiveLabel,
    };
    if (ap.expansiveRe.test(text)) {
      return {
        axis: ap.axis,
        valence: denied ? -1 : 1,
        label: denied ? ap.restrictiveLabel : ap.expansiveLabel,
        axisLabels,
      };
    }
    if (ap.restrictiveRe.test(text)) {
      return {
        axis: ap.axis,
        valence: denied ? 1 : -1,
        label: denied ? ap.expansiveLabel : ap.restrictiveLabel,
        axisLabels,
      };
    }
  }

  // Cross-issue relocation semantics (see RELOCATION_AWAY_RE above) — checked
  // after issue-specific content axes (a genuine density/levy/response-scale
  // signal still wins when present) but before the generic approve/deny
  // fallback, since "relocate X off/away from Y" is a location-continuity
  // decision, not a funding or support decision, regardless of which issue
  // cluster the motion landed in.
  if (RELOCATION_AWAY_RE.test(text)) {
    return {
      axis: "relocation",
      valence: denied ? 1 : -1,
      label: denied
        ? RELOCATION_AXIS_LABELS.expansive
        : RELOCATION_AXIS_LABELS.restrictive,
      axisLabels: RELOCATION_AXIS_LABELS,
    };
  }

  // Generic fallback: read the clause's own outcome verb. (deferOnly was
  // already handled above, before axis matching.) Honest disclosure
  // (hub-recheck verdict finding 13): DENY_RE was swept against the full
  // corpus (2026-08-31) and, as of this pass, never matches a non-truncated
  // motion inside any of the eight tracked issues — the only "BE REFUSED"
  // clauses in the whole corpus are two Heritage Designation motions, and
  // heritage isn't a tracked issue; every other candidate hit the 500-char
  // truncation cap first. DENY_RE's vocabulary is kept broad (see above) in
  // case that changes, but as things stand, "approved ${noun}" / "denied
  // ${noun}" below is not a content translation — it's the clause's own
  // yea/nay outcome relabeled, because the clause's own text offers no
  // separate signal to translate. That's disclosed in the published
  // methodology text (generate-stances.ts writeStancesFile) rather than
  // silently implied to be more than it is.
  const noun = GENERIC_NOUN[issue] ?? "the item";
  const genericAxisLabels = {
    expansive: `approved ${noun}`,
    restrictive: `denied ${noun}`,
  };

  if (denied) {
    return {
      axis: "application-approval",
      valence: -1,
      label: `denied ${noun}`,
      axisLabels: genericAxisLabels,
    };
  }
  if (AFFIRM_RE.test(text)) {
    return {
      axis: "application-approval",
      valence: 1,
      label: `approved ${noun}`,
      axisLabels: genericAxisLabels,
    };
  }
  return { axis: null, label: "unclear" };
}

/** Canonical expansive/restrictive label pair for a given (issue, axis)
 * combination — the same fixed vocabulary the regex engine above uses,
 * exposed so the LLM-verified classification pipeline (generate-stances.ts,
 * post 2026-08-31 rebuild) can label its own axis aggregation consistently,
 * without re-deriving the pair from the motion text every time. Looks up
 * AXIS_PATTERNS first (content axes with their own specific wording), then
 * the "relocation" cross-issue axis, then falls back to the generic
 * approve/deny pair keyed by issue (GENERIC_NOUN) for the
 * "application-approval" axis. Returns null only for an (issue, axis) pair
 * that matches none of the above — callers should treat that as a data
 * error worth surfacing, not silently swallow it. */
export function axisLabelsFor(
  issue: IssueId,
  axis: string,
): { expansive: string; restrictive: string } | null {
  if (axis === "relocation") return RELOCATION_AXIS_LABELS;
  const pattern = (AXIS_PATTERNS[issue] ?? []).find((ap) => ap.axis === axis);
  if (pattern) {
    return {
      expansive: pattern.expansiveLabel,
      restrictive: pattern.restrictiveLabel,
    };
  }
  if (axis === "application-approval") {
    const noun = GENERIC_NOUN[issue] ?? "the item";
    return { expansive: `approved ${noun}`, restrictive: `denied ${noun}` };
  }
  return null;
}
