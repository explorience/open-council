/**
 * Election Hub — stance engine
 *
 * Deterministic generator: data/votes/_all-motions.json + registry.json →
 * data/election/issues.json + data/election/stances.json.
 *
 * Pipeline (rebuilt 2026-08-31):
 *  1. Filter to divided (non-unanimous, non-procedural) motions since
 *     2023-01-01, excluding roster conflicts, appointment ballots,
 *     result/vote-array mismatches, and anything the classify pipeline's
 *     own verification pass flagged 'not_divided' (see the guard functions
 *     and not-divided.json below).
 *  2. Classify each into one of 8 issue clusters, or leave unclassified
 *     ('none') — never force-fit. Issue, axis, polarity and "what a yea
 *     did" are sourced from data/election/classify/batch-*-verified.json,
 *     a per-motion classification independently verified against each
 *     motion's own COMPLETE text in the source meeting record (not the
 *     500-char-truncated copy in data/votes/_all-motions.json, and not a
 *     keyword-matching regex). Only a 'confirmed' or 'corrected' verdict
 *     with a non-null axis/polarity is direction-bearing; everything else
 *     (a 'downgraded' verdict, or a genuinely unclear motion — referral,
 *     informational ask, no operative content) is listed for transparency
 *     but excluded from stance aggregation.
 *  3. The regex engine in issue-rules.ts/direction-rules.ts still runs over
 *     the same corpus, purely as a disagreement report against the
 *     verified data (data/election/classify/regex-vs-llm.json) — it is
 *     never the source of a published claim.
 *  4. Aggregate per councillor per issue per axis: how often their vote
 *     aligned with the axis's expansive outcome vs its restrictive outcome,
 *     with recusals/absences tracked and labeled separately (never folded
 *     into a "no position" bucket, never treated as opposition), and a
 *     pattern floor gated on DISTINCT DECISIONS (committee + council
 *     stages of one policy decision collapse to one), not raw vote rows.
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
import {
  deriveDirection,
  axisLabelsFor,
  type Direction,
} from "./direction-rules.js";
import { motionAnchor } from "./anchors.js";

const CUTOFF_DATE = "2023-01-01";
const REPO_ROOT = path.join(process.cwd());
const MOTIONS_PATH = path.join(REPO_ROOT, "data/votes/_all-motions.json");
const CLASSIFY_DIR = path.join(REPO_ROOT, "data/election/classify");
const OUT_DIR = path.join(REPO_ROOT, "data/election");
const REGEX_VS_LLM_PATH = path.join(CLASSIFY_DIR, "regex-vs-llm.json");

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
// Verified classification (data/election/classify/batch-*-verified.json)
//
// Rebuilt 2026-08-31: issue, axis, polarity and "what a yea did" now come
// from this human-verified, LLM-assisted classification pass (one entry per
// motion, read against the motion's own COMPLETE text in the source meeting
// JSON — never the 500-char-truncated data/votes/_all-motions.json copy),
// not from the regex engine in issue-rules.ts / direction-rules.ts. Every
// entry carries its own verdict ("confirmed" = independently re-checked and
// correct as classified, "corrected" = independently re-checked and fixed,
// "downgraded" = independently re-checked and found NOT to support a
// direction claim after all, axis/polarity forced back to null) plus a
// verifierNote explaining the call. Only "confirmed" or "corrected" entries
// with a non-null polarity are published as direction-bearing; everything
// else (verdict "downgraded", or a confirmed/corrected entry whose axis or
// polarity is null because the motion genuinely has no clear direction —
// e.g. a referral or an informational-ask) is listed for transparency but
// excluded from stance aggregation, same treatment as any other unclear
// motion. The regex engine is still run over the same corpus (see
// crossCheckAgainstRegex below) purely as a disagreement report — it is
// never the source of a published claim.
// ---------------------------------------------------------------------------

interface VerifiedEntry {
  id: string;
  /** IssueId, or the literal string "none" for a motion no issue applies to
   * (this classification pass's equivalent of the old regex engine's
   * "unclassified" — never force-fit). */
  issue: IssueId | "none";
  axis: string | null;
  polarity: "expansive" | "restrictive" | null;
  whatAYeaDid: string;
  confidence: string;
  quote: string;
  flags: string[];
  verdict: "confirmed" | "corrected" | "downgraded";
  verifierNote: string;
}

/** Load every data/election/classify/batch-*-verified.json file into one
 * id -> entry map. Throws on a duplicate id (a real data error — the
 * classify pipeline is supposed to partition motions into disjoint
 * batches) rather than silently letting the later batch win. */
function loadVerifiedClassifications(): Map<string, VerifiedEntry> {
  const map = new Map<string, VerifiedEntry>();
  if (!fs.existsSync(CLASSIFY_DIR)) return map;
  const files = fs
    .readdirSync(CLASSIFY_DIR)
    .filter((f) => /^batch-\d+-verified\.json$/.test(f));
  for (const f of files) {
    const entries: VerifiedEntry[] = JSON.parse(
      fs.readFileSync(path.join(CLASSIFY_DIR, f), "utf-8"),
    );
    for (const e of entries) {
      if (map.has(e.id)) {
        throw new Error(
          `duplicate verified classification id ${e.id} (in ${f}) — classify batches must be disjoint`,
        );
      }
      map.set(e.id, e);
    }
  }
  return map;
}

/** True when this motion's verified entry carries the "not_divided" flag —
 * the classify pipeline's own catch for a motion that isn't a genuine
 * division even though the source `unanimous` field says false (e.g. a 0
 * yea / N nay result, where the record shows a scraper's boolean not
 * catching a lopsided-but-still-technically-recorded vote as unanimous; or
 * the exact same motion recorded twice under two different item numbers).
 * Excluded from the divided-vote universe entirely, same treatment as a
 * roster conflict or a result mismatch — never guessed at, always
 * disclosed. A motion with no verified entry at all is NOT treated as
 * not_divided by this check (see missingFromManifest handling in main). */
function isNotDivided(
  verified: Map<string, VerifiedEntry>,
  motionId: string,
): boolean {
  return Boolean(verified.get(motionId)?.flags.includes("not_divided"));
}

/** Translate one verified classification entry into the same Direction
 * shape the (now cross-check-only) regex engine used to produce, per the
 * publish rule: only a "confirmed" or "corrected" verdict with a non-null
 * axis AND polarity is direction-bearing; a "downgraded" verdict, or a
 * confirmed/corrected entry the classify pipeline itself left with a null
 * axis/polarity (informational-ask, referral, or a genuine no-clear-effect
 * call), is listed-but-unclear — same treatment as any other non-decision,
 * never guessed at. When unclear, the entry's own neutral whatAYeaDid text
 * (independently verified, just not tied to a direction) is used as the
 * label instead of a bare "unclear" placeholder — it's a truthful
 * description of what happened even when it doesn't support a for/against
 * claim. */
function directionFromVerified(
  entry: VerifiedEntry,
): Direction | { axis: null; label: string } {
  const isDirectionBearing =
    (entry.verdict === "confirmed" || entry.verdict === "corrected") &&
    entry.axis !== null &&
    entry.polarity !== null;

  if (isDirectionBearing) {
    const issue = entry.issue as IssueId;
    const axis = entry.axis as string;
    const axisLabels = axisLabelsFor(issue, axis) ?? {
      expansive: entry.whatAYeaDid,
      restrictive: entry.whatAYeaDid,
    };
    const valence: 1 | -1 = entry.polarity === "expansive" ? 1 : -1;
    return {
      axis,
      valence,
      label: entry.whatAYeaDid,
      axisLabels,
    };
  }

  return { axis: null, label: entry.whatAYeaDid || "unclear" };
}

// ---------------------------------------------------------------------------
// Regex-vs-LLM cross-check (report only — see REGEX_VS_LLM_PATH doc above).
// The regex engine (issue-rules.ts classifyIssue + direction-rules.ts
// deriveDirection) runs against the same TRUNCATED motionText it always has
// — that's fine here, since this is only a disagreement report, not a
// publish path; a disagreement caused purely by truncation is still a
// legitimate thing to flag as "the regex engine and the verified pipeline
// don't currently agree on this motion".
// ---------------------------------------------------------------------------

interface RegexDisagreement {
  motionId: string;
  date: string;
  meetingSlug: string;
  itemNumber: string;
  itemTitle: string;
  kind: "issue" | "axis" | "polarity";
  regex: { issue: string | null; axis: string | null; valence: number | null };
  llm: { issue: string | null; axis: string | null; polarity: string | null };
}

function crossCheckAgainstRegex(
  motion: RawMotion,
  entry: VerifiedEntry | undefined,
): RegexDisagreement | null {
  const regexResult = classifyIssue(motion.itemTitle, motion.motionText);
  const regexDirection = regexResult
    ? deriveDirection(regexResult.issue, motion.motionText)
    : null;

  const regexIssue = regexResult?.issue ?? null;
  const regexAxis = regexDirection?.axis ?? null;
  const regexValence =
    regexDirection && regexDirection.axis !== null
      ? regexDirection.valence
      : null;

  const llmIssue = !entry || entry.issue === "none" ? null : entry.issue;
  const llmDirectionBearing =
    entry &&
    (entry.verdict === "confirmed" || entry.verdict === "corrected") &&
    entry.axis !== null &&
    entry.polarity !== null;
  const llmAxis = llmDirectionBearing ? (entry!.axis as string) : null;
  const llmPolarity = llmDirectionBearing ? entry!.polarity : null;

  let kind: RegexDisagreement["kind"] | null = null;
  if (regexIssue !== llmIssue) kind = "issue";
  else if (regexIssue !== null && llmIssue !== null && regexAxis !== llmAxis)
    kind = "axis";
  else if (
    regexAxis !== null &&
    llmAxis !== null &&
    regexAxis === llmAxis &&
    regexValence !== null &&
    llmPolarity !== null &&
    (regexValence === 1 ? "expansive" : "restrictive") !== llmPolarity
  )
    kind = "polarity";

  if (!kind) return null;
  return {
    motionId: motion.id,
    date: motion.date,
    meetingSlug: motion.meetingSlug,
    itemNumber: motion.itemNumber,
    itemTitle: motion.itemTitle,
    kind,
    regex: { issue: regexIssue, axis: regexAxis, valence: regexValence },
    llm: { issue: llmIssue, axis: llmAxis, polarity: llmPolarity },
  };
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
 * cuts mid-word with no ellipsis marker. Before 2026-08-31 this forced
 * direction 'unclear' regardless of what deriveDirection's regex found,
 * because a denial/exclusion/removal clause past character 500 would be
 * silently invisible to a regex reading THIS truncated copy. That's no
 * longer the risk it was: direction now comes from
 * data/election/classify/batch-*-verified.json, which was independently
 * verified against each motion's own COMPLETE text in the source meeting
 * record, not this truncated copy — so a motion hitting this cap is no
 * longer forced unclear. This flag is kept purely as a display-layer fact
 * (how many classified motions have a motionText excerpt on this hub that's
 * capped, for the "why does this quote end mid-sentence" reader question),
 * disclosed on the issues page, not as an exclusion reason. */
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
  direction: Direction | { axis: null; label: string };
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

  const verified = loadVerifiedClassifications();

  const rosterConflicts = allSinceCutoff.filter(hasRosterConflict);
  const appointmentBallots = allSinceCutoff.filter(isAppointmentBallot);
  const resultMismatches = allSinceCutoff.filter(
    (m) =>
      !hasRosterConflict(m) && !isAppointmentBallot(m) && hasResultMismatch(m),
  );
  const passedHardGuards = allSinceCutoff.filter(
    (m) =>
      !hasRosterConflict(m) && !isAppointmentBallot(m) && !hasResultMismatch(m),
  );
  const notDivided = passedHardGuards.filter((m) =>
    isNotDivided(verified, m.id),
  );
  const divided = passedHardGuards.filter((m) => !isNotDivided(verified, m.id));

  if (notDivided.length > 0) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, "not-divided.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note: "Motions dropped from the divided-vote universe because the classify pipeline's own verification pass flagged them 'not_divided': either the recorded tally has zero votes on one side (a lopsided-but-technically-not-flagged-unanimous result the source data's own 'unanimous' boolean missed), or the exact same motion is recorded twice under two different agenda item numbers (which would otherwise double-count one real decision). See each motion's own verifierNote in data/election/classify/batch-*-verified.json for the specific reason. Never guessed at or silently kept.",
          count: notDivided.length,
          motions: notDivided.map((m) => ({
            id: m.id,
            date: m.date,
            meetingSlug: m.meetingSlug,
            itemNumber: m.itemNumber,
            itemTitle: m.itemTitle,
            result: m.result,
            verifierNote: verified.get(m.id)?.verifierNote ?? null,
          })),
        },
        null,
        2,
      ),
    );
    console.log(
      `Dropped ${notDivided.length} motion(s) flagged not_divided by the classify pipeline — see data/election/not-divided.json`,
    );
  }

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
  let truncatedDisplayCount = 0;
  let missingFromManifestCount = 0;
  const regexDisagreements: RegexDisagreement[] = [];

  for (const motion of divided) {
    if (isTruncated(motion)) truncatedDisplayCount++;

    // Cross-check only, never published from — see crossCheckAgainstRegex.
    const disagreement = crossCheckAgainstRegex(
      motion,
      verified.get(motion.id),
    );
    if (disagreement) regexDisagreements.push(disagreement);

    const entry = verified.get(motion.id);
    if (!entry) {
      // Every motion in `divided` (guarded, since 2023-01-01) is expected to
      // have a manifest entry — the classify pipeline was built to cover
      // exactly this set. A miss here is a real data gap, not a normal
      // outcome: treated the same as "no issue applies" (never force-fit
      // from the regex fallback) but tracked separately so it's visible
      // rather than silently folded into the ordinary unclassified count.
      missingFromManifestCount++;
      unclassifiedCount++;
      unclassifiedSample.push({
        id: motion.id,
        date: motion.date,
        itemNumber: motion.itemNumber,
        itemTitle: motion.itemTitle,
      });
      continue;
    }

    if (entry.issue === "none") {
      unclassifiedCount++;
      unclassifiedSample.push({
        id: motion.id,
        date: motion.date,
        itemNumber: motion.itemNumber,
        itemTitle: motion.itemTitle,
      });
      continue;
    }

    const direction = directionFromVerified(entry);
    const anchorResult = motionAnchor(
      motion.meetingSlug,
      motion.itemNumber,
      motion.result,
    );

    classified.push({
      motion,
      issue: entry.issue,
      matchedKeywords: entry.flags,
      direction,
      tally: tallyOf(motion),
      positions: positionsOf(motion, lookup),
      anchor: anchorResult?.url ?? null,
      anchorAmbiguous: anchorResult?.ambiguous ?? false,
    });
  }

  if (missingFromManifestCount > 0) {
    console.warn(
      `WARNING: ${missingFromManifestCount} divided motion(s) since ${CUTOFF_DATE} have no entry in data/election/classify/batch-*-verified.json — treated as unclassified, not guessed at. Regenerate the classify manifest to cover them.`,
    );
  }

  fs.mkdirSync(path.dirname(REGEX_VS_LLM_PATH), { recursive: true });
  fs.writeFileSync(
    REGEX_VS_LLM_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: "Cross-check report only — the regex engine in issue-rules.ts/direction-rules.ts is NOT the source of any published claim as of the 2026-08-31 rebuild; every published issue/axis/polarity/whatAYeaDid comes from data/election/classify/batch-*-verified.json. This file records every motion in the divided universe where the regex engine's independent read (issue classification and/or direction) disagrees with the verified classification, for ongoing regex-quality monitoring.",
        totalCompared: divided.length,
        disagreementCount: regexDisagreements.length,
        disagreements: regexDisagreements,
      },
      null,
      2,
    ),
  );
  console.log(
    `Regex-vs-LLM cross-check: ${regexDisagreements.length} disagreement(s) of ${divided.length} compared — see data/election/classify/regex-vs-llm.json`,
  );

  writeIssuesFile(
    allMotionsRaw,
    classified,
    unclassifiedCount,
    unclassifiedSample,
    truncatedDisplayCount,
    resultMismatches.length,
    rosterConflicts.length,
    notDivided.length,
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
//
// Fixed 2026-08-31 (round-2 finding S3): the original `[^.]*\.` terminator
// stopped at the FIRST period, which in this corpus is very often a single
// initial in a name/title ("Deputy Mayor S. Lewis", "His Worship Mayor J.
// Morgan") rather than the end of the sentence — leaving the tail of the
// aside (", places Councillor H. McAlister in the Chair.") dangling in the
// excerpt. The repeating group now also consumes a period immediately
// preceded by a single capital letter at a word boundary (an initial —
// "\b[A-Z]\.") as a non-terminal character, so the match only actually ends
// at a period that follows a real word (lowercase letter, digit, etc.), not
// an initial.
const STAGE_DIRECTION_RE =
  /\bAt\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b(?:[^.]|(?<=\b[A-Z])\.)*\.\s*/gi;

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
  truncatedDisplayCount: number,
  resultMismatchCount: number,
  rosterConflictCount: number,
  notDividedCount: number,
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
                ? { axis: null, label: c.direction.label }
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
      "Divided = non-unanimous, non-procedural motion, 2023-01-01 onward, excluding secret-ballot appointment rounds (result 'Majority Winner: ...'), motions with a roster data conflict (the same person recorded in two vote-kind buckets — see roster-conflicts.json), motions whose own minuted result string disagrees with its parsed yeas/nays arrays (see result-mismatches.json), and motions the classify pipeline's own verification pass flagged 'not_divided' — a lopsided result the source data's 'unanimous' field didn't catch, or the same motion recorded twice under two item numbers (see not-divided.json). Rebuilt 2026-08-31: issue, axis, polarity and 'what a yea did' are sourced from data/election/classify/batch-*-verified.json, a per-motion classification independently verified against each motion's own COMPLETE text in the source meeting record (never the 500-character-truncated copy in data/votes/_all-motions.json) — not from a keyword-matching regex. Only entries with verdict 'confirmed' or 'corrected' and a non-null axis/polarity are direction-bearing; a 'downgraded' verdict or a confirmed/corrected entry with no clear direction (a referral, an informational report-back ask, or a genuinely ambiguous clause) is listed here but excluded from stance aggregation in stances.json, same as any other non-decision. The regex engine in scripts/election/issue-rules.ts and direction-rules.ts still runs over the same corpus as a disagreement report only (data/election/classify/regex-vs-llm.json) — it is not the source of any claim published here. Window note: this classify pass also covers 24 divided motions from Nov-Dec 2022 (before the 2023-01-01 cutoff below); they're verified and present in the classify data but not used on any published page, pending a decision on whether to extend the cutoff back to cover them.",
    truncatedDisplayCount,
    resultMismatchCount,
    rosterConflictCount,
    notDividedCount,
    issues,
    unclassified: {
      count: unclassifiedCount,
      note: "Divided motions since 2023 the verified classification pass assigned issue 'none' (no tracked issue applies), plus any motion missing a classify entry entirely (tracked separately — see the console warning at generation time; none are guessed at or force-fit into a cluster). All are listed here.",
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

/** Normalize an agenda item title for decision-level matching: strip a
 * leading "(4.1) " style item-number echo (Council agenda titles frequently
 * restate the committee's own sub-item number this way when the same
 * decision moves from committee to Council), collapse whitespace, and
 * lowercase. Two rows with the same normalized title are candidates for
 * being the SAME underlying decision recorded at two meeting stages. */
function normalizeItemTitle(title: string): string {
  return title
    .replace(/^\(\s*[\d.]+\s*\)\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Round-2 finding B3: distinctItemCount used to be keyed on
 * `${meetingSlug}#${itemNumber}` — a genuinely different (slug, item
 * number) pair for the SAME policy decision voted at both a committee stage
 * and its later Council stage (e.g. "Mobility Master Plan Mobility Networks
 * Maps" at PEC on 2025-03-25, then again at Council on 2025-04-01, 7 days
 * later, same title) counted as two decisions and let a committee+council
 * pair manufacture an apparent track record out of one real decision.
 *
 * This collapses rows into DECISIONS: two rows whose item titles normalize
 * to the same string (see normalizeItemTitle) and whose dates are within 60
 * days of each other are treated as stages of one decision. Uses
 * union-find so a chain of 3+ same-title rows within the window all
 * collapse together, not just adjacent pairs. Small inputs (a handful of
 * rows per councillor per axis) — O(n^2) comparison is plenty fast. */
function countDistinctDecisions(
  rows: { itemTitle: string; date: string }[],
): number {
  const n = rows.length;
  if (n === 0) return 0;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
  const normalized = rows.map((r) => normalizeItemTitle(r.itemTitle));
  const dates = rows.map((r) => Date.parse(r.date));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (normalized[i] !== normalized[j]) continue;
      if (Math.abs(dates[i] - dates[j]) > WINDOW_MS) continue;
      union(i, j);
    }
  }
  const roots = new Set<number>();
  for (let i = 0; i < n; i++) roots.add(find(i));
  return roots.size;
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
          // suppress). Further collapsed to DECISION level (round-2 finding
          // B3, 2026-08-31): see countDistinctDecisions — a committee-stage
          // and council-stage vote on the same policy decision (same
          // normalized item title, within 60 days) now count as ONE
          // decision, not two, so the floor can no longer be cleared by a
          // single decision that happened to generate two recorded stages.
          const distinctItemCount = countDistinctDecisions(
            sortedEvidence.filter(
              (e) => e.theirVote === "yea" || e.theirVote === "nay",
            ),
          );
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
      "Per councillor per issue per axis: 'for' = their vote aligned with the axis's expansive/permissive outcome, 'against' = aligned with its restrictive outcome. Rebuilt 2026-08-31: axis and polarity for every motion come from data/election/classify/batch-*-verified.json, a per-motion classification independently verified against each motion's own complete text in the source meeting record — this is a genuine translation of what the clause did, not raw yea/nay, on every axis including the generic 'approved/denied the item' fallback used when no issue-specific content axis applies. Recusals and absences are counted separately, never folded into 'against' and never inferred as a position. Below 5 DISTINCT DECISIONS on an axis (committee and council votes on the same policy decision, identified by matching agenda-item title within 60 days, count as one decision — not one per meeting stage), no pattern sentence is asserted; the individual votes are still shown. A councillor with no entry for a motion was not on that meeting's roster — for a committee meeting this means not a member of that committee; for a Council meeting (where all 15 members sit) it means the source data has a gap for that person on that motion, not that they weren't a member (see notOnRosterCommittee vs. notOnRosterCouncilGap on each issue). Motions whose own minuted result disagrees with its parsed vote arrays, or that the classify pipeline flagged not a genuine division, are excluded entirely before any of this — see result-mismatches.json, not-divided.json, and each councillor's resultMismatchesExcluding count.",
    councillors: councillorsOut,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "stances.json"),
    JSON.stringify(out, null, 2),
  );
}

main();
