/**
 * Election Hub — stance engine
 *
 * Deterministic generator: data/votes/_all-motions.json + registry.json →
 * data/election/issues.json + data/election/stances.json.
 *
 * Pipeline:
 *  1. Filter to divided (non-unanimous, non-procedural) motions since
 *     2023-01-01 (see issue-rules.ts: GLOBAL_EXCLUDE, ISSUES).
 *  2. Classify each into one of 8 issue clusters, or leave unclassified —
 *     never force-fit (issue-rules.ts).
 *  3. Derive a neutral "what a yea did" direction + axis + valence for each
 *     classified motion (direction-rules.ts). Motions with direction
 *     'unclear' are excluded from stance aggregation but stay listed in
 *     issues.json for transparency.
 *  4. Aggregate per councillor per issue per axis: how often their vote
 *     aligned with the axis's expansive outcome vs its restrictive outcome,
 *     with recusals/absences tracked and labeled separately (never folded
 *     into a "no position" bucket, never treated as opposition).
 *
 * Usage: npx tsx scripts/election/generate-stances.ts
 */

import fs from "fs";
import path from "path";
import { loadRegistry } from "../../lib/councillors/registry.js";
import {
  classifyIssue,
  ISSUE_ORDER,
  ISSUES,
  type IssueId,
} from "./issue-rules.js";
import { deriveDirection, type Direction } from "./direction-rules.js";
import { motionAnchor } from "./anchors.js";

const CUTOFF_DATE = "2023-01-01";
const REPO_ROOT = path.join(process.cwd());
const MOTIONS_PATH = path.join(REPO_ROOT, "data/votes/_all-motions.json");
const OUT_DIR = path.join(REPO_ROOT, "data/election");

type VoteKind = "yea" | "nay" | "recuse" | "absent" | "abstain" | "other";

interface RawMotion {
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
  unanimous: boolean;
  procedural: boolean;
  yeas: string[];
  nays: string[];
  absent: string[];
  recuse: string[];
  abstain: string[];
  other: string[];
  margin: number;
}

interface AllMotionsFile {
  generatedAt: string;
  sourceHash: string;
  totalMotions: number;
  substantiveMotions: number;
  contestedMotions: number;
  motions: RawMotion[];
}

// ---------------------------------------------------------------------------
// Councillor lookup: displayName (as it appears in yeas/nays/etc arrays) ->
// { slug, canonicalName, displayName, ward, role, isCurrent }
// ---------------------------------------------------------------------------

interface CouncillorMeta {
  canonicalName: string;
  slug: string;
  displayName: string;
  ward?: number;
  role: string;
  isCurrent: boolean;
}

function buildCouncillorLookup(): Map<string, CouncillorMeta> {
  const registry = loadRegistry();
  const byDisplayName = new Map<string, CouncillorMeta>();

  for (const [canonicalName, info] of Object.entries(registry)) {
    const currentTerm = info.terms.find((t) => t.end >= 2026);
    const latestTerm = info.terms[info.terms.length - 1];
    const term = currentTerm ?? latestTerm;
    byDisplayName.set(info.displayName, {
      canonicalName,
      slug: info.slug,
      displayName: info.displayName,
      ward: term.ward,
      role: term.role,
      isCurrent: Boolean(currentTerm),
    });
  }

  return byDisplayName;
}

// ---------------------------------------------------------------------------
// Motion -> per-councillor raw vote
// ---------------------------------------------------------------------------

function tallyOf(m: RawMotion) {
  return {
    yea: m.yeas.length,
    nay: m.nays.length,
    recuse: m.recuse.length,
    absent: m.absent.length,
    abstain: m.abstain.length,
    other: m.other.length,
  };
}

/** True when the same person appears in more than one vote-kind bucket on
 * this motion (e.g. both yeas and nays) — a data-entry conflict, not a real
 * position. Spot-check (2026-08-31) on motion 3fc45f073294 (2025-11-20,
 * "Amendment - Budget Case #P-2 - Councillor S. Stevenson") found a doubled
 * roster (10 names in yeas, 20 in nays against a stated 5-10 result) with
 * two named councillors in BOTH lists; the very next motion in the corpus
 * is a procedural correction for exactly one of them. positionsOf used to
 * assign yeas then nays into one record, so the later bucket silently won
 * — this never lets that happen: a motion with any such conflict is
 * dropped from the divided set entirely, before classification. */
function hasRosterConflict(m: RawMotion): boolean {
  const seen = new Set<string>();
  for (const bucket of [
    m.yeas,
    m.nays,
    m.recuse,
    m.absent,
    m.abstain,
    m.other,
  ]) {
    for (const name of bucket) {
      if (seen.has(name)) return true;
      seen.add(name);
    }
  }
  return false;
}

/** True when a motion's result string is a secret-ballot appointment round
 * ("Majority Winner: ...") rather than a divided policy decision — these
 * publish private citizens' names and inflate "divided vote" counts on
 * issue pages (e.g. Police Services Board appointments counted alongside
 * substantive Policing decisions). Excluded from the divided-vote universe
 * entirely, everywhere, not just on the issue where it was first found. */
function isAppointmentBallot(m: RawMotion): boolean {
  return /^Majority Winner\b/i.test(m.result);
}

/** True when a motion's text hit the 500-character hard truncation cap in
 * data/votes/_all-motions.json (scripts/generate-votes.ts:127) — the cap
 * cuts mid-word with no ellipsis marker, so any denial/exclusion/removal
 * clause past character 500 is silently invisible to direction-rules.ts.
 * Spot-check (2026-08-31): 51.7% of the motions the hub actually publishes
 * a direction for hit this cap. Rather than guess at what the missing tail
 * says, a truncated motion is marked direction 'unclear' and excluded from
 * stance aggregation — same treatment as any other non-decision — with the
 * count disclosed on the issues page. */
function isTruncated(m: RawMotion): boolean {
  return m.motionText.length >= 500;
}

/** Parse the "(N to M)" tally out of a motion's own result string, e.g.
 * "Motion Passed (11 to 4)" -> { yea: 11, nay: 4 }. Tolerant of the en/em
 * dash variants some source pages use, same as anchors.ts's extractTally. */
function extractResultTally(
  resultText: string,
): { yea: number; nay: number } | null {
  const m = resultText.match(/\((\d+)\s*(?:to|[-–—])\s*(\d+)\)/i);
  return m ? { yea: Number(m[1]), nay: Number(m[2]) } : null;
}

/** True when a motion's own minuted result string disagrees with its parsed
 * yeas/nays arrays — either the tally numbers don't match the array
 * lengths, or "Motion Passed"/"Motion Failed" doesn't match which side has
 * more votes. Found via spot-check (2026-08-31, hub-recheck verdict finding
 * 6): 82 divided motions have this disagreement — mostly an early-term
 * (2022-23) scraper gap where individual councillors are silently missing
 * from the array a "Motion Passed/Failed" result implies should be
 * complete. A motion in this state has no reliable per-councillor position
 * data — publishing "yea"/"nay"/"absent" from an array that's already known
 * to disagree with the minutes would launder that uncertainty into a
 * confident-looking claim. Excluded from the divided-vote universe
 * entirely, same treatment as a roster conflict or appointment ballot, with
 * the count disclosed globally (result-mismatches.json) and per-councillor
 * (see mismatchInvolvementOf below). */
function hasResultMismatch(m: RawMotion): boolean {
  const tally = extractResultTally(m.result);
  if (!tally) return false; // no parseable tally to compare against
  if (tally.yea !== m.yeas.length || tally.nay !== m.nays.length) return true;
  if (/^Motion\s+Passed/i.test(m.result) && !(m.yeas.length > m.nays.length))
    return true;
  if (/^Motion\s+Failed/i.test(m.result) && !(m.yeas.length <= m.nays.length))
    return true;
  return false;
}

/** For per-councillor disclosure: how many result-mismatched motions named
 * this person in ANY vote-kind bucket (their own recorded position, however
 * unreliable, still names them) — so each profile can honestly say how many
 * of ITS OWN motions were dropped for this reason, not just cite one global
 * number. */
function mismatchInvolvementOf(
  resultMismatches: RawMotion[],
  displayName: string,
): number {
  return resultMismatches.filter((m) =>
    [m.yeas, m.nays, m.recuse, m.absent, m.abstain, m.other].some((bucket) =>
      bucket.includes(displayName),
    ),
  ).length;
}

function positionsOf(
  m: RawMotion,
  lookup: Map<string, CouncillorMeta>,
): Record<string, VoteKind> {
  const positions: Record<string, VoteKind> = {};
  const assign = (names: string[], kind: VoteKind) => {
    for (const name of names) {
      const meta = lookup.get(name);
      const key = meta?.slug ?? name;
      positions[key] = kind;
    }
  };
  assign(m.yeas, "yea");
  assign(m.nays, "nay");
  assign(m.recuse, "recuse");
  assign(m.absent, "absent");
  assign(m.abstain, "abstain");
  assign(m.other, "other");
  return positions;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ClassifiedMotion {
  motion: RawMotion;
  issue: IssueId;
  matchedKeywords: string[];
  direction: Direction | { axis: null; label: "unclear" };
  tally: ReturnType<typeof tallyOf>;
  positions: Record<string, VoteKind>;
  anchor: string | null;
  anchorAmbiguous: boolean;
}

function main() {
  const allMotionsRaw: AllMotionsFile = JSON.parse(
    fs.readFileSync(MOTIONS_PATH, "utf-8"),
  );
  const lookup = buildCouncillorLookup();

  const allSinceCutoff = allMotionsRaw.motions.filter(
    (m) => !m.procedural && !m.unanimous && m.date >= CUTOFF_DATE,
  );

  const rosterConflicts = allSinceCutoff.filter(hasRosterConflict);
  const appointmentBallots = allSinceCutoff.filter(isAppointmentBallot);
  const resultMismatches = allSinceCutoff.filter(
    (m) =>
      !hasRosterConflict(m) && !isAppointmentBallot(m) && hasResultMismatch(m),
  );
  const divided = allSinceCutoff.filter(
    (m) =>
      !hasRosterConflict(m) && !isAppointmentBallot(m) && !hasResultMismatch(m),
  );

  if (resultMismatches.length > 0) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, "result-mismatches.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note: "Motions dropped from the divided-vote universe because the motion's own minuted result string (e.g. 'Motion Passed (11 to 4)') disagrees with its parsed yeas/nays arrays — either the tally numbers don't match the array lengths, or which side won doesn't match which side has more votes. Mostly an early-term (2022-23) scraper gap. Needs manual repair against the source minutes; never guessed at or silently kept.",
          count: resultMismatches.length,
          motions: resultMismatches.map((m) => ({
            id: m.id,
            date: m.date,
            meetingSlug: m.meetingSlug,
            itemNumber: m.itemNumber,
            itemTitle: m.itemTitle,
            result: m.result,
            parsedYeas: m.yeas.length,
            parsedNays: m.nays.length,
          })),
        },
        null,
        2,
      ),
    );
    console.log(
      `Dropped ${resultMismatches.length} motion(s) with a result/vote-array mismatch — see data/election/result-mismatches.json`,
    );
  }

  if (rosterConflicts.length > 0) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, "roster-conflicts.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note: "Motions dropped from the divided-vote universe because the same person appears in more than one vote-kind bucket (e.g. both yeas and nays). Needs manual repair against the source minutes; never resolved by last-write-wins.",
          count: rosterConflicts.length,
          motions: rosterConflicts.map((m) => ({
            id: m.id,
            date: m.date,
            meetingSlug: m.meetingSlug,
            itemNumber: m.itemNumber,
            itemTitle: m.itemTitle,
            result: m.result,
          })),
        },
        null,
        2,
      ),
    );
    console.log(
      `Dropped ${rosterConflicts.length} motion(s) with a roster conflict — see data/election/roster-conflicts.json`,
    );
  }
  console.log(
    `Excluded ${appointmentBallots.length} appointment-ballot motion(s) (Majority Winner results) from the divided-vote universe`,
  );

  const classified: ClassifiedMotion[] = [];
  const unclassifiedSample: {
    id: string;
    date: string;
    itemNumber: string;
    itemTitle: string;
  }[] = [];
  let unclassifiedCount = 0;
  let truncatedExcludedCount = 0;

  for (const motion of divided) {
    const result = classifyIssue(motion.itemTitle, motion.motionText);
    if (!result) {
      unclassifiedCount++;
      unclassifiedSample.push({
        id: motion.id,
        date: motion.date,
        itemNumber: motion.itemNumber,
        itemTitle: motion.itemTitle,
      });
      continue;
    }

    const truncated = isTruncated(motion);
    if (truncated) truncatedExcludedCount++;
    const direction = truncated
      ? { axis: null, label: "unclear" as const }
      : deriveDirection(result.issue, motion.motionText);
    const anchorResult = motionAnchor(
      motion.meetingSlug,
      motion.itemNumber,
      motion.result,
    );

    classified.push({
      motion,
      issue: result.issue,
      matchedKeywords: result.matchedKeywords,
      direction,
      tally: tallyOf(motion),
      positions: positionsOf(motion, lookup),
      anchor: anchorResult?.url ?? null,
      anchorAmbiguous: anchorResult?.ambiguous ?? false,
    });
  }

  writeIssuesFile(
    allMotionsRaw,
    classified,
    unclassifiedCount,
    unclassifiedSample,
    truncatedExcludedCount,
    resultMismatches.length,
    rosterConflicts.length,
  );
  writeStancesFile(allMotionsRaw, classified, lookup, resultMismatches);

  console.log(`Divided motions since ${CUTOFF_DATE}: ${divided.length}`);
  console.log(
    `Classified: ${classified.length}  Unclassified: ${unclassifiedCount}`,
  );
  const directionBearing = classified.filter(
    (c) => c.direction.axis !== null,
  ).length;
  console.log(
    `Direction-bearing (used in stance aggregation): ${directionBearing}`,
  );
  for (const issueId of ISSUE_ORDER) {
    const forIssue = classified.filter((c) => c.issue === issueId);
    const bearing = forIssue.filter((c) => c.direction.axis !== null);
    console.log(
      `  ${issueId.padEnd(12)} classified=${forIssue.length}  direction-bearing=${bearing.length}`,
    );
  }
}

/** First ~90 chars of the motion's own text, used as a distinguishing
 * snippet in evidence tables — several distinct sub-motions (amendment
 * parts a, b, c...) under one agenda item share a single heading/anchor,
 * so the item title and link alone can make two different votes look like
 * the same row. */
// The scraper concatenates in-meeting "stage direction" asides (chair
// handoffs, recesses noted mid-motion) onto the end of a motion's own text
// — e.g. "That item 10, clause 3.5, as amended, BE APPROVED. At 2:56 PM,
// Chair Deputy Mayor S. Lewis, places Councillor H. McAlister in the
// Chair." For a short motion, the 90-char excerpt cap landed mid-sentence
// INSIDE that aside instead of showing (or omitting) the actual motion —
// found via spot-check (2026-08-31, hub-recheck verdict MINOR sweep).
// Stripped before truncating so the excerpt only ever shows the motion.
const STAGE_DIRECTION_RE = /\bAt\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b[^.]*\.\s*/gi;

function motionSnippet(motionText: string): string {
  const s = motionText
    .replace(STAGE_DIRECTION_RE, " ")
    .trim()
    .replace(/\s+/g, " ");
  return s.length > 90 ? s.slice(0, 87) + "..." : s;
}

function evidenceEntry(
  c: ClassifiedMotion,
  theirVote: VoteKind | "n/a",
  movedToward?: "expansive" | "restrictive",
) {
  const m = c.motion;
  const d = c.direction.axis !== null ? c.direction : null;
  return {
    motionId: m.id,
    date: m.date,
    meetingSlug: m.meetingSlug,
    meetingTitle: m.meetingTitle,
    meetingType: m.meetingType,
    meetingUrl: m.meetingUrl,
    itemNumber: m.itemNumber,
    itemTitle: m.itemTitle,
    motionSnippet: motionSnippet(m.motionText),
    anchor: c.anchor,
    anchorAmbiguous: c.anchorAmbiguous,
    result: m.result,
    tally: `${c.tally.yea}-${c.tally.nay}`,
    theirVote,
    whatAYeaDid: d ? d.label : "unclear",
    movedToward:
      movedToward === "expansive"
        ? (d?.axisLabels.expansive ?? null)
        : movedToward === "restrictive"
          ? (d?.axisLabels.restrictive ?? null)
          : null,
  };
}

function writeIssuesFile(
  allMotionsRaw: AllMotionsFile,
  classified: ClassifiedMotion[],
  unclassifiedCount: number,
  unclassifiedSample: {
    id: string;
    date: string;
    itemNumber: string;
    itemTitle: string;
  }[],
  truncatedExcludedCount: number,
  resultMismatchCount: number,
  rosterConflictCount: number,
) {
  const issues: Record<string, unknown> = {};

  for (const issueId of ISSUE_ORDER) {
    const forIssue = classified.filter((c) => c.issue === issueId);
    const directionBearing = forIssue.filter((c) => c.direction.axis !== null);
    const distinctItems = new Set(
      forIssue.map((c) => `${c.motion.meetingSlug}#${c.motion.itemNumber}`),
    ).size;

    issues[issueId] = {
      label: ISSUES[issueId].label,
      dividedVoteCount: forIssue.length,
      directionBearingVoteCount: directionBearing.length,
      distinctAgendaItemCount: distinctItems,
      votes: forIssue
        .sort((a, b) => (a.motion.date < b.motion.date ? 1 : -1))
        .map((c) => {
          const m = c.motion;
          const motionText =
            m.motionText.length > 600
              ? m.motionText.slice(0, 597) + "..."
              : m.motionText;
          return {
            id: m.id,
            date: m.date,
            meetingSlug: m.meetingSlug,
            meetingTitle: m.meetingTitle,
            meetingType: m.meetingType,
            meetingUrl: m.meetingUrl,
            itemNumber: m.itemNumber,
            itemTitle: m.itemTitle,
            motionText,
            result: m.result,
            passed: m.passed,
            margin: m.margin,
            tally: c.tally,
            anchor: c.anchor,
            anchorAmbiguous: c.anchorAmbiguous,
            matchedKeywords: c.matchedKeywords,
            direction:
              c.direction.axis === null
                ? { axis: null, label: "unclear" }
                : {
                    axis: c.direction.axis,
                    valence: c.direction.valence,
                    label: c.direction.label,
                    axisLabels: c.direction.axisLabels,
                  },
            positions: c.positions,
          };
        }),
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    sourceHash: allMotionsRaw.sourceHash,
    sourceGeneratedAt: allMotionsRaw.generatedAt,
    cutoffDate: CUTOFF_DATE,
    methodology:
      "Divided = non-unanimous, non-procedural motion, 2023-01-01 onward, excluding secret-ballot appointment rounds (result 'Majority Winner: ...'), motions with a roster data conflict (the same person recorded in two vote-kind buckets — see roster-conflicts.json), and motions whose own minuted result string disagrees with its parsed yeas/nays arrays (see result-mismatches.json). Classified via scripts/election/issue-rules.ts, which requires a keyword match in the motion's own body text (or a structural code pattern), not the agenda item's title alone. Direction ('what a yea did') derived via scripts/election/direction-rules.ts; motions with direction 'unclear' — including any motion whose text hit the 500-character truncation cap in the source data, since a cut-off clause can flip the read — are listed here but excluded from stance aggregation in stances.json.",
    truncatedExcludedCount,
    resultMismatchCount,
    rosterConflictCount,
    issues,
    unclassified: {
      count: unclassifiedCount,
      note: "Divided motions since 2023 that matched no issue's keyword rules (or matched a GLOBAL_EXCLUDE governance/procedure phrase). All are listed here, never force-fit into a cluster.",
      sample: unclassifiedSample,
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "issues.json"),
    JSON.stringify(out, null, 2),
  );
}

interface AxisAgg {
  axis: string;
  axisLabels: { expansive: string; restrictive: string };
  forCount: number; // aligned with the axis's expansive outcome
  againstCount: number; // aligned with the axis's restrictive outcome
  recused: number;
  absent: number;
  abstain: number;
  other: number;
  evidence: ReturnType<typeof evidenceEntry>[];
}

function pct(n: number, d: number): string {
  return d === 0 ? "0" : Math.round((n / d) * 100).toString();
}

// A "pattern" built from a handful of votes reads as more confident than
// the evidence supports. Below this many DISTINCT AGENDA ITEMS on an axis,
// the individual votes are shown but no pattern sentence is asserted.
// Fixed 2026-08-31 (hub-recheck verdict blocker 5): this used to gate on
// raw vote-row count (sampleSize), which let a single agenda item that
// generates several recorded sub-motions (e.g. one committee vote followed
// by the same decision's council-stage vote, or several amendment parts
// under one item) manufacture an apparent "track record" out of what is
// really one or two real decisions — "Shawn Lewis: 0 for cycling, 8
// against" turned out to be built from 2 distinct agenda items. Gating on
// distinctItemCount (computed from the same evidence the reader can click
// into) makes the floor mean what it says: enough DIFFERENT decisions to
// call a pattern, not enough vote-rows.
const MIN_PATTERN_SAMPLE_SIZE = 5;

function recusalAbsentClause(agg: Pick<AxisAgg, "recused" | "absent">): string {
  const bits: string[] = [];
  if (agg.recused > 0) {
    // Fixed 2026-08-31 (hub-recheck verdict finding 8): the source data has
    // no field recording WHY a councillor recused — asserting "pecuniary
    // interest" here was fabricated, not read off any record. A recusal
    // means the councillor formally withdrew from discussing and voting on
    // the item; it does not, on its own, say what conflict (if any)
    // prompted that. Worded to explain what a recusal IS without asserting
    // a reason this data doesn't have.
    bits.push(
      `recused ${agg.recused} (recused from discussing or voting on this item; the reason isn't recorded in this data)`,
    );
  }
  if (agg.absent > 0) bits.push(`absent ${agg.absent}`);
  return bits.length ? ` (${bits.join(", ")})` : "";
}

/** Neutral pattern sentence for one axis. Responsible-build fixes baked in
 * here:
 *  1. "for"/"against" count DIRECTION-ALIGNMENT, not raw yea/nay — a nay on
 *     a motion that cuts the levy is a "for" (toward the axis's expansive
 *     side is wrong; it's toward restrictive... the point is it is NOT a
 *     yea). The old wording ("Voted for the measure in N of M votes ...
 *     that increased ...") read as if every "for" was a yea on an
 *     increase, when up to half of any axis's "for"/"against" counts can
 *     be direction-aligned nays. This phrasing never claims a vote kind,
 *     only which side a vote moved toward.
 *  2. Below MIN_PATTERN_SAMPLE_SIZE DISTINCT agenda items, no pattern is
 *     asserted at all — see the distinctItemCount comment above
 *     MIN_PATTERN_SAMPLE_SIZE.
 */
function buildPattern(
  agg: Pick<
    AxisAgg,
    "forCount" | "againstCount" | "recused" | "absent" | "axisLabels"
  >,
  distinctItemCount: number,
): string {
  const sampleSize = agg.forCount + agg.againstCount;
  if (sampleSize === 0) {
    return `No direction-bearing votes cast on this axis since 2023${recusalAbsentClause(agg) || " (recused 0, absent 0)"}.`;
  }
  if (distinctItemCount < MIN_PATTERN_SAMPLE_SIZE) {
    const itemWord = distinctItemCount === 1 ? "decision" : "decisions";
    const voteClause =
      sampleSize === distinctItemCount
        ? ""
        : ` (${sampleSize} recorded vote${sampleSize === 1 ? "" : "s"} across them)`;
    const isAre = distinctItemCount === 1 ? "is" : "are";
    return `Only ${distinctItemCount} distinct ${itemWord} since 2023${voteClause}${recusalAbsentClause(agg)} — too few to describe a pattern. The individual vote${sampleSize === 1 ? "" : "s"} ${isAre} listed below.`;
  }
  const forWord = agg.forCount === 1 ? "time" : "times";
  const againstWord = agg.againstCount === 1 ? "time" : "times";
  return (
    `Of ${sampleSize} divided votes since 2023 where the motion's effect on this axis was clear, this councillor's vote moved toward measures that ${agg.axisLabels.expansive} ${agg.forCount} ${forWord} and toward measures that ${agg.axisLabels.restrictive} ${agg.againstCount} ${againstWord}` +
    recusalAbsentClause(agg) +
    "."
  );
}

function writeStancesFile(
  allMotionsRaw: AllMotionsFile,
  classified: ClassifiedMotion[],
  lookup: Map<string, CouncillorMeta>,
  resultMismatches: RawMotion[],
) {
  const currentCouncillors = [...lookup.values()].filter((c) => c.isCurrent);

  const councillorsOut: Record<string, unknown> = {};

  for (const councillor of currentCouncillors) {
    const issuesOut: Record<string, unknown> = {};

    for (const issueId of ISSUE_ORDER) {
      const directionBearing = classified.filter(
        (c) => c.issue === issueId && c.direction.axis !== null,
      );

      // Group this councillor's direction-bearing motions on this issue by axis.
      const axisMap = new Map<string, AxisAgg>();
      // Split "not on the roster" by meeting type (hub-recheck verdict
      // finding 6): "committee vote this councillor was not a member of" is
      // only honest for a COMMITTEE meeting — all 15 councillors are
      // members of Council itself, so a Council motion missing a
      // councillor from every vote-kind bucket is a data gap in the
      // scraped record, not a non-membership fact. Spot-check (2026-08-31):
      // c699eb9cc94f, a City Council motion, is one of several where the
      // old single "not a member" wording was flatly false.
      let notOnRosterCommittee = 0;
      let notOnRosterCouncilGap = 0;

      for (const c of directionBearing) {
        const vote = c.positions[councillor.slug];
        if (vote === undefined) {
          // not on the roster for this motion — not applicable, not absent
          if (c.motion.meetingType === "Council") notOnRosterCouncilGap++;
          else notOnRosterCommittee++;
          continue;
        }

        const d = c.direction as Direction;
        const key = d.axis;
        let agg = axisMap.get(key);
        if (!agg) {
          agg = {
            axis: d.axis,
            axisLabels: d.axisLabels,
            forCount: 0,
            againstCount: 0,
            recused: 0,
            absent: 0,
            abstain: 0,
            other: 0,
            evidence: [],
          };
          axisMap.set(key, agg);
        }

        let movedToward: "expansive" | "restrictive" | undefined;
        if (vote === "yea" || vote === "nay") {
          const alignedExpansive =
            (d.valence === 1 && vote === "yea") ||
            (d.valence === -1 && vote === "nay");
          movedToward = alignedExpansive ? "expansive" : "restrictive";
          if (alignedExpansive) agg.forCount++;
          else agg.againstCount++;
        } else if (vote === "recuse") {
          agg.recused++;
        } else if (vote === "absent") {
          agg.absent++;
        } else if (vote === "abstain") {
          agg.abstain++;
        } else {
          agg.other++;
        }

        agg.evidence.push(evidenceEntry(c, vote, movedToward));
      }

      if (axisMap.size === 0) continue;

      const axes = [...axisMap.values()]
        .sort(
          (a, b) => b.forCount + b.againstCount - (a.forCount + a.againstCount),
        )
        .map((agg) => {
          const sampleSize = agg.forCount + agg.againstCount;
          const sortedEvidence = agg.evidence.sort((a, b) =>
            a.date < b.date ? 1 : -1,
          );
          // Counted from yea/nay evidence ONLY (finding fixed 2026-08-31
          // alongside blocker 5): an absence or recusal isn't a "distinct
          // decision" this councillor weighed in on, so it shouldn't be
          // able to inflate distinctItemCount past the pattern floor for
          // someone who actually only cast a handful of real votes on this
          // axis (found via spot-check on the Mayor's downtown axis: 4 real
          // votes + 2 absences let distinctItemCount hit 6, keeping a
          // "n=4" pattern sentence alive that the floor was supposed to
          // suppress).
          const distinctItemCount = new Set(
            sortedEvidence
              .filter((e) => e.theirVote === "yea" || e.theirVote === "nay")
              .map((e) => `${e.meetingSlug}#${e.itemNumber}`),
          ).size;
          return {
            axis: agg.axis,
            axisLabels: agg.axisLabels,
            sampleSize,
            distinctItemCount,
            for: agg.forCount,
            against: agg.againstCount,
            forPct: pct(agg.forCount, sampleSize),
            recused: agg.recused,
            absent: agg.absent,
            abstain: agg.abstain,
            other: agg.other,
            pattern: buildPattern(agg, distinctItemCount),
            evidence: sortedEvidence,
          };
        });

      const overall = axes.reduce(
        (acc, a) => ({
          sampleSize: acc.sampleSize + a.sampleSize,
          for: acc.for + a.for,
          against: acc.against + a.against,
          recused: acc.recused + a.recused,
          absent: acc.absent + a.absent,
          abstain: acc.abstain + a.abstain,
          other: acc.other + a.other,
        }),
        {
          sampleSize: 0,
          for: 0,
          against: 0,
          recused: 0,
          absent: 0,
          abstain: 0,
          other: 0,
        },
      );

      const notOnRoster = notOnRosterCommittee + notOnRosterCouncilGap;

      issuesOut[issueId] = {
        issueLabel: ISSUES[issueId].label,
        // Direction-bearing divided votes on this issue since 2023 (across
        // all councillors) — NOT the same as the issue's total divided-vote
        // count (see /election/issues), which also counts votes with no
        // clear direction. Kept as its own field, always paired with
        // notOnRoster in the rendered summary, so the arithmetic on the
        // page actually closes: directionBearing.length === overall.for +
        // overall.against + recused + absent + abstain + other + notOnRoster.
        divisionsInCorpus: directionBearing.length,
        notOnRoster,
        // Split for honest wording (see the comment above the counters
        // above): committee non-membership vs. a Council-meeting data gap.
        notOnRosterCommittee,
        notOnRosterCouncilGap,
        overall,
        axes,
      };
    }

    councillorsOut[councillor.slug] = {
      displayName: councillor.displayName,
      ward: councillor.ward,
      role: councillor.role,
      // hub-recheck verdict finding 6, per-profile disclosure: how many
      // result/vote-array-mismatched motions (see result-mismatches.json)
      // named THIS councillor in any vote-kind bucket, and were therefore
      // dropped from the divided-vote universe before they could be used
      // for any claim about this person.
      resultMismatchesExcluding: mismatchInvolvementOf(
        resultMismatches,
        councillor.displayName,
      ),
      issues: issuesOut,
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    sourceHash: allMotionsRaw.sourceHash,
    sourceGeneratedAt: allMotionsRaw.generatedAt,
    cutoffDate: CUTOFF_DATE,
    methodology:
      "Per councillor per issue per axis: 'for' = their vote aligned with the axis's expansive/permissive outcome, 'against' = aligned with its restrictive outcome. For an axis with its own content pattern (e.g. density, budget-levy size, business-case inclusion), this is a genuine translation of the clause's own text, not raw yea/nay. For the generic fallback axis ('approved/denied the item', used when no content pattern matches), honestly disclosed: the corpus was swept (2026-08-31) for every denial phrasing used in a non-truncated, tracked-issue motion, and none exists as of this pass — every candidate either hit the source data's 500-character truncation cap or fell outside the eight tracked issues — so on that axis specifically, 'for'/'against' reduces to the motion's own yea/nay outcome, because the clause's own text offers no separate signal to translate. Recusals and absences are counted separately, never folded into 'against' and never inferred as a position. A councillor with no entry for a motion was not on that meeting's roster — for a committee meeting this means not a member of that committee; for a Council meeting (where all 15 members sit) it means the source data has a gap for that person on that motion, not that they weren't a member (see notOnRosterCommittee vs. notOnRosterCouncilGap on each issue). Motions whose own minuted result disagrees with its parsed vote arrays are excluded entirely before any of this — see result-mismatches.json and each councillor's resultMismatchesExcluding count.",
    councillors: councillorsOut,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "stances.json"),
    JSON.stringify(out, null, 2),
  );
}

main();
