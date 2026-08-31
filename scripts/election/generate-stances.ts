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
  const divided = allSinceCutoff.filter(
    (m) => !hasRosterConflict(m) && !isAppointmentBallot(m),
  );

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
    const anchor = motionAnchor(
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
      anchor,
    });
  }

  writeIssuesFile(
    allMotionsRaw,
    classified,
    unclassifiedCount,
    unclassifiedSample,
    truncatedExcludedCount,
  );
  writeStancesFile(allMotionsRaw, classified, lookup);

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
function motionSnippet(motionText: string): string {
  const s = motionText.trim().replace(/\s+/g, " ");
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
      "Divided = non-unanimous, non-procedural motion, 2023-01-01 onward, excluding secret-ballot appointment rounds (result 'Majority Winner: ...') and motions with a roster data conflict (the same person recorded in two vote-kind buckets — see roster-conflicts.json). Classified via scripts/election/issue-rules.ts, which requires a keyword match in the motion's own body text (or a structural code pattern), not the agenda item's title alone. Direction ('what a yea did') derived via scripts/election/direction-rules.ts; motions with direction 'unclear' — including any motion whose text hit the 500-character truncation cap in the source data, since a cut-off clause can flip the read — are listed here but excluded from stance aggregation in stances.json.",
    truncatedExcludedCount,
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
// the evidence supports — 60 axis sections across the hub used to publish
// a "1 of 1" or "0 of 2" sentence as if it were a track record. Below this
// many direction-bearing yea/nay votes on an axis, the individual votes are
// shown but no pattern sentence is asserted.
const MIN_PATTERN_SAMPLE_SIZE = 5;

function recusalAbsentClause(agg: Pick<AxisAgg, "recused" | "absent">): string {
  const bits: string[] = [];
  if (agg.recused > 0) {
    bits.push(
      `recused ${agg.recused} (declared a pecuniary interest, which the Municipal Conflict of Interest Act requires a member to do)`,
    );
  }
  if (agg.absent > 0) bits.push(`absent ${agg.absent}`);
  return bits.length ? ` (${bits.join(", ")})` : "";
}

/** Neutral pattern sentence for one axis. Two responsible-build fixes
 * baked in here:
 *  1. "for"/"against" count DIRECTION-ALIGNMENT, not raw yea/nay — a nay on
 *     a motion that cuts the levy is a "for" (toward the axis's expansive
 *     side is wrong; it's toward restrictive... the point is it is NOT a
 *     yea). The old wording ("Voted for the measure in N of M votes ...
 *     that increased ...") read as if every "for" was a yea on an
 *     increase, when up to half of any axis's "for"/"against" counts can
 *     be direction-aligned nays. This phrasing never claims a vote kind,
 *     only which side a vote moved toward.
 *  2. Below MIN_PATTERN_SAMPLE_SIZE, no pattern is asserted at all.
 */
function buildPattern(
  agg: Pick<
    AxisAgg,
    "forCount" | "againstCount" | "recused" | "absent" | "axisLabels"
  >,
): string {
  const sampleSize = agg.forCount + agg.againstCount;
  if (sampleSize === 0) {
    return `No direction-bearing votes cast on this axis since 2023${recusalAbsentClause(agg) || " (recused 0, absent 0)"}.`;
  }
  if (sampleSize < MIN_PATTERN_SAMPLE_SIZE) {
    const voteWord = sampleSize === 1 ? "vote" : "votes";
    const isAre = sampleSize === 1 ? "is" : "are";
    return `Only ${sampleSize} such ${voteWord} since 2023${recusalAbsentClause(agg)} — too few to describe a pattern. The individual vote${sampleSize === 1 ? "" : "s"} ${isAre} listed below.`;
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

      for (const c of directionBearing) {
        const vote = c.positions[councillor.slug];
        if (vote === undefined) continue; // not on the roster for this motion — not applicable, not absent

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
          const distinctItemCount = new Set(
            sortedEvidence.map((e) => `${e.meetingSlug}#${e.itemNumber}`),
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
            pattern: buildPattern(agg),
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

      const notOnRoster =
        directionBearing.length -
        (overall.sampleSize +
          overall.recused +
          overall.absent +
          overall.abstain +
          overall.other);

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
        overall,
        axes,
      };
    }

    councillorsOut[councillor.slug] = {
      displayName: councillor.displayName,
      ward: councillor.ward,
      role: councillor.role,
      issues: issuesOut,
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    sourceHash: allMotionsRaw.sourceHash,
    sourceGeneratedAt: allMotionsRaw.generatedAt,
    cutoffDate: CUTOFF_DATE,
    methodology:
      "Per councillor per issue per axis: 'for' = their vote aligned with the axis's expansive/permissive outcome, 'against' = aligned with its restrictive outcome (not raw yea/nay — see direction-rules.ts). Recusals and absences are counted separately, never folded into 'against' and never inferred as a position. A councillor with no entry for a motion was not on that meeting's roster (e.g. not a committee member) — not applicable, not absent.",
    councillors: councillorsOut,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "stances.json"),
    JSON.stringify(out, null, 2),
  );
}

main();
