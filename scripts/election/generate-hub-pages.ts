/**
 * Election Hub — page generator
 *
 * Reads data/election/issues.json + data/election/stances.json (built by
 * generate-stances.ts) plus data/election/wards.json and
 * data/councillors/registry.json, and writes the Election Hub's markdown
 * pages into content/election/. Mirrors the pattern in
 * scripts/generate-pages.ts: deterministic, data-in / markdown-out, safe to
 * re-run.
 *
 * This is a LENS on the real site (see quartz/styles/election-hub.scss for
 * the self-contained styling layer these pages opt into via
 * `cssclasses: [election-hub]`) — it does not touch global layout, global
 * styles, or any non-election content.
 *
 * Usage: npx tsx scripts/election/generate-hub-pages.ts
 */

import fs from "fs/promises";
import path from "path";
import { loadRegistry } from "../../lib/councillors/registry.js";
import { formatDate, buildMethodologyShort } from "./methodology.js";

const REPO_ROOT = process.cwd();
const DATA_DIR = path.join(REPO_ROOT, "data", "election");
const CONTENT_DIR = path.join(REPO_ROOT, "content", "election");

// ---------------------------------------------------------------------------
// Types (mirror the shapes emitted by generate-stances.ts)
// ---------------------------------------------------------------------------

interface Tally {
  yea: number;
  nay: number;
  recuse: number;
  absent: number;
  abstain: number;
  other: number;
}

interface DirectionInfo {
  axis: string | null;
  valence?: number;
  label: string;
  axisLabels?: { expansive: string; restrictive: string };
}

interface IssueVote {
  id: string;
  date: string;
  meetingSlug: string;
  meetingTitle: string;
  meetingType: string;
  meetingUrl: string;
  itemNumber: string;
  itemTitle: string;
  motionText: string;
  result: string;
  passed: boolean;
  margin: number;
  tally: Tally;
  anchor: string | null;
  anchorAmbiguous: boolean;
  matchedKeywords: string[];
  direction: DirectionInfo;
  positions: Record<string, string>;
  // Round-6 gate item 4: honest per-row disclosure for a legitimate
  // supermajority failure (see isSupermajorityFailure/resultNote in
  // generate-stances.ts) — null for every ordinary motion.
  resultNote: string | null;
  // Round-3 gate item 3: a short (~90 char), stage-direction-stripped
  // excerpt of the motion's own text — same field/function
  // (motionSnippet()) the councillor-page evidence tables already carry,
  // now also written onto every issues.json vote row (see writeIssuesFile
  // in generate-stances.ts) so the issue page can differentiate two
  // distinct motions that otherwise collide on date/item/tally.
  motionSnippet: string;
}

interface IssueEntry {
  label: string;
  dividedVoteCount: number;
  directionBearingVoteCount: number;
  distinctAgendaItemCount: number;
  votes: IssueVote[];
}

interface UnclassifiedSample {
  id: string;
  date: string;
  itemNumber: string;
  itemTitle: string;
}

interface IssuesFile {
  generatedAt: string;
  cutoffDate: string;
  methodology: string;
  truncatedDisplayCount: number;
  resultMismatchCount: number;
  rosterConflictCount: number;
  notDividedCount: number;
  unclassified: { count: number; note: string; sample: UnclassifiedSample[] };
  issues: Record<string, IssueEntry>;
}

interface EvidenceRow {
  motionId: string;
  date: string;
  meetingSlug: string;
  meetingTitle: string;
  meetingType: string;
  meetingUrl: string;
  itemNumber: string;
  itemTitle: string;
  motionSnippet: string;
  anchor: string | null;
  anchorAmbiguous: boolean;
  result: string;
  tally: string;
  theirVote: string;
  whatAYeaDid: string;
  movedToward: string | null;
  // Round-6 gate item 4: same disclosure as IssueVote.resultNote, carried
  // on every evidence row (see evidenceEntry in generate-stances.ts) —
  // computed there but, until now, never read by any renderer in this file.
  resultNote: string | null;
}

interface AxisStance {
  axis: string;
  axisLabels: { expansive: string; restrictive: string };
  sampleSize: number;
  distinctItemCount: number;
  evidenceDecisionCount: number;
  // Round-2 gate item 2: count of decision groups axis.ladderExclusions
  // spans — see the matching field in generate-stances.ts. Used by
  // renderAxisSection to name the pattern/excluded decision split
  // explicitly instead of letting evidenceDecisionCount (which spans both)
  // read as if it agreed with distinctItemCount (which counts only the
  // pattern side).
  ladderExcludedDecisionCount: number;
  for: number;
  against: number;
  forPct: string;
  recused: number;
  absent: number;
  abstain: number;
  other: number;
  pattern: string;
  // Round-4 gate item 4: same-decision (see groupIntoDecisions in
  // generate-stances.ts) rows where this councillor's yea/nay votes point
  // in opposite directions on this axis — excluded from sampleSize/for/
  // against/distinctItemCount above, listed here so they're never silently
  // dropped (see renderLadderExclusions).
  ladderExclusions: {
    decisionGroupIndex: number;
    motionId: string;
    date: string;
    meetingSlug: string;
    itemTitle: string;
    anchor: string | null;
    anchorAmbiguous: boolean;
    theirVote: string;
    axisDirection: "for" | "against";
    // Transit-split gate item 3: this row's own independently-verified
    // whatAYeaDid text — see the matching field in generate-stances.ts.
    whatAYeaDid: string;
    // Round-2 gate items 6 and 8: see the matching fields in
    // generate-stances.ts's ladderExclusions push.
    meetingType: string;
    result: string;
    resultNote: string | null;
    // Round-3 gate item 7: this row's own mechanical role in its decision
    // ("amendment" vs "approval of the part"), read off its motion text —
    // see motionRole in generate-stances.ts. Null when the motion's text
    // doesn't match either pattern. Used by renderLadderExclusions only
    // when two-plus rows in the SAME group collide on their whatAYeaDid's
    // opening 40 characters (see that function).
    role: string | null;
  }[];
  evidence: EvidenceRow[];
}

interface IssueStance {
  issueLabel: string;
  divisionsInCorpus: number;
  notOnRoster: number;
  // Round-5 gate BLOCKER item 1: no membership claim in either direction —
  // see generate-stances.ts's attendedAsObserver/noRecordedVote comment.
  attendedAsObserver: number;
  noRecordedVote: number;
  overall: {
    sampleSize: number;
    for: number;
    against: number;
    recused: number;
    absent: number;
    abstain: number;
    other: number;
    ladderExcluded: number;
  };
  axes: AxisStance[];
  unclearCount: number;
  unclearEvidence: EvidenceRow[];
}

interface CouncillorStance {
  displayName: string;
  role: string;
  resultMismatchesExcluding: number;
  issues: Record<string, IssueStance>;
}

interface StancesFile {
  generatedAt: string;
  cutoffDate: string;
  methodology: string;
  councillors: Record<string, CouncillorStance>;
}

interface WardEntry {
  ward: number;
  currentRepSlug: string;
  boundaryChanged2026: boolean;
  incumbent2026Note: string | null;
  source?: string;
}

interface MayoralCandidateEntry {
  slug: string;
  note: string;
  source?: string;
}

interface WardsFile {
  currentTermEndsNote: string;
  boundaryReviewSource: string;
  candidateListSource: string;
  // Round-10 gate item 1: this used to be one hand-authored string,
  // "2026-08-30 (certified list, nominations closed Aug 21 2026, list last
  // modified Aug 28 2026)", mixing a raw ISO date with two more dates in a
  // THIRD format ("Aug 21 2026", neither ISO nor formatDate()'s own
  // "August 21, 2026") in a single sentence. Split into three plain ISO
  // dates so the generator can run every one of them through formatDate()
  // and the sentence ends up in one consistent voter-facing format.
  candidateListCheckedDate: string;
  candidateListNominationsCloseDate: string;
  candidateListLastModifiedDate: string;
  cityWardMapTool: string;
  wards: WardEntry[];
  unresolvedNote: string;
  /** Round-2 finding B5: candidacy notes for current councillors running
   * for Mayor, keyed by slug rather than ward — a sitting Mayor has no ward
   * entry to carry a note through, so this is the only mechanism that can
   * give both current-council Mayor candidates symmetric treatment. See
   * generateCouncillorPage. */
  mayoralCandidates?: MayoralCandidateEntry[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Fixed 2026-08-31 (round-5 gate item 5): a bare `#` immediately followed
 * by a word character (as in "Business Case #P-5", which appears verbatim
 * in source agenda-item titles and motion quotes throughout the corpus)
 * reads to Quartz's Obsidian-tag plugin as the start of an inline tag, not
 * literal punctuation — turning "#P-5" into a spurious /tags/p-5 link and,
 * in at least one row (motion f2f57f834998's whatAYeaDid), corrupting the
 * rest of the cell's rendering around it. Confirmed 2,305 such tag
 * artifacts across 20 generated pages.
 *
 * A literal backslash-escape (`\#`) does NOT fix this: Quartz's tag plugin
 * (quartz/plugins/transformers/ofm.ts, tagRegex + mdastFindReplace) runs on
 * the parsed mdast TEXT nodes, not the raw markdown source — remark's own
 * parser already resolves `\#` to a plain `#` character before the tag
 * plugin ever sees it, so an escaped hash is exactly as vulnerable as a bare
 * one. The only real fix is to not put the character there: any `#`
 * followed by a word character is rewritten to the words "No. " (so
 * "Business Case #P-5" reads "Business Case No. P-5"), never left as a
 * hash. */
function stripHashTagRisk(s: string): string {
  return s.replace(/#(?=\w)/g, "No. ").replace(/ {2,}/g, " ");
}

/** Escape a string for safe use inside a markdown table cell. */
function tcell(s: string): string {
  return stripHashTagRisk(s)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

/** Round-6 gate item 4: append a legitimate-supermajority-failure disclosure
 * (e.g. "failed — required a supermajority") to a table's Result cell when
 * present — computed on every row (see resultNote in generate-stances.ts)
 * but, until now, silently dropped by every renderer in this file. Used by
 * all three markdown table-row templates that show a Result column, so the
 * disclosure can't go missing from one and not the others again. */
function resultCell(result: string, resultNote: string | null): string {
  return resultNote ? `${tcell(result)} (${tcell(resultNote)})` : tcell(result);
}

/** Link to an internal page whose path may contain spaces/parens (meeting
 * slugs do) — wrap the destination in angle brackets, matching the
 * convention already used in scripts/generate-pages.ts. */
function link(text: string, destPath: string): string {
  return `[${tcell(text)}](<${destPath}>)`;
}

/** Best-effort link to the underlying motion: prefer the precomputed
 * heading anchor; fall back to the bare meeting page if the anchor is
 * missing (per the stance-engine's guidance — never treat a null anchor as
 * an error). When `anchorAmbiguous` is true (hub-recheck verdict finding
 * 14), this item number collided with another, different heading on the
 * same page and anchors.ts couldn't tell them apart — the link already
 * goes to the bare meeting page (no fragment), and that's disclosed here
 * rather than left for a reader to notice on their own. */
function motionLink(
  text: string,
  anchor: string | null,
  meetingSlug: string,
  anchorAmbiguous?: boolean,
): string {
  const dest = anchor ?? `/${meetingSlug}`;
  const base = link(text, dest);
  return anchorAmbiguous
    ? `${base} *(links to the meeting page — this item shares its heading with another motion, so no single-motion anchor is possible)*`
    : base;
}

/** Round-2 gate item 8: a committee (any meetingType other than "Council")
 * only ever RECOMMENDS — its votes are never binding on their own, only
 * Council's are. A whatAYeaDid string built from a committee-stage motion's
 * own binding-sounding verb ("Approved...", "Directed...", "Awarded...")
 * reads as if that committee vote settled the matter, when in most cases
 * it's a recommendation still headed to Council. Mechanical, render-time
 * disclosure: suffix " (committee stage)" onto any committee-sourced
 * whatAYeaDid, unless the text already signals its own stage — the
 * "Recommended approving..." house phrasing already used across this
 * corpus (see corrections.json's committee-approval wording sweep), or an
 * explicit "committee stage" mention — so nothing is ever double-suffixed.
 * No text is rewritten; this only ever appends. */
const STAGE_SIGNAL_RE = /^recommended\b|\bcommittee stage\b/i;
function withStageQualifier(whatAYeaDid: string, meetingType: string): string {
  if (meetingType === "Council") return whatAYeaDid;
  if (STAGE_SIGNAL_RE.test(whatAYeaDid)) return whatAYeaDid;
  return `${whatAYeaDid} (committee stage)`;
}

/** Round-3 gate item 0 (STRUCTURAL, do first): the single place every
 * rendered "what a yea did" cell or bullet is built, on EVERY table/bullet
 * template, on BOTH page types (councillor and issue pages). Before this
 * fix there were four independent inline code paths — renderAxisSection's
 * evidence table, renderLadderExclusions' bullets, renderUnclearSection's
 * table, and renderIssueVoteRow's issue-page table — and they had already
 * drifted out of sync in two different ways this consolidation fixes at
 * the root instead of patching each site separately:
 *
 *   1. renderIssueVoteRow (the one site that never went through a shared
 *      helper) gated its placeholder text on `v.direction.axis !== null`
 *      — discarding a real, independently-verified descriptive label on
 *      any motion whose classification carries a label but no directional
 *      axis (see directionFromVerified in generate-stances.ts: BOTH
 *      branches of its return type carry a `label`, always). 297
 *      issue-page rows with a genuine label printed the bare "Not
 *      classified" boilerplate instead of it. The correct gate is LABEL
 *      PRESENCE (hasWhatAYeaDidLabel below), not axis presence.
 *   2. renderIssueVoteRow never called withStageQualifier at all, so a
 *      committee-stage motion's bare binding verb ("Approved...",
 *      "Directed...") went out on issue pages with no stage disclosure —
 *      the same defect class round-2 gate item 8 fixed on councillor
 *      pages, just never applied to the other page type. 102 committee
 *      rows on issue pages had no stage signal.
 *
 * `motion` accepts either shape already in play at each call site: an
 * evidence/ladder-exclusion row's already-resolved `whatAYeaDid` string
 * (this text already carries generate-stances.ts's own
 * `c.direction.label || "unclear"` fallback, and any failed-motion "would
 * have" hedge, baked in upstream at the classification layer — this
 * function only ever sanitizes and passes it through, never rewrites the
 * hedge or the prose itself), or an IssueVote's own `direction` object
 * (same underlying `label` field, read directly since issues.json never
 * pre-resolves the "unclear" fallback the way stances.json does). */
function hasWhatAYeaDidLabel(label: string | null | undefined): boolean {
  return Boolean(label) && label !== "unclear";
}

const WHAT_A_YEA_DID_PLACEHOLDER =
  "Not classified — the direction wasn't clear from the motion text (listed for transparency)";

/** Final gate item 1: the classify/correction layer authors every
 * whatAYeaDid label as a fragment continuing an implicit "[Councillor] ..."
 * subject ("endorsed ...", "added ...", "would have ..."), never as a
 * standalone capitalized sentence — correct where that fragment gets a
 * subject prepended at render time (e.g. renderLadderExclusions' bullets,
 * "- Yea: endorsed ..."), wrong wherever it's the first thing in its own
 * table cell instead. 187 "What a yea did" cells across 20 pages, tracing
 * back to 13 distinct source labels, rendered lowercase-first as a result.
 * Sentence-cased here, at the one render choke point every call site already
 * goes through (see this function's own doc comment below), rather than
 * touching the 13 source labels themselves — those stay grammatically
 * correct continuations for the bullet usage. Applied before
 * withStageQualifier appends its own " (committee stage)" suffix so the
 * capitalized character is always the cell's actual first character, never
 * buried after a qualifier; withStageQualifier only ever appends, so this
 * ordering can't affect its own STAGE_SIGNAL_RE prefix check. A no-op on the
 * placeholder text above, which is already capitalized. */
function sentenceCase(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function renderWhatAYeaDid(
  motion: { whatAYeaDid: string } | { direction: DirectionInfo },
  context: { meetingType: string },
): string {
  const raw = "direction" in motion ? motion.direction.label : motion.whatAYeaDid;
  const label = sentenceCase(hasWhatAYeaDidLabel(raw) ? raw : WHAT_A_YEA_DID_PLACEHOLDER);
  return tcell(withStageQualifier(label, context.meetingType));
}

const VOTE_LABEL: Record<string, string> = {
  yea: "Yea",
  nay: "Nay",
  recuse: "Recused",
  absent: "Absent",
  abstain: "Abstained",
  other: "Other",
};

// Reworded 2026-08-31 (round-2 finding B4, then round-3 gate BLOCKER): two
// separate overclaims fixed here.
//  1. "most link straight to that specific motion's own heading" was false
//     on its own terms — anchors.ts's own module doc says multiple motion
//     parts (a, b, c...) under one agenda item NORMALLY share one heading,
//     which is the source page's own structure, not an edge case. A shared
//     heading is the common case, not something "most" rows avoid; the old
//     wording also conflated that (harmless, expected) sharing with
//     anchorAmbiguous (a genuine collision between two DIFFERENT headings,
//     where no fragment can be built at all — see anchors.ts). Reworded to
//     describe what a link actually resolves to in each case, instead of
//     promising motion-level precision most rows don't have and don't need.
//  2. "stay linked below for transparency" is now true — unclear-direction
//     motions render in their own grouped, clearly labeled section on every
//     issue a councillor has one for (see renderUnclearSection below); they
//     used to be filtered out entirely despite this exact promise.
const STANDING_DISCLAIMER = `> **This is a descriptive record, not an endorsement.** Every pattern below is built from real recorded votes since 2023, translated from raw yea/nay into what the vote actually did (see [What Council Actually Controls](/election/what-council-controls) for how much of this any of them controls). It says nothing about a councillor's reasons, character, or fitness for office — only how they voted. Votes with no clear direction ("unclear") are excluded from the pattern counts but listed in their own section below for transparency. Every row links to its source: to the heading for the specific agenda item the motion belongs to (several motion parts under one item normally share that one heading — that's how the source pages are laid out, not an error), or, where an item number is reused for two genuinely different, unrelated motions with no way to tell them apart, to the meeting page as a whole instead (the row says so when that happens).`;

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

async function loadJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Landing page: /election
// ---------------------------------------------------------------------------

function generateIndexPage(issues: IssuesFile, stances: StancesFile): string {
  const councillorSlugs = Object.keys(stances.councillors);
  const issueRows = Object.entries(issues.issues)
    .sort((a, b) => b[1].dividedVoteCount - a[1].dividedVoteCount)
    .map(
      ([slug, entry]) =>
        `- [${entry.label}](/election/issues/${slug}) — ${entry.dividedVoteCount} divided votes since 2023, ${entry.directionBearingVoteCount} with a clear direction`,
    )
    .join("\n");

  const registry = loadRegistry();
  const councillorRows = councillorSlugs
    .map((slug) => stances.councillors[slug])
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map(
      (c) =>
        `- [${c.displayName}](/election/councillors/${slugFor(registry, c.displayName)}) — ${c.role}`,
    )
    .join("\n");

  return `---
title: "The Election Lens"
cssclasses:
  - election-hub
  - hide-folder-listing
prefillQuestions: []
---

<p class="eh-kicker">Open Council · Election Lens · 2026</p>

London elects a new mayor and 14 ward councillors on **October 26, 2026**. This page is a lens laid over the real record on [Open Council](/) — every number and every link here comes from the same council-meeting data the rest of the site is built on. Nothing here is new information; it's the existing record of the **current council (2022–2026)**, organized around the questions an election raises.

Raw yea/nay votes don't tell you much on their own — a "yea" on a motion to increase permitted density and a "yea" on a motion to remove where townhouses are allowed point in opposite directions. Every position summarized here has been translated into **what the vote actually did**, with the underlying motion linked so you can check the translation yourself.

<div class="eh-callout">
This is a descriptive record of how the current council voted. It is not an endorsement of any candidate, and it does not tell you who to vote for.
</div>

## Find your ward

New ward boundaries take effect for this election. [Look up your current representative and what's on your Oct 26 ballot →](/election/wards)

## What council actually controls

Zoning and the budget, yes. Policing and healthcare, mostly not. [Read the plain-language breakdown, sourced line by line →](/election/what-council-controls)

## Divided votes by issue

These are the issues where council has actually split since 2023 — where a vote wasn't unanimous, and wasn't purely procedural. ${issues.unclassified.count.toLocaleString()} additional divided motions since 2023 were independently classified as not fitting any of these tracked issue clusters, and are not force-fit into one; all of them are listed on the [issues page](/election/issues).

${issueRows}

## Councillor stance profiles

Full voting pattern per councillor per issue, current council (the Mayor plus 14 ward councillors, 15 seats in total). Every pattern sentence links to its evidence.

Only sitting councillors appear here, because only sitting councillors have a council voting record to summarize. Challengers are not covered, and their absence from these pages is not a judgement about them. For everyone actually on your ballot, see the City Clerk's certified list of candidates (linked on the [ward finder](/election/wards)).

${councillorRows}

---

Methodology: ${buildMethodologyShort(issues.cutoffDate)}
`;
}

// ---------------------------------------------------------------------------
// Councillor stance profile pages: /election/councillors/{slug}
// ---------------------------------------------------------------------------

function slugFor(
  registry: ReturnType<typeof loadRegistry>,
  displayName: string,
): string {
  for (const info of Object.values(registry)) {
    if (info.displayName === displayName) return info.slug;
  }
  return displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Round-4 gate item 4: honest disclosure for a councillor's votes that
 * were excluded from this axis's for/against tally because, within one
 * same-day/same-subject decision group (an amendment ladder — e.g. a
 * weaker, conditional wording voted down, then a stronger, unconditional
 * wording of the same restriction passed minutes later), their votes
 * pointed in more than one direction. Never silently dropped — grouped by
 * decisionGroupIndex so a reader sees exactly which sibling motions
 * conflicted and how. */
function renderLadderExclusions(axis: AxisStance): string {
  if (axis.ladderExclusions.length === 0) return "";
  const groups = new Map<number, AxisStance["ladderExclusions"]>();
  for (const ex of axis.ladderExclusions) {
    let g = groups.get(ex.decisionGroupIndex);
    if (!g) {
      g = [];
      groups.set(ex.decisionGroupIndex, g);
    }
    g.push(ex);
  }
  // Fixed 2026-08-31 (round-2 gate item 5): this used to join every row in
  // one decision group into a SINGLE run-on bullet with "; " — several
  // distinct motions, each with its own date, link, and result, buried
  // inside one list item a reader can't cite or link to individually. Each
  // row is now its own bullet; a blank line still separates one decision
  // group's bullets from the next, so a reader can still tell where one
  // ladder ends and another begins.
  const items = [...groups.values()]
    .map((rows) => {
      // Round-2 gate item 8/round-3 gate item 0: withStageQualifier — see
      // renderWhatAYeaDid's own doc comment. Round-3 gate item 0: routed
      // through the single shared helper instead of its own inline call.
      const rendered = rows.map((ex) => ({
        ex,
        link: motionLink(
          ex.itemTitle || "(untitled item)",
          ex.anchor,
          ex.meetingSlug,
          ex.anchorAmbiguous,
        ),
        theirVote: VOTE_LABEL[ex.theirVote] ?? ex.theirVote,
        // Fixed 2026-08-31 (transit-split gate item 3): the link text alone
        // (itemTitle) is identical for every row in a group whose motions
        // share one agenda item — a reader could not tell one
        // ladder-excluded motion from another. ex.whatAYeaDid is this row's
        // own independently-verified description of what THIS motion did
        // (same text the evidence table's own column shows).
        whatAYeaDid: renderWhatAYeaDid(
          { whatAYeaDid: ex.whatAYeaDid },
          { meetingType: ex.meetingType },
        ),
      }));
      // Round-3 gate item 7: when two-plus bullets in this SAME decision
      // group share their rendered whatAYeaDid's opening 40 characters, the
      // per-row result tally appended below (round-2 gate item 6) is the
      // ONLY thing left telling them apart — a reader has to notice and
      // compare a bare tally number by hand. Append each colliding row's
      // own distinguishing ROLE (see motionRole in generate-stances.ts:
      // "amendment" vs "approval of the part", read mechanically off that
      // row's own motion text, never guessed at) whenever it has one.
      // Worked example: e-peloza.md's Ark Aid day drop-in pair
      // (1c0f60d005b5/d2ed469d2746) both open "Approved funding to
      // continue Ark Aid's " — 1c0f60d005b5 is the amendment adding part
      // c), d2ed469d2746 is Council's approval of that part as amended.
      const prefixCounts = new Map<string, number>();
      for (const r of rendered) {
        const prefix = r.whatAYeaDid.slice(0, 40);
        prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
      }
      return rendered
        .map(({ ex, link, theirVote, whatAYeaDid }) => {
          const prefix = whatAYeaDid.slice(0, 40);
          const collides = (prefixCounts.get(prefix) ?? 0) > 1;
          const roleSuffix = collides && ex.role ? ` (${ex.role})` : "";
          // Fixed 2026-08-31 (round-2 gate item 6): two rows in the same
          // decision group can otherwise share an identical
          // whatAYeaDid/date/item/direction — e.g. 1c0f60d005b5 and
          // d2ed469d2746, two SEPARATE recorded votes on the literal same
          // part c) text, at the same meeting, moved by different
          // councillors — and render byte-identical. Appending each row's
          // own result tally (its one field that actually differs, e.g.
          // "Motion Passed (11 to 3)" vs "Motion Passed (9 to 5)") means no
          // two bullets in one group are ever identical; see
          // verify-ladder-bullets-distinct.py.
          return `- ${theirVote}: ${whatAYeaDid}${roleSuffix} — ${link} (${formatDate(ex.date)}, counts as ${ex.axisDirection}, ${resultCell(ex.result, ex.resultNote)})`;
        })
        .join("\n");
    })
    .join("\n\n");
  const n = axis.ladderExclusions.length;
  const groupCount = groups.size;
  // Fixed 2026-08-31 (round-2 gate item 3): "different wordings of the same
  // decision" asserted every excluded group was an amendment-wording
  // dispute — false for a decision like Trosow's road-capacity ratification
  // (an amendment vote, then a separate ratification vote on the amended
  // whole; not two wordings of one question). Reworded to the fact this
  // data actually proves for every group here, wording dispute or not: the
  // councillor's own recorded votes, within one decision, landed on
  // different sides across that decision's stages.
  const decisionPhrase =
    groupCount === 1 ? "this decision" : `each of these ${groupCount} decisions`;
  const itsTheir = groupCount === 1 ? "its" : "their";
  return `
**${n} vote${n === 1 ? "" : "s"} excluded from the pattern above:** this councillor's recorded votes within ${decisionPhrase} pointed in different directions across ${itsTheir} stages, so none are counted in the tallies; each is listed here:

${items}
`;
}

function renderAxisSection(axis: AxisStance): string {
  const evidenceRows = axis.evidence
    .map((ev) => {
      const itemLink = motionLink(
        ev.itemTitle || "(untitled item)",
        ev.anchor,
        ev.meetingSlug,
        ev.anchorAmbiguous,
      );
      const theirVote = VOTE_LABEL[ev.theirVote] ?? ev.theirVote;
      const movedToward = ev.movedToward ?? "—";
      // Round-10 gate item 4 (mobile column order): "Their vote" moved to
      // the second column, right after Date, so a phone reader sees the
      // vote itself without swiping the table sideways — see the matching
      // header reorder below.
      // Round-3 gate item 0: routed through the single shared helper — see
      // renderWhatAYeaDid's own doc comment.
      const whatAYeaDid = renderWhatAYeaDid(
        { whatAYeaDid: ev.whatAYeaDid },
        { meetingType: ev.meetingType },
      );
      return `| ${ev.date} | ${theirVote} | ${whatAYeaDid} | ${itemLink} | ${tcell(ev.motionSnippet)} | ${tcell(movedToward)} | ${resultCell(ev.result, ev.resultNote)} |`;
    })
    .join("\n");

  // Fixed 2026-08-31 (round-4 gate item 6, render minor): this used to
  // count "distinct agenda items" by literal (meetingSlug, itemNumber)
  // pairs — a DIFFERENT grouping than axis.distinctItemCount's decision-
  // level union-find (same-day, same-title-or-business-case-number rows
  // merged), so the two numbers could disagree right next to each other on
  // the page with no explanation (j-morgan/Policing: prose said "4
  // distinct decisions", this note said "5 distinct agenda items", same
  // six real votes). Now sourced from evidenceDecisionCount — the same
  // decision grouping, applied to every row in this table (see
  // generate-stances.ts) — so it can only disagree with the prose above it
  // when the prose is counting a different SUBSET of rows (distinctItemCount
  // excludes recusals/absences on purpose), never a different definition of
  // "distinct".
  // Fixed 2026-08-31 (round-2 gate item 2): when this axis has ladder
  // exclusions, evidenceDecisionCount spans BOTH the pattern-side decisions
  // (axis.distinctItemCount) and the excluded-side decisions
  // (axis.ladderExcludedDecisionCount) — printing it bare, the way this
  // note always has, could read as agreeing or disagreeing with the
  // pattern sentence's own "N distinct decisions" above with no indication
  // it's actually counting a wider set. Named explicitly whenever there's
  // an excluded side to name.
  const decisionSplitNote =
    axis.ladderExcludedDecisionCount > 0
      ? ` — ${axis.distinctItemCount} behind this pattern, ${axis.ladderExcludedDecisionCount} excluded from it, see above`
      : "";
  const itemsNote =
    axis.evidenceDecisionCount < axis.evidence.length
      ? ` (${axis.evidence.length} rows across ${axis.evidenceDecisionCount} distinct decision${axis.evidenceDecisionCount === 1 ? "" : "s"}${decisionSplitNote} — some decisions had more than one recorded sub-motion or meeting stage, or a recorded absence/recusal alongside a vote)`
      : "";

  // Fixed 2026-08-31 (hub-recheck verdict finding 9): the evidence table
  // includes every position on this axis's motions, not just yea/nay
  // votes — a recusal or an absence isn't a "vote". "Show all N votes"
  // mislabeled non-vote rows as votes in ~39 places across the hub; this
  // counts real yea/nay votes separately from the row total and only calls
  // them "votes".
  const realVoteCount = axis.evidence.filter(
    (ev) => ev.theirVote === "yea" || ev.theirVote === "nay",
  ).length;
  // Fixed 2026-08-31 (round-2 gate item 2): realVoteCount includes any
  // ladder-excluded yea/nay rows — same rows already shown, individually,
  // in their own "excluded from the pattern above" box right before this
  // table (renderLadderExclusions). Those are NOT "behind this pattern"
  // (that's the entire reason they're excluded from
  // axis.sampleSize/distinctItemCount) — split out here so the summary
  // line below can never claim otherwise. patternVoteCount always equals
  // axis.sampleSize when this axis's evidence is exactly its yea/nay rows
  // (it can differ only if a future evidence source diverges from the
  // ladder-adjusted tally, which would itself be a bug this equality would
  // surface).
  const excludedVoteCount = axis.ladderExclusions.length;
  const patternVoteCount = realVoteCount - excludedVoteCount;
  // Fixed 2026-08-31 (round-10 gate item 3): the parenthetical breakdown
  // used to name BOTH categories unconditionally — "0 votes, 1
  // recusal/absence/other" — whenever the row total and the real-vote
  // count differed at all, even though that branch only guarantees the
  // NON-vote category is non-empty; the vote category can legitimately be
  // zero (an axis whose only evidence rows are recusals/absences). Only
  // named here when its own count is > 0. "rows" also used to stay plural
  // even at a count of 1.
  const nonVoteCount = axis.evidence.length - realVoteCount;
  const breakdownParts: string[] = [];
  if (excludedVoteCount > 0) {
    if (patternVoteCount > 0) {
      breakdownParts.push(
        `${patternVoteCount} vote${patternVoteCount === 1 ? "" : "s"} behind this pattern`,
      );
    }
    breakdownParts.push(
      `${excludedVoteCount} vote${excludedVoteCount === 1 ? "" : "s"} excluded from it, see above`,
    );
  } else if (realVoteCount > 0) {
    breakdownParts.push(`${realVoteCount} vote${realVoteCount === 1 ? "" : "s"}`);
  }
  if (nonVoteCount > 0) {
    breakdownParts.push(
      `${nonVoteCount} recusal${nonVoteCount === 1 ? "" : "s"}/absence${nonVoteCount === 1 ? "" : "s"}/other`,
    );
  }
  // Fixed 2026-08-31 (round-2 gate item 2): "Show all N votes BEHIND THIS
  // PATTERN" is only true when every row in the table actually is — false
  // for an axis with ladder exclusions, where some of those N rows are the
  // exact ones the box above just said are excluded from the pattern. Once
  // any votes are excluded, the header drops the blanket claim and the
  // per-bucket breakdown (built above) carries it instead, scoped to only
  // the votes it's actually true of.
  const summaryText =
    excludedVoteCount > 0
      ? `Show all ${axis.evidence.length} row${axis.evidence.length === 1 ? "" : "s"} on this axis (${breakdownParts.join(", ")})${itemsNote}`
      : realVoteCount === axis.evidence.length
        ? `Show all ${realVoteCount} vote${realVoteCount === 1 ? "" : "s"} behind this pattern${itemsNote}`
        : `Show all ${axis.evidence.length} row${axis.evidence.length === 1 ? "" : "s"} behind this pattern (${breakdownParts.join(", ")})${itemsNote}`;

  return `#### ${axis.axisLabels.expansive} vs. ${axis.axisLabels.restrictive}

${axis.pattern}
${renderLadderExclusions(axis)}
<details class="eh-evidence">
<summary>${summaryText}</summary>

| Date | Their vote | What a yea did | Item | Motion (excerpt) | Their vote moved toward | Result |
|------|------------|-----------------|------|-------------------|--------------------------|--------|
${evidenceRows}


</details>
`;
}

// Fixed 2026-08-31 (hub-recheck verdict finding 10): the strong-mayor
// budget-caveat explainer lived only in the page footer, ~370 lines below
// the Budget section it actually qualifies, despite a commit message
// claiming it was linked from every budget note. Every Budget issue section
// now carries its own inline link right where a reader hits budget votes.
const BUDGET_CAVEAT =
  "\n\n> Budget votes since 2024 are votes on **amendments** to the Mayor's tabled budget under Ontario's strong-mayor powers, not on an independently council-drafted budget — see [what that changes about what a budget vote means](/election/what-council-controls#who-tables-the-budget).";

/** Grouped, clearly-labeled render of the unclear-direction motions this
 * councillor voted/recused/was-absent on for one issue — added 2026-08-31
 * (hub-recheck round-3 gate BLOCKER) so the standing disclaimer's promise
 * that these "stay linked below for transparency" is actually true. Never
 * counted in any pattern or sample-size figure above it; a plain list, not
 * styled as evidence for a claim, because there is no claim here — these
 * are exactly the motions the classify pipeline could NOT support a
 * direction for. */
function renderUnclearSection(issue: IssueStance): string {
  if (issue.unclearEvidence.length === 0) return "";
  const rows = issue.unclearEvidence
    .map((ev) => {
      const itemLink = motionLink(
        ev.itemTitle || "(untitled item)",
        ev.anchor,
        ev.meetingSlug,
        ev.anchorAmbiguous,
      );
      const theirVote = VOTE_LABEL[ev.theirVote] ?? ev.theirVote;
      // Fixed 2026-08-31 (round-4 gate item 6): whatAYeaDid — the verified
      // classification pipeline's own plain-English description of what
      // this clause did — already existed on every unclearEvidence row in
      // stances.json (see evidenceEntry in generate-stances.ts) but was
      // never rendered here, leaving "no clear direction" motions with
      // nothing but a raw motion-text excerpt to explain them.
      // Round-10 gate item 4: "Their vote" moved to the second column, same
      // reorder as renderAxisSection's evidence table above.
      // Round-3 gate item 0: routed through the single shared helper — see
      // renderWhatAYeaDid's own doc comment.
      const whatAYeaDid = renderWhatAYeaDid(
        { whatAYeaDid: ev.whatAYeaDid },
        { meetingType: ev.meetingType },
      );
      return `| ${ev.date} | ${theirVote} | ${whatAYeaDid} | ${itemLink} | ${tcell(ev.motionSnippet)} | ${resultCell(ev.result, ev.resultNote)} |`;
    })
    .join("\n");

  return `
<details class="eh-evidence">
<summary>${issue.unclearEvidence.length} motion${issue.unclearEvidence.length === 1 ? "" : "s"} with no clear direction on this issue (excluded from the pattern counts above; shown for transparency, not as evidence of a position)</summary>

| Date | Their vote | What a yea did | Item | Motion (excerpt) | Result |
|------|------------|-----------------|------|-------------------|--------|
${rows}


</details>
`;
}

function renderIssueSection(issueSlug: string, issue: IssueStance): string {
  const o = issue.overall;
  const axesMd = issue.axes.map(renderAxisSection).join("\n");

  // Fixed 2026-08-31 (round-7 gate item 2, the round-5 defect's third
  // form): a "recorded position" is a recorded YEA OR NAY, nothing else.
  // Earlier wording folded recused/absent/abstain/other into "has a
  // recorded position on N of them" — those are recorded STATUSES, not
  // positions, and the page's own footer already says so ("a recusal...
  // is shown separately... and never counted as a position"); this
  // sentence used to contradict that footer outright. N = o.sampleSize
  // (real yea/nay votes counted in the pattern above) + o.ladderExcluded
  // (real yea/nay votes this councillor actually cast, pulled out of the
  // pattern tally only because they pointed a different way than a
  // same-decision sibling vote — still a recorded position, just excluded
  // from pattern aggregation, so it's disclosed with its own parenthetical
  // rather than silently absorbed into or dropped from N). Recused,
  // absent, abstained, and other are reported in their own clause below,
  // never counted toward N — this is the same arithmetic the evidence
  // tables and the page footer already use (divisionsInCorpus === N +
  // recused + absent + abstain + other + notOnRoster), just finally
  // reflected in this sentence too. See verify-n-semantics.py for the
  // corpus-wide check that the section sentence, the footer, and every
  // axis's evidence table agree on these buckets.
  const recordedPositionCount = o.sampleSize + o.ladderExcluded;
  const ladderPositionNote =
    o.ladderExcluded > 0
      ? ` (${o.ladderExcluded} of these are excluded from the pattern counts — see below)`
      : "";
  // Fixed 2026-08-31 (round-10 gate item 3 audit): this used to name
  // "recused"/"absent" unconditionally — "0 recused, 0 absent." — even
  // when both were zero and only abstain/other (already conditional) had
  // anything to report, or when nothing at all did, publishing two vacuous
  // zero-count facts as if they were findings. Same shape as the evidence-
  // table zero-count clause this round's item 3 fixed; audited into and
  // fixed here too. Every category named only when its own count is > 0;
  // the whole clause disappears when all four are zero.
  const nonPositionBits: string[] = [];
  if (o.recused > 0) nonPositionBits.push(`${o.recused} recused`);
  if (o.absent > 0) nonPositionBits.push(`${o.absent} absent`);
  if (o.abstain > 0) nonPositionBits.push(`${o.abstain} abstained`);
  if (o.other > 0) nonPositionBits.push(`${o.other} other`);
  const nonPositionClause = nonPositionBits.length
    ? ` ${nonPositionBits.join(", ")}.`
    : "";

  // Fixed 2026-08-31 (round-6 gate BLOCKER: the round-5 fix INVERTED this
  // claim instead of eliminating it — "was on the roster for" / "attended
  // as an observer (only committee members vote)" still asserted a status,
  // just the opposite one). Every earlier version of this clause asserted
  // something about committee MEMBERSHIP to explain a missing position —
  // round-3 inferred it from other votes at the same meeting, round-4 from
  // the meeting's present/remote_attendance/absent fields treated as a
  // membership roster, round-5 kept the roster/observer framing and just
  // flipped which side of it a given row landed on. This repo has no
  // membership source at all, so nothing below uses the words "roster",
  // "member", or "observer" in any form, and claims neither membership NOR
  // non-membership in either direction, for a committee or a Council
  // meeting. It states only what the source data proves: named in that
  // meeting's own `also_present` field, or nothing else can be said (no
  // recorded vote).
  const notOnRosterBits: string[] = [];
  if (issue.attendedAsObserver > 0) {
    const n = issue.attendedAsObserver;
    notOnRosterBits.push(
      `${n} ${n === 1 ? "was a" : "were"} motion${n === 1 ? "" : "s"} at a meeting where this councillor was listed as also present (no vote recorded)`,
    );
  }
  if (issue.noRecordedVote > 0) {
    const n = issue.noRecordedVote;
    notOnRosterBits.push(
      `${n} ${n === 1 ? "was a" : "were"} motion${n === 1 ? "" : "s"} with no recorded vote for this councillor at that meeting`,
    );
  }
  const notOnRosterClause = notOnRosterBits.length
    ? ` The other ${issue.notOnRoster}: ${notOnRosterBits.join("; ")}.`
    : "";

  const caveat = issueSlug === "budget" ? BUDGET_CAVEAT : "";

  return `### [${issue.issueLabel}](/election/issues/${issueSlug})

*Of the ${issue.divisionsInCorpus} divided votes on this issue since 2023 that had a clear direction, this councillor has a recorded position on ${recordedPositionCount} of them${ladderPositionNote}.${nonPositionClause}${notOnRosterClause}*${caveat}

${axesMd}
${renderUnclearSection(issue)}`;
}

function generateCouncillorPage(
  slug: string,
  c: CouncillorStance,
  ward: WardEntry | undefined,
  mayoralCandidates: MayoralCandidateEntry[],
  methodology: string,
): string {
  const issueSlugs = Object.keys(c.issues).sort(
    (a, b) => c.issues[b].divisionsInCorpus - c.issues[a].divisionsInCorpus,
  );
  const sections = issueSlugs
    .map((issSlug) => renderIssueSection(issSlug, c.issues[issSlug]))
    .join("\n\n");

  const roleLine = ward
    ? `${c.role}, Ward ${ward.ward} (2022–2026 boundaries)`
    : c.role;

  // Fixed 2026-08-31 (hub-recheck verdict finding 11, then round-2 finding
  // B5): 2026 candidacy data already exists in data/election/wards.json but
  // wasn't plumbed onto the councillor's own profile page. The first fix
  // only sourced this from the WARD entry's incumbent2026Note — which gave
  // Stevenson (Ward 4) a mayoral-candidacy note but structurally could
  // never give the sitting Mayor (Morgan) one, since a Mayor has no ward
  // entry to carry it. Now built from two independent, combinable sources:
  // the ward-level note (any councillor not seeking re-election to their
  // own seat, or moving wards) and a slug-keyed mayoralCandidates note (any
  // current councillor certified as a Mayor candidate) — so both current
  // Mayor candidates get the same neutral, symmetric treatment regardless
  // of whether they currently hold a ward seat. Wording carried over
  // verbatim from wards.json — no new claims are made here, just surfaced
  // where a reader is actually looking.
  const mayoralNote = mayoralCandidates.find((m) => m.slug === slug)?.note;
  const candidacyBits = [ward?.incumbent2026Note, mayoralNote].filter(
    (n): n is string => Boolean(n),
  );
  const candidacyNote = candidacyBits.length
    ? `\n> **2026 candidacy:** ${candidacyBits.join(" ")} See the [certified candidate list](/election/wards) for the authoritative source.\n`
    : "";

  // Fixed 2026-08-31 (round-7 gate item 5): the previous wording ("...or
  // whose committee assignments didn't overlap with any issue's divided
  // votes") asserted committee membership by implication — exactly the
  // claim class round-5/6 eliminated everywhere else on this hub (see the
  // long comment above notOnRosterBits). This repo has no membership
  // source, so this fallback makes no claim about why a councillor has no
  // recorded position on any tracked issue — only that none exists.
  const noPatternNote =
    issueSlugs.length === 0
      ? "\nNo divided votes in the tracked issues carry a recorded yea or nay from this councillor in this period.\n"
      : "";

  // Fixed 2026-08-31 (hub-recheck verdict finding 6, per-profile
  // disclosure): how many result/vote-array-mismatched motions named this
  // councillor, and were dropped from the divided-vote universe before
  // they could be used for any claim here.
  const mismatchNote =
    c.resultMismatchesExcluding > 0
      ? ` ${c.resultMismatchesExcluding} additional divided motion${c.resultMismatchesExcluding === 1 ? "" : "s"} naming ${c.displayName} ${c.resultMismatchesExcluding === 1 ? "was" : "were"} excluded entirely because the motion's own minuted result disagreed with its recorded vote count — not used for any claim above.`
      : "";

  return `---
title: "${c.displayName} — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Councillor Stance Profile</p>

# ${c.displayName}

${roleLine} · [Full voting record on Open Council →](/councillors/current/${slug})
${candidacyNote}
${STANDING_DISCLAIMER}
${noPatternNote}
${sections}

---

*Sample sizes above count only votes where ${c.displayName} cast a yea or nay on a motion the verified per-motion classification (see [methodology](/election/issues)) could place on a clear "for"/"against" axis. A recusal means the councillor formally withdrew from discussing and voting on that item — this data does not record why, so no reason is asserted here — and, like an absence, is shown separately in each issue's summary line and never counted as a position.${mismatchNote} Only sitting councillors get a stance profile on this hub; challengers don't yet have a council voting record to summarize.*

---

Methodology: ${tcell(methodology)}
`;
}

// ---------------------------------------------------------------------------
// Issue pages: /election/issues/{slug}
// ---------------------------------------------------------------------------

/** Parse the "(N to M)" tally out of a motion's own result string — same
 * pattern as anchors.ts/generate-stances.ts (kept local rather than shared,
 * since this script's only use is the disagreement check below). */
function extractResultTally(
  resultText: string,
): { yea: number; nay: number } | null {
  const m = resultText.match(/\((\d+)\s*(?:to|[-–—])\s*(\d+)\)/i);
  return m ? { yea: Number(m[1]), nay: Number(m[2]) } : null;
}

function renderIssueVoteRow(v: IssueVote): string {
  const itemLink = motionLink(
    v.itemTitle || "(untitled item)",
    v.anchor,
    v.meetingSlug,
    v.anchorAmbiguous,
  );
  // Round-3 gate item 0: routed through the single shared helper — see
  // renderWhatAYeaDid's own doc comment for the two defects this fixes
  // (the false axis-presence gate, and the missing stage qualifier).
  const whatAYeaDid = renderWhatAYeaDid(
    { direction: v.direction },
    { meetingType: v.meetingType },
  );
  // Fixed 2026-08-31 (hub-recheck verdict finding 7): the Tally column was
  // previously deleted rather than fixing the cause — a comment admitted
  // the parsed yeas/nays count "disagreed in plain sight" with the minuted
  // Result, then removed the exposing column while still using those same
  // arrays as the source for every claim on this hub. generate-stances.ts
  // now hard-excludes any motion whose result disagrees with its parsed
  // arrays before it ever reaches this page (see result-mismatches.json),
  // so the two numbers below should always agree — but the column is
  // restored, WITH a visible flag if they ever don't, rather than trusting
  // that silently and hiding the check that would catch a regression.
  const parsedTally = `${v.tally.yea}-${v.tally.nay}`;
  const resultTally = extractResultTally(v.result);
  const disagrees =
    resultTally !== null &&
    (resultTally.yea !== v.tally.yea || resultTally.nay !== v.tally.nay);
  const tallyCell = disagrees
    ? `${parsedTally} ⚠️ disagrees with minuted result`
    : parsedTally;
  // Round-3 gate item 3: two distinct motions on the same issue can share
  // the same date/item/tally (e.g. a committee-stage vote and its own
  // Council ratification, or two sub-motions under one shared heading) and
  // render byte-identical rows with no way to tell them apart. This
  // excerpt (same motionSnippet() function/field the councillor-page
  // evidence tables already carry — see writeIssuesFile in
  // generate-stances.ts) is the one field that reliably differs between
  // two otherwise-identical-looking rows; see
  // verify-issue-page-rows-distinct.py.
  return `| ${v.date} | ${itemLink} | ${whatAYeaDid} | ${tcell(v.motionSnippet)} | ${tcell(tallyCell)} | ${resultCell(v.result, v.resultNote)} |`;
}

// hub-recheck verdict finding 12: issue pages had no disclaimer at all, and
// never disclosed the roster-conflict / truncation-exclusion counts that
// shape what's (and isn't) on the page.
const ISSUE_PAGE_DISCLAIMER = `> **This is a descriptive record, not an endorsement.** Every row below is a real recorded council or committee vote since 2023. It says nothing about a councillor's reasons, character, or fitness for office — only what was voted on and what a yea did. See [What Council Actually Controls](/election/what-council-controls) for how much of this any councillor actually controls.`;

function generateIssuePage(
  issue: IssueEntry,
  methodology: string,
  cutoffDate: string,
): string {
  const sorted = [...issue.votes].sort((a, b) => b.date.localeCompare(a.date));
  const rows = sorted.map(renderIssueVoteRow).join("\n");
  // Fixed 2026-08-31 (round-3 gate item 2): the old sentence ("N of those
  // had a clear direction; M did not and are marked below rather than
  // guessed at") was false on every one of the 8 issue pages — it folded
  // TWO different populations into that single "did not" clause: motions
  // with a real, independently-verified descriptive label but no
  // directional axis (these DO have a description; they're just not
  // countable on a for/against axis), and motions that are genuinely
  // unclear (no usable description at all). Recomputed directly from each
  // vote's own direction, not trusted from directionBearingVoteCount alone
  // (that field only ever covered the first bucket): X carry a clear
  // direction on a tracked axis (the only bucket counted in any pattern on
  // this hub); Y carry a descriptive label but no directional axis (listed
  // below, never counted); Z are genuinely unclear from the motion text.
  const clearCount = issue.votes.filter((v) => v.direction.axis !== null).length;
  const labeledNoAxisCount = issue.votes.filter(
    (v) => v.direction.axis === null && hasWhatAYeaDidLabel(v.direction.label),
  ).length;
  const genuinelyUnclearCount =
    issue.votes.length - clearCount - labeledNoAxisCount;

  return `---
title: "${issue.label} — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Issue</p>

# ${issue.label}

${issue.dividedVoteCount} divided (non-unanimous, non-procedural) council or committee votes on this issue since ${formatDate(cutoffDate)}: ${clearCount} carry a clear direction on a tracked axis (counted in the patterns on each councillor's [stance profile](/election#councillor-stance-profiles)); ${labeledNoAxisCount} carry a descriptive label but no directional axis (listed below, not counted in any pattern); ${genuinelyUnclearCount} ${genuinelyUnclearCount === 1 ? "is" : "are"} genuinely unclear from the motion text.

${ISSUE_PAGE_DISCLAIMER}

For how each current councillor voted on these, see their [stance profile](/election#councillor-stance-profiles).

| Date | Item | What a yea did | Motion (excerpt) | Tally | Result |
|------|------|-----------------|-------------------|:---:|--------|
${rows}


---

Methodology: ${tcell(methodology)}
`;
}

function generateIssuesIndexPage(issues: IssuesFile): string {
  const rows = Object.entries(issues.issues)
    .sort((a, b) => b[1].dividedVoteCount - a[1].dividedVoteCount)
    .map(
      ([slug, entry]) =>
        `| [${entry.label}](/election/issues/${slug}) | ${entry.dividedVoteCount} | ${entry.directionBearingVoteCount} |`,
    )
    .join("\n");

  const sampleRows = issues.unclassified.sample
    .map(
      (s) =>
        `- ${formatDate(s.date)} — ${tcell(s.itemTitle)} (item ${s.itemNumber})`,
    )
    .join("\n");

  return `---
title: "Divided Votes by Issue — Election Lens"
cssclasses:
  - election-hub
  - hide-folder-listing
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Issues</p>

# Divided votes by issue

Council doesn't split on most of what it votes on — most motions pass unanimously. These are the issues where it has actually divided since ${formatDate(issues.cutoffDate)}.

| Issue | Divided votes | With a clear direction |
|-------|:---:|:---:|
${rows}


## Unclassified divided votes

${issues.unclassified.count.toLocaleString()} additional divided motions since ${formatDate(issues.cutoffDate)} were independently classified as not fitting any of the issue clusters above (or as an explicit governance/procedure exclusion), and are not force-fit into one. All ${issues.unclassified.sample.length.toLocaleString()} are listed below:

${sampleRows}

*${tcell(issues.unclassified.note)} Separately, ${issues.truncatedDisplayCount.toLocaleString()} classified motions have a motion-text excerpt on this hub that's cut off at a 500-character display cap in the source data — this affects how much of the quoted text you see, not the classification itself, which was independently verified against each motion's complete text in the source meeting record. ${issues.notDividedCount.toLocaleString()} additional motion${issues.notDividedCount === 1 ? "" : "s"} were dropped from the divided-vote universe entirely before classification because the verification pass found they weren't a genuine division (a lopsided result the source data's own "unanimous" flag missed, or the same motion recorded twice under two item numbers).*
`;
}

// ---------------------------------------------------------------------------
// What Council Actually Controls: /election/what-council-controls
// (content supplied verbatim by the civics-content research pass)
// ---------------------------------------------------------------------------

function generateControlsPage(): string {
  return `---
title: "What Council Actually Controls — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Explainer</p>

# What council actually controls

London's mayor and 14 ward councillors have real, direct authority over some of what shapes daily life in the city, and only indirect influence, or none at all, over the rest. Knowing which is which matters when weighing a candidate's record. Below is a plain-language map of where City of London Council's authority actually starts and stops, with the governing law or city page linked for every claim.

## Council controls directly

**Zoning and land use planning.** Under the Planning Act and the Municipal Act, 2001, council is the only body that can pass or amend a zoning by-law or adopt or amend London's official plan (the London Plan). Provincial guidance for municipal councillors is explicit that these two powers cannot be delegated away from council. Every rezoning, height limit and permitted-use decision in the city starts as a council vote.

Sources: [Ontario, Municipal Councillors' Guide, "Exercising municipal powers"](https://www.ontario.ca/document/ontario-municipal-councillors-guide/8-exercising-municipal-powers) · [City of London, Zoning](https://london.ca/business-development/zoning) · [City of London, The London Plan (Official Plan)](https://london.ca/business-development/official-plan)

**Property tax and the budget.** Council sets London's property tax rates each year, approved each April, and has moved to approving a multi-year budget under authority the Municipal Act, 2001 gives municipalities to budget for periods of two to five years. This is the single largest lever council holds: it decides how much is raised and where it goes.

Sources: [City of London, Property Taxes](https://london.ca/government/property-taxes-finance/property-taxes) · [City of London, Multi-Year Budget](https://london.ca/government/property-taxes-finance/municipal-budget/multi-year-budget)

### Who tables the budget

Since 2023, London has operated under Ontario's strong-mayor powers (extended to London under the Municipal Act, 2001 and its supporting regulations). Under that framework, the **Mayor**, not council as a whole, prepares and tables the annual or multi-year budget. Councillors vote on **amendments** to the Mayor's tabled budget, not on an independently council-drafted one, and the Mayor holds a veto over council-passed budget amendments and certain by-laws, which council can only override with a two-thirds vote. This hub's data reflects that structure directly: budget motions since the strong-mayor rules took effect are framed as amendments to "the Mayor's Tabled Budget," and a councillor's yea or nay on one of those amendments is a vote on a specific line change, not a vote on the budget as a whole. A nay on an amendment that would have added to the Mayor's tabled budget is not the same act as a nay on adopting a budget the councillor authored.

Sources: [Ontario, Strong Mayors, Building Homes Act, 2022, S.O. 2022, c. 18 (CanLII)](https://www.canlii.org/en/on/laws/stat/so-2022-c-18/latest/so-2022-c-18.html) · [City of London, Multi-Year Budget](https://london.ca/government/property-taxes-finance/municipal-budget/multi-year-budget)

**Local by-laws.** Council passes the by-laws that govern property standards, noise, parking, animal control and business licensing, using authority granted by the Municipal Act, 2001, the Building Code Act and the Planning Act.

Source: [City of London, By-Laws](https://london.ca/by-laws)

**Transit.** London's bus system is operated by the London Transit Commission, a seven-person board appointed by council (including sitting councillors) under a by-law made under the City of London Act. Council does not make day-to-day transit decisions, but it appoints the Commission, approves its budget and sets the broader policy direction the LTC works within.

Source: [London Transit Commission, Commission Information](https://www.londontransit.ca/commission-information/)

**Parks, recreation and municipal services.** The Municipal Act, 2001 gives municipalities broad jurisdiction over parks, recreation, culture, local roads, waste collection and similar services, exercised through council by-laws and the budget.

Source: [Municipal Act, 2001, S.O. 2001, c. 25 (CanLII)](https://www.canlii.org/en/on/laws/stat/so-2001-c-25/latest/so-2001-c-25.html)

**Housing tools.** Council controls the municipal levers available for housing supply: rezoning for higher density, community improvement plans that incentivize affordable units, and, within limits set by the province, inclusionary zoning near major transit stations. It does not control interest rates, national housing supply programs, or provincial rent rules.

Source: [City of London, More Homes](https://london.ca/business-development/more-homes)

## Council only influences

**Policing.** The London Police Service is overseen by the London Police Service Board, a separate body, not council, under the Community Safety and Policing Act, 2019. The board sets policy, priorities and the line-item budget; council's role is limited to approving or rejecting the board's total requested budget amount. Council cannot rewrite individual budget lines or direct police operations. If council and the board cannot agree on a total figure, the dispute goes to provincial conciliation or arbitration.

Sources: [Community Safety and Policing Act, 2019, S.O. 2019, c. 1, Sched. 1 (CanLII)](https://www.canlii.org/en/on/laws/stat/so-2019-c-1-sch-1/latest/so-2019-c-1-sch-1.html) · [London Police Service Board, Accountability and Reporting](https://londonpoliceserviceboard.com/accountability-and-reporting/)

**Encampments.** Council can pass by-laws restricting encampments in parks and public spaces, but that power sits inside a provincial legal framework that is actively shifting. Ontario's Bill 6, the Safer Municipalities Act, 2025, raised trespass penalties and created new public-substance-use offences, in force since June 2025. Separately, a May 2026 Ontario Superior Court decision on a Waterloo Region encampment found that clearing a site without adequate alternative shelter can violate Charter rights. Any London by-law in this area has to operate inside both.

Sources: [Legislative Assembly of Ontario, Bill 6, Safer Municipalities Act, 2025](https://www.ola.org/en/legislative-business/bills/parliament-44/session-1/bill-6) · [ablawg.ca, "Canada's Evolving Right to Shelter: Region of Waterloo v Named Respondents & Persons Unknown"](https://ablawg.ca/2026/07/10/canadas-evolving-right-to-shelter-region-of-waterloo-v-named-respondents-persons-unknown/)

## Provincial or federal, not council's call

**Healthcare.** Delivery and funding of hospital and physician services is a provincial responsibility, run day to day by Ontario's Ministry of Health, within conditions the federal Canada Health Act sets for funding. London council has no authority over hospital funding or care covered by a health card. Public health is a partial exception: the Middlesex-London Health Unit is jointly governed by provincial and municipal appointees and cost-shared between the province and the City.

Sources: [Government of Canada, Canada Health Act Annual Report](https://www.canada.ca/en/health-canada/services/publications/health-system-services/canada-health-act-annual-report-2023-2024.html) · [Middlesex-London Health Unit, Board of Health](https://www.healthunit.com/board-of-health)

**Education.** School boards, not council, run London's public and Catholic schools, under the Education Act, which is provincial legislation.

Source: [Ontario, Responsibility for Publicly Funded Elementary and Secondary Education](https://www.ontario.ca/page/responsibility-publicly-funded-elementary-and-secondary-education)

**Planning appeals.** Even a council zoning decision is not necessarily final. The Ontario Land Tribunal, a provincial adjudicative body, hears appeals from applicants or the public and has the power to overturn or amend a zoning by-law or official plan amendment that council has already passed.

Sources: [Ontario, Citizen's Guide to Land Use Planning: The Ontario Land Tribunal](https://www.ontario.ca/document/citizens-guide-land-use-planning/ontario-land-tribunal) · [Ontario Land Tribunal, Appeal Guide 2023](https://olt.gov.on.ca/wp-content/uploads/2023/02/Appeal_Guide_2023.pdf)

---

*This page explains legal authority in plain language; it is not legal advice. Every claim above links to a primary government or legal source — follow the links to read them yourself.*
`;
}

// ---------------------------------------------------------------------------
// Ward finder: /election/wards
// ---------------------------------------------------------------------------

function generateWardsPage(
  wardsData: WardsFile,
  registry: ReturnType<typeof loadRegistry>,
): string {
  const bySlug = new Map<string, { displayName: string }>();
  for (const info of Object.values(registry))
    bySlug.set(info.slug, { displayName: info.displayName });
  const mayoralBySlug = new Map(
    (wardsData.mayoralCandidates ?? []).map((m) => [m.slug, m.note]),
  );

  const rows = wardsData.wards
    .map((w) => {
      const rep = bySlug.get(w.currentRepSlug);
      const repLink = rep
        ? `[${rep.displayName}](/election/councillors/${w.currentRepSlug})`
        : "—";
      const changed = w.boundaryChanged2026 ? "Changed" : "Same shape";
      // Round-2 finding B5: a ward's own incumbent2026Note and the
      // mayoralCandidates note are independent facts (the ward note is
      // ward-specific — "no outgoing councillor on this ballot" — the
      // mayoral note is about what that person IS running for) — shown
      // together here when both exist, same combining logic as the
      // councillor's own profile page.
      const noteBits = [
        w.incumbent2026Note,
        mayoralBySlug.get(w.currentRepSlug),
      ].filter((n): n is string => Boolean(n));
      const note = noteBits.length ? noteBits.join(" ") : "—";
      return `| ${w.ward} | ${repLink} | ${changed} | ${note} |`;
    })
    .join("\n");

  return `---
title: "Find Your Ward — Election Lens"
cssclasses:
  - election-hub
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Find Your Ward</p>

# Find your ward

${wardsData.currentTermEndsNote}

<div class="eh-ward-finder" data-eh-ward-finder>
  <label for="eh-address-input" class="eh-ward-finder-label">Look up an address (London, ON)</label>
  <div class="eh-ward-finder-row">
    <input id="eh-address-input" class="eh-ward-finder-input" type="text" placeholder="e.g. 300 Dufferin Ave" autocomplete="off" />
    <button id="eh-address-submit" class="eh-ward-finder-button" type="button">Find my ward</button>
  </div>
  <p id="eh-ward-finder-status" class="eh-ward-finder-status" role="status" aria-live="polite"></p>
  <div id="eh-ward-finder-result" class="eh-ward-finder-result" hidden></div>
  <p class="eh-ward-finder-fallback">This looks up your address against the City of London's live ward map. If it doesn't respond, use the ward table below, or the City's own <a href="${wardsData.cityWardMapTool}">ward map tool</a>.</p>
</div>

## All 14 wards

| Ward | Current representative (2022–2026) | 2026 boundary | 2026 ballot note |
|:---:|---|:---:|---|
${rows}


${wardsData.unresolvedNote}

For the authoritative, official candidate list for every ward, see the City Clerk's [certified list of candidates](${wardsData.candidateListSource}) (checked ${formatDate(wardsData.candidateListCheckedDate)} — certified list, nominations closed ${formatDate(wardsData.candidateListNominationsCloseDate)}, list last modified ${formatDate(wardsData.candidateListLastModifiedDate)}). Per this hub's scope, only current councillors get a stance profile here — challengers don't have a council voting record to summarize.

<script>
(function () {
  "use strict";
  var WARDS_2022 = 8; // MapServer layer id, "Election 2022 Wards" — currently in effect until Nov 15, 2026
  var WARDS_2026 = 9; // MapServer layer id, "Election 2026 Wards" — the boundaries used for the Oct 26, 2026 ballot
  var BASE = "https://maps.london.ca/server/rest/services";
  var GEOCODE_URL = BASE + "/Locators/SearchKeyCompositeLocator/GeocodeServer/findAddressCandidates";
  var WARD_QUERY_URL = function (layer) { return BASE + "/OpenData/OpenData_Elections/MapServer/" + layer + "/query"; };
  var TIMEOUT_MS = 7000;
  var REPS = ${JSON.stringify(
    Object.fromEntries(
      wardsData.wards.map((w) => [
        String(w.ward),
        {
          slug: w.currentRepSlug,
          name: bySlug.get(w.currentRepSlug)?.displayName ?? w.currentRepSlug,
          note2026:
            [w.incumbent2026Note, mayoralBySlug.get(w.currentRepSlug)]
              .filter(Boolean)
              .join(" ") || null,
        },
      ]),
    ),
  )};

  function jsonp(url, params, onSuccess, onError) {
    var cbName = "eh_cb_" + Math.random().toString(36).slice(2);
    var script = document.createElement("script");
    var timer = setTimeout(function () {
      cleanup();
      onError(new Error("timed out"));
    }, TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) {
      cleanup();
      onSuccess(data);
    };

    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    script.src = url + "?" + qs + "&callback=" + cbName;
    script.onerror = function () {
      cleanup();
      onError(new Error("script load failed"));
    };
    document.head.appendChild(script);
  }

  function findWard(lon, lat, layer, cb) {
    jsonp(WARD_QUERY_URL(layer), {
      f: "json",
      geometry: lon + "," + lat,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "Ward"
    }, function (data) {
      var feature = data && data.features && data.features[0];
      cb(feature ? feature.attributes.Ward : null);
    }, function (err) { cb(null, err); });
  }

  // Ward numbers come back from a third-party (City of London) server via
  // JSONP. Validate the shape before using them at all, and build the
  // result with DOM APIs (textContent / element properties) rather than
  // innerHTML, so nothing from that response is ever parsed as markup.
  var WARD_RE = /^([1-9]|1[0-4])$/;
  function safeWard(w) {
    return typeof w === "string" && WARD_RE.test(w) ? w : null;
  }

  function el(tag, opts) {
    var node = document.createElement(tag);
    if (opts) {
      if (opts.text !== undefined) node.textContent = opts.text;
      if (opts.className) node.className = opts.className;
      if (opts.href) { node.href = opts.href; }
    }
    return node;
  }

  function renderResult(container, ward2022Raw, ward2026Raw) {
    var ward2022 = safeWard(ward2022Raw);
    var ward2026 = safeWard(ward2026Raw);
    var rep2022 = ward2022 ? REPS[ward2022] : null;
    var rep2026Note = ward2026 && REPS[ward2026] ? REPS[ward2026].note2026 : null;

    while (container.firstChild) container.removeChild(container.firstChild);
    var any = false;

    if (ward2022) {
      any = true;
      var p1 = el("p");
      p1.appendChild(el("strong", { text: "Your current representative (Ward " + ward2022 + "):" }));
      if (rep2022) {
        p1.appendChild(document.createTextNode(" "));
        var a = el("a", { text: rep2022.name, href: "/election/councillors/" + rep2022.slug });
        p1.appendChild(a);
      }
      container.appendChild(p1);
    }

    if (ward2026) {
      any = true;
      var p2 = el("p");
      p2.appendChild(el("strong", { text: "Your Oct 26, 2026 ballot ward: " }));
      p2.appendChild(document.createTextNode("Ward " + ward2026));
      if (ward2022 && ward2022 !== ward2026) {
        p2.appendChild(document.createTextNode(" "));
        p2.appendChild(el("em", { text: "(different from your current ward — boundaries changed here)" }));
      }
      container.appendChild(p2);
      if (rep2026Note) {
        container.appendChild(el("p", { className: "eh-ward-finder-note", text: rep2026Note }));
      }
    }

    if (!any) {
      container.appendChild(el("p", { text: "Couldn't match that address to a ward. Try a more specific address, or use the table below." }));
    }
    container.hidden = false;
  }

  function run() {
    var input = document.getElementById("eh-address-input");
    var button = document.getElementById("eh-address-submit");
    var status = document.getElementById("eh-ward-finder-status");
    var result = document.getElementById("eh-ward-finder-result");
    if (!input || !button || !status || !result) return;

    function submit() {
      var address = input.value.trim();
      if (!address) return;
      status.textContent = "Looking up \\"" + address + "\\"…";
      result.hidden = true;

      jsonp(GEOCODE_URL, { SingleLine: address + ", London, ON", f: "json", outSR: 4326 }, function (data) {
        var candidate = data && data.candidates && data.candidates[0];
        if (!candidate || candidate.score < 70) {
          status.textContent = "Couldn't find that address. Try including a street number and name.";
          return;
        }
        var lon = candidate.location.x;
        var lat = candidate.location.y;
        var done = 0, ward2022 = null, ward2026 = null;
        function maybeFinish() {
          done++;
          if (done === 2) {
            status.textContent = "";
            renderResult(result, ward2022, ward2026);
          }
        }
        findWard(lon, lat, WARDS_2022, function (w) { ward2022 = w; maybeFinish(); });
        findWard(lon, lat, WARDS_2026, function (w) { ward2026 = w; maybeFinish(); });
      }, function () {
        status.textContent = "The City's address lookup didn't respond. Use the ward table below instead.";
      });
    }

    button.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
</script>
`;
}

// ---------------------------------------------------------------------------
// Councillors index: /election/councillors
// ---------------------------------------------------------------------------

function generateCouncillorsIndexPage(stances: StancesFile): string {
  const rows = Object.entries(stances.councillors)
    .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName))
    .map(
      ([slug, c]) =>
        `- [${c.displayName}](/election/councillors/${slug}) — ${c.role}`,
    )
    .join("\n");

  return `---
title: "Councillor Stance Profiles — Election Lens"
cssclasses:
  - election-hub
  - hide-folder-listing
prefillQuestions: []
---

<p class="eh-kicker"><a href="/election">Election Lens</a> · Councillors</p>

# Councillor stance profiles

The Mayor and all 14 current ward councillors, with their voting pattern on each divided issue since 2023. Descriptive record, not an endorsement — see each profile for the full disclaimer.

Only sitting councillors appear here, because only sitting councillors have a council voting record to summarize. Challengers are not covered, and their absence from these pages is not a judgement about them. For everyone actually on your ballot, see the City Clerk's certified list of candidates (linked on the [ward finder](/election/wards)).

${rows}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function main() {
  console.log("Election Hub page generator\n");

  const issues = await loadJson<IssuesFile>(path.join(DATA_DIR, "issues.json"));
  const stances = await loadJson<StancesFile>(
    path.join(DATA_DIR, "stances.json"),
  );
  const wardsData = await loadJson<WardsFile>(
    path.join(DATA_DIR, "wards.json"),
  );
  const registry = loadRegistry();

  const wardBySlug = new Map<string, WardEntry>();
  for (const w of wardsData.wards) wardBySlug.set(w.currentRepSlug, w);

  // Landing page
  await writeFile(
    path.join(CONTENT_DIR, "index.md"),
    generateIndexPage(issues, stances),
  );
  console.log("  Wrote election/index.md");

  // What council controls
  await writeFile(
    path.join(CONTENT_DIR, "what-council-controls.md"),
    generateControlsPage(),
  );
  console.log("  Wrote election/what-council-controls.md");

  // Ward finder
  await writeFile(
    path.join(CONTENT_DIR, "wards.md"),
    generateWardsPage(wardsData, registry),
  );
  console.log("  Wrote election/wards.md");

  // Issues
  await writeFile(
    path.join(CONTENT_DIR, "issues", "index.md"),
    generateIssuesIndexPage(issues),
  );
  for (const [slug, issue] of Object.entries(issues.issues)) {
    await writeFile(
      path.join(CONTENT_DIR, "issues", `${slug}.md`),
      generateIssuePage(issue, issues.methodology, issues.cutoffDate),
    );
  }
  console.log(
    `  Wrote election/issues/ (${Object.keys(issues.issues).length} issues + index)`,
  );

  // Councillors
  await writeFile(
    path.join(CONTENT_DIR, "councillors", "index.md"),
    generateCouncillorsIndexPage(stances),
  );
  const mayoralCandidates = wardsData.mayoralCandidates ?? [];
  for (const [slug, c] of Object.entries(stances.councillors)) {
    await writeFile(
      path.join(CONTENT_DIR, "councillors", `${slug}.md`),
      generateCouncillorPage(
        slug,
        c,
        wardBySlug.get(slug),
        mayoralCandidates,
        stances.methodology,
      ),
    );
  }
  console.log(
    `  Wrote election/councillors/ (${Object.keys(stances.councillors).length} councillors + index)`,
  );

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
