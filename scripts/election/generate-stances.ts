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
import { normalizeCouncillorName } from "../../lib/councillors/normalize.js";

const CUTOFF_DATE = "2023-01-01";
const REPO_ROOT = path.join(process.cwd());
const MOTIONS_PATH = path.join(REPO_ROOT, "data/votes/_all-motions.json");
const CLASSIFY_DIR = path.join(REPO_ROOT, "data/election/classify");
const OUT_DIR = path.join(REPO_ROOT, "data/election");
const REGEX_VS_LLM_PATH = path.join(CLASSIFY_DIR, "regex-vs-llm.json");
const CORRECTIONS_PATH = path.join(CLASSIFY_DIR, "corrections.json");

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

// ---------------------------------------------------------------------------
// Classification corrections layer (data/election/classify/corrections.json)
//
// Per the fixer's P4 rule: a specific classification defect found after the
// verified batches shipped is NEVER patched by silently editing
// batch-*-verified.json in place — it goes in this separate, append-only
// corrections file instead, as {id, field, was, now, reason, quote} rows,
// applied here at load time. This keeps the original verification pass
// intact and auditable (every verified entry still says what the
// independent verifier concluded) while letting a later, narrower defect
// (an advocacy motion wrongly given a hard direction, an axis/polarity
// mismatch, a too-short fragment) get fixed with its own reasoning and
// quote, on the record, without rewriting history.
// ---------------------------------------------------------------------------

interface Correction {
  id: string;
  field: "axis" | "polarity";
  was: string | null;
  now: string | null;
  reason: string;
  quote: string;
}

/** Load data/election/classify/corrections.json (if present) and apply every
 * row to the in-memory verified-classification map, in file order. Each
 * correction's `was` value is checked against the entry's CURRENT value
 * before applying (not just the original batch value) — a mismatch throws,
 * since a stale correction silently applied to the wrong state is exactly
 * the kind of unaudited edit this layer exists to prevent. A correction
 * naming an id with no verified entry at all also throws. Setting a field to
 * null degrades the motion the same way a "downgraded" verdict does
 * (excluded from stance aggregation, listed as unclear) without touching the
 * verdict string itself, since the ORIGINAL verification (verdict,
 * confidence, verifierNote) is still a true record of what that pass
 * concluded — this layer is a correction found afterward, not a rewrite of
 * what was checked at the time. */
function applyCorrections(verified: Map<string, VerifiedEntry>): number {
  if (!fs.existsSync(CORRECTIONS_PATH)) return 0;
  const corrections: Correction[] = JSON.parse(
    fs.readFileSync(CORRECTIONS_PATH, "utf-8"),
  );
  for (const c of corrections) {
    const entry = verified.get(c.id);
    if (!entry) {
      throw new Error(
        `corrections.json references motion ${c.id} (field ${c.field}), which has no verified classification entry at all`,
      );
    }
    const current = entry[c.field];
    if (current !== c.was) {
      throw new Error(
        `corrections.json expected ${c.id}.${c.field} to currently be ${JSON.stringify(c.was)}, but found ${JSON.stringify(current)} — the correction is stale (re-derive against the current batch data before reapplying)`,
      );
    }
    // Branched rather than a generic `entry[c.field] = c.now` assignment so
    // TypeScript can check `now` against each field's own narrower type
    // (VerifiedEntry.polarity is "expansive" | "restrictive" | null, not any
    // string) instead of widening it to `string | null` at the indexed-write
    // site.
    if (c.field === "axis") {
      entry.axis = c.now;
    } else {
      if (c.now !== null && c.now !== "expansive" && c.now !== "restrictive") {
        throw new Error(
          `corrections.json: ${c.id}.polarity 'now' must be "expansive", "restrictive", or null — got ${JSON.stringify(c.now)}`,
        );
      }
      entry.polarity = c.now;
    }
  }
  return corrections.length;
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

/** True when a motion's parsed yeas/nays arrays exactly match its own
 * minuted tally numbers, but it Failed despite a yea majority (more yeas
 * than nays) — the shape of a genuine supermajority requirement (e.g. a
 * bylaw amendment or procedural motion needing two-thirds), not a data
 * error. Found 2026-08-31 re-running the exclusion guards against the
 * voter-fusion-repaired corpus (#197): ~3 of the pre-repair 82
 * result-mismatch exclusions turned out to be this shape once the array
 * counts were fixed — the tally and the arrays fully agree on who voted
 * which way, only the "Passed"/"Failed" label disagrees with a simple
 * majority-rule read of that tally, because the underlying rule wasn't
 * majority rule. Deliberately narrow: only the Failed-with-yea-majority
 * direction is treated as a legitimate supermajority read here — a
 * Passed-without-a-yea-majority result has no equivalent "passed anyway"
 * governance rule and stays a real mismatch (see hasResultMismatch). */
function isSupermajorityFailure(m: RawMotion): boolean {
  const tally = extractResultTally(m.result);
  if (!tally) return false;
  if (tally.yea !== m.yeas.length || tally.nay !== m.nays.length) return false;
  return (
    /^Motion\s+Failed/i.test(m.result) && m.yeas.length > m.nays.length
  );
}

/** True when a motion's own minuted result string disagrees with its parsed
 * yeas/nays arrays — either the tally numbers don't match the array
 * lengths, or "Motion Passed"/"Motion Failed" doesn't match which side has
 * more votes, AND that disagreement isn't explained by a supermajority
 * requirement (see isSupermajorityFailure, checked first below — a
 * legitimate supermajority failure is not a mismatch). Found via
 * spot-check (2026-08-31, hub-recheck verdict finding 6): 82 divided
 * motions had this disagreement pre-repair — mostly an early-term
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
  if (isSupermajorityFailure(m)) return false;
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
  /** Set only for a legitimate supermajority failure (see
   * isSupermajorityFailure) — carried through to each per-row evidence
   * entry so the reader sees why a "Failed" result sits alongside a yea
   * majority, instead of the row silently looking like an error. */
  resultNote: string | null;
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
  const correctionsApplied = applyCorrections(verified);
  if (correctionsApplied > 0) {
    console.log(
      `Applied ${correctionsApplied} classification correction(s) from data/election/classify/corrections.json`,
    );
  }

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

  {
    // Unconditional write (2026-08-31 fix): the sibling not-divided/
    // roster-conflicts/corrections blocks below only write their disclosure
    // file when count > 0, which is fine for a class that's never yet been
    // empty — but this guard's count dropped from 82 to 0 in this same
    // repair pass (79 fixed by the voter-fusion corpus repair, 3
    // reclassified as legitimate supermajority failures, see
    // isSupermajorityFailure), and a conditional write would have left the
    // stale 82-entry file on disk forever, silently misreporting a
    // resolved data-quality class as still-broken. Always writing keeps
    // this one file honest about its own history across a repair.
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, "result-mismatches.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note: "Motions dropped from the divided-vote universe because the motion's own minuted result string (e.g. 'Motion Passed (11 to 4)') disagrees with its parsed yeas/nays arrays — either the tally numbers don't match the array lengths, or which side won doesn't match which side has more votes, and that disagreement isn't explained by a supermajority requirement. Mostly an early-term (2022-23) scraper gap. Needs manual repair against the source minutes; never guessed at or silently kept. A motion whose tally numbers DO match its arrays exactly but that Failed despite a yea majority is treated separately, as a legitimate supermajority failure — included in the divided universe with a per-row resultNote, not listed here (see isSupermajorityFailure in generate-stances.ts).",
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
      resultMismatches.length > 0
        ? `Dropped ${resultMismatches.length} motion(s) with a result/vote-array mismatch — see data/election/result-mismatches.json`
        : `0 motion(s) with a result/vote-array mismatch — data/election/result-mismatches.json rewritten empty`,
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
      resultNote: isSupermajorityFailure(motion)
        ? "failed — required a supermajority"
        : null,
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

// Fixed 2026-08-31 (hub-recheck round-3 gate BLOCKER, P1): "Their vote moved
// toward" used to print the bare axis-label ACTION phrase (e.g. "increased
// the police budget or complement") for BOTH a yea on an expansive motion
// AND a nay on a restrictive motion — collapsing "directly enacted this" and
// "blocked the opposite" into one sentence that reads as if an action
// happened when, on a nay, nothing did. Concretely: policing/budget-size has
// zero expansive-polarity motions in the whole corpus (all 6 direction-
// bearing motions are cuts) — every nay-on-a-cut was published as having
// "moved toward measures that increased the police budget ... 6 times",
// crediting four councillors with an increase that was never on the table.
// A YEA genuinely does move toward the motion's own polarity (voting yes to
// increase IS supporting an increase) — that half of the old phrasing was
// fine and is kept. A NAY never performed the opposite action; it only
// opposed the one actually on the table. Never claims a vote count/action
// this data doesn't support (P1); a corpus-wide-zero side is described
// honestly (P2) in buildPattern below, not implied here by a phantom label.
function movedTowardText(
  vote: VoteKind | "n/a",
  d: Direction | null,
): string | null {
  if (!d || (vote !== "yea" && vote !== "nay")) return null;
  const ownLabel = d.valence === 1 ? d.axisLabels.expansive : d.axisLabels.restrictive;
  return vote === "yea" ? ownLabel : `opposed a measure that would have ${ownLabel}`;
}

/** Fixed 2026-08-31 (round-4 gate item 4): whether a yea/nay vote counted
 * toward the axis's "for" (expansive/permissive) or "against" (restrictive)
 * tally — the same test buildPattern/forCount already apply, exposed here
 * per-row so the amendment-ladder consistency check below can compare one
 * councillor's votes WITHIN a decision group without re-deriving it. Null
 * for anything that isn't a yea/nay vote on a direction-bearing motion. */
function axisDirectionOf(
  theirVote: VoteKind | "n/a",
  d: Direction | null,
): "for" | "against" | null {
  if (!d || (theirVote !== "yea" && theirVote !== "nay")) return null;
  const votedExpansiveSide =
    (d.valence === 1 && theirVote === "yea") ||
    (d.valence === -1 && theirVote === "nay");
  return votedExpansiveSide ? "for" : "against";
}

function evidenceEntry(c: ClassifiedMotion, theirVote: VoteKind | "n/a") {
  const m = c.motion;
  const d = c.direction.axis !== null ? (c.direction as Direction) : null;
  return {
    motionId: m.id,
    axisDirection: axisDirectionOf(theirVote, d),
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
    // Honest per-row disclosure for a legitimate supermajority failure
    // (see isSupermajorityFailure/resultNote) — null for every ordinary
    // motion. Never a mismatch flag: this motion's arrays and tally agree
    // exactly; only the plain-majority reading of "who won" doesn't apply.
    resultNote: c.resultNote,
    theirVote,
    // Fixed 2026-08-31 (found while wiring the new unclear-evidence render,
    // hub-recheck round-3): this used to fall back to the bare literal
    // string "unclear" for every non-direction-bearing motion, discarding
    // the real, independently-verified whatAYeaDid text that
    // directionFromVerified always carries in c.direction.label (both
    // branches of that union have a `label` field — see its return type).
    // That text is exactly what makes the new unclear-evidence section
    // useful (e.g. "directed the Mayor... to write to AMO..." instead of a
    // bare "unclear"), so it's used whenever present; only a motion with
    // truly no verified description at all falls back to the placeholder.
    whatAYeaDid: c.direction.label || "unclear",
    movedToward: movedTowardText(theirVote, d),
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
  // Fixed 2026-08-31 (hub-recheck round-3 gate BLOCKER, P1/P2): forCount and
  // againstCount alone can't be described honestly in one sentence, because
  // each one is really TWO different kinds of vote conflated together —
  // "moved toward expansive" (forCount) is either a yea that directly voted
  // for an expansive-polarity motion, OR a nay that blocked a
  // restrictive-polarity motion (opposition, not enactment). Split into all
  // four combinations so buildPattern can say which happened, instead of
  // printing one action-label for both. forCount === yeaExpansive +
  // nayRestrictive and againstCount === nayExpansive + yeaRestrictive are
  // still available as the aggregate/percentage figures (forPct etc.).
  yeaExpansive: number; // voted yea on an expansive-polarity motion — directly enacted/supported the expansive outcome
  nayExpansive: number; // voted nay on an expansive-polarity motion — opposed the expansive outcome
  yeaRestrictive: number; // voted yea on a restrictive-polarity motion — directly enacted/supported the restrictive outcome
  nayRestrictive: number; // voted nay on a restrictive-polarity motion — opposed the restrictive outcome
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
 *  1. Fixed 2026-08-31 (hub-recheck round-3 gate BLOCKER, P1): the old
 *     single sentence used one axis-label ACTION phrase ("moved toward
 *     measures that increased the police budget ... N times") for BOTH a
 *     yea that directly enacted that outcome AND a nay that merely blocked
 *     the opposite — printing an action that, for every nay in the count,
 *     never happened. Every clause below is scoped to exactly one of the
 *     four (vote x polarity) combinations, and a nay clause is always
 *     phrased as opposition ("opposed N measure(s) that would have ..."),
 *     never as having performed the other side's action.
 *  2. Fixed 2026-08-31 (hub-recheck round-3 gate BLOCKER, P2): when the
 *     WHOLE CORPUS has no motion of a given polarity on this axis (e.g.
 *     policing/budget-size: 0 expansive-polarity motions ever recorded — see
 *     axisHasExpansive/axisHasRestrictive), that side is never rendered as
 *     "toward measures that increased the budget 0 times", which implies
 *     opportunities existed that didn't. Instead a single plain sentence
 *     states the corpus only ever offered one direction of motion on this
 *     axis, so a reader isn't left to infer a false "0 for, N against"
 *     symmetry from a side that was never actually on the table.
 *  3. Below MIN_PATTERN_SAMPLE_SIZE DISTINCT agenda items, no pattern is
 *     asserted at all — see the distinctItemCount comment above
 *     MIN_PATTERN_SAMPLE_SIZE.
 */
function buildPattern(
  agg: Pick<
    AxisAgg,
    | "yeaExpansive"
    | "nayExpansive"
    | "yeaRestrictive"
    | "nayRestrictive"
    | "recused"
    | "absent"
    | "axisLabels"
  >,
  distinctItemCount: number,
  axisHasExpansive: boolean,
  axisHasRestrictive: boolean,
): string {
  const sampleSize =
    agg.yeaExpansive + agg.nayExpansive + agg.yeaRestrictive + agg.nayRestrictive;
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

  const clause = (n: number, verb: "supported" | "opposed", label: string) =>
    `${verb} ${n} measure${n === 1 ? "" : "s"} that would have ${label}`;

  const clauses: string[] = [];
  if (axisHasExpansive) {
    if (agg.yeaExpansive > 0)
      clauses.push(clause(agg.yeaExpansive, "supported", agg.axisLabels.expansive));
    if (agg.nayExpansive > 0)
      clauses.push(clause(agg.nayExpansive, "opposed", agg.axisLabels.expansive));
  }
  if (axisHasRestrictive) {
    if (agg.yeaRestrictive > 0)
      clauses.push(clause(agg.yeaRestrictive, "supported", agg.axisLabels.restrictive));
    if (agg.nayRestrictive > 0)
      clauses.push(clause(agg.nayRestrictive, "opposed", agg.axisLabels.restrictive));
  }

  // P2: state plainly, once, when this axis's whole corpus (every
  // councillor, not just this one) only ever offered one direction of
  // motion — never implied by a silent "0" on the missing side.
  const oneSidedNote = !axisHasExpansive
    ? ` No motion on this axis since 2023 would have ${agg.axisLabels.expansive} — every direction-bearing motion here would have ${agg.axisLabels.restrictive}.`
    : !axisHasRestrictive
      ? ` No motion on this axis since 2023 would have ${agg.axisLabels.restrictive} — every direction-bearing motion here would have ${agg.axisLabels.expansive}.`
      : "";

  return (
    `Of ${sampleSize} divided votes since 2023 where the motion's effect on this axis was clear, this councillor ${clauses.join("; ")}` +
    recusalAbsentClause(agg) +
    "." +
    oneSidedNote
  );
}

/** Normalize an agenda item title for decision-level matching: strip a
 * leading "(4.1) " style item-number echo (Council agenda titles frequently
 * restate the committee's own sub-item number this way when the same
 * decision moves from committee to Council), a leading "Amendment - "/
 * "Amendment: " stage marker, collapse whitespace, and lowercase. Two rows
 * with the same normalized title are candidates for being the SAME
 * underlying decision recorded at two meeting stages.
 *
 * Fixed 2026-08-31 (hub-recheck round-3 gate BLOCKER, policing
 * near-duplicates): the item-number strip alone left "Amendment - Business
 * Case #P-29" and "(3.8) Business Case #P-29" normalizing to two DIFFERENT
 * strings (the committee-stage amendment keeps its "Amendment - " prefix,
 * the Council-stage echo doesn't), so the same real business-case question
 * never unioned across its two recorded stages. */
function normalizeItemTitle(title: string): string {
  return title
    .replace(/^\(\s*[\d.]+\s*\)\s*/, "")
    .replace(/^amendment\s*[-:–—]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Extract a normalized "Business/Budget Case #P-NN[/NN...]" key from an
 * agenda item title, or null if none appears. Business cases are re-debated
 * across multiple meeting stages (committee amendment, then Council) under
 * titles that otherwise share no common substring once the stage-marker
 * prefix differs in wording (see normalizeItemTitle) — matching on the case
 * number itself is a stronger, wording-independent signal that two rows are
 * the same underlying decision. Deliberately still combined with the same
 * time window as normalizeItemTitle in groupIntoDecisions (not used alone,
 * unbounded) because case numbers are reused across budget years. */
function extractBusinessCaseKey(title: string): string | null {
  const m = title.match(/\b(?:business|budget)\s+case\s*#?\s*(p-[\d/]+)/i);
  return m ? m[1].toLowerCase().replace(/\s+/g, "") : null;
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
 * to the same string (see normalizeItemTitle) — OR whose titles carry the
 * same business-case number (see extractBusinessCaseKey) — and whose dates
 * are within 60 days of each other are treated as stages of one decision.
 * Uses union-find so a chain of 3+ same-decision rows within the window all
 * collapse together, not just adjacent pairs. Small inputs (a handful of
 * rows per councillor per axis) — O(n^2) comparison is plenty fast.
 *
 * Fixed 2026-08-31 (hub-recheck round-3 gate BLOCKER): title-normalization
 * alone still missed real duplicates whose WORDING differs between meeting
 * stages even after stripping the item-number/"Amendment - " prefixes (e.g.
 * committee business cases are sometimes titled "Amendment - Business Case
 * #P-29 - Councillor X" at one stage and "(3.8) Business Case #P-29" at
 * another — same case number, different trailing mover-name text). Business-
 * case-number matching is a second, independent union condition, checked
 * alongside the title match rather than instead of it, so either signal can
 * merge two rows — still date-windowed, since case numbers repeat year over
 * year and a bare number match across budget cycles would wrongly merge two
 * genuinely different decisions. */
/** The union-find grouping itself, factored out of countDistinctDecisions
 * (round-4 gate item 4) so both the distinct-decision COUNT and the
 * amendment-ladder consistency check below can share one definition of
 * "same decision" — a same-day (within 60 days), same-subject group of
 * rows never disagrees between the two checks by construction. Returns
 * arrays of original-array INDICES, one array per decision group
 * (including singleton groups for a row with no same-decision sibling). */
function groupIntoDecisions<T extends { itemTitle: string; date: string }>(
  rows: T[],
): number[][] {
  const n = rows.length;
  if (n === 0) return [];
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
  const caseKeys = rows.map((r) => extractBusinessCaseKey(r.itemTitle));
  const dates = rows.map((r) => Date.parse(r.date));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(dates[i] - dates[j]) > WINDOW_MS) continue;
      const titleMatch = normalized[i] === normalized[j];
      const caseMatch =
        caseKeys[i] !== null && caseKeys[i] === caseKeys[j];
      if (!titleMatch && !caseMatch) continue;
      union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) {
      g = [];
      groups.set(r, g);
    }
    g.push(i);
  }
  return [...groups.values()];
}


/** Raw meeting-record roster, keyed by canonical councillor name (the
 * registry key form, e.g. "S. Franke" — the same form
 * normalizeCouncillorName() resolves present/remote_attendance/absent/
 * also_present entries to, so it can be compared directly against
 * CouncillorMeta.canonicalName). */
interface MeetingRoster {
  /** Present, remote_attendance, OR absent — a councillor in ANY of these
   * fields was a MEMBER of that committee that day (this is the actual
   * membership roster the meeting recorded; also_present is non-member
   * observers, not members). */
  members: Set<string>;
  /** Subset of members who were specifically in the meeting's own `absent`
   * field — a member who missed the whole meeting, not a data gap. */
  absentMembers: Set<string>;
}

const meetingRosterCache = new Map<string, MeetingRoster | null>();

/** Fixed 2026-08-31 (round-4 gate BLOCKER item 1): buildMeetingAttendance
 * above (removed) inferred committee membership from per-motion vote-kind
 * buckets — a councillor with no recorded vote ANYWHERE at a meeting read
 * as "not a member", even when the raw meeting JSON's own roster fields
 * (present / remote_attendance / absent) named them as a member who simply
 * has no captured vote on that one motion, or was absent that whole
 * meeting. Confirmed false on 49 of 662 "not a member of that committee"
 * claims (e.g. 2025-12-02 PEC: E. Peloza in remote_attendance; 2023-11-13
 * PEC: J. Morgan in absent) — spot-checked against the actual scraped
 * meeting file, not the vote buckets. This reads the roster fields
 * directly from the raw meeting JSON (data/<meetingSlug minus "months/">
 * .json — same file the scraper itself produced) instead. also_present is
 * deliberately excluded from `members`: those are named staff/guests/other
 * councillors sitting in on a committee they don't belong to, and folding
 * them in would recreate a milder version of the same false-membership
 * defect in the other direction. */
function loadMeetingRoster(meetingSlug: string): MeetingRoster | null {
  if (meetingRosterCache.has(meetingSlug)) {
    return meetingRosterCache.get(meetingSlug)!;
  }
  const filePath = path.join(
    REPO_ROOT,
    "data",
    meetingSlug.slice("months/".length) + ".json",
  );
  let roster: MeetingRoster | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const members = new Set<string>();
    const absentMembers = new Set<string>();
    for (const name of [
      ...(raw.present ?? []),
      ...(raw.remote_attendance ?? []),
    ]) {
      const canonical = normalizeCouncillorName(name);
      if (canonical) members.add(canonical);
    }
    for (const name of raw.absent ?? []) {
      const canonical = normalizeCouncillorName(name);
      if (canonical) {
        members.add(canonical);
        absentMembers.add(canonical);
      }
    }
    roster = { members, absentMembers };
  } catch {
    roster = null; // file missing/unparseable — caller falls back honestly
  }
  meetingRosterCache.set(meetingSlug, roster);
  return roster;
}

function writeStancesFile(
  allMotionsRaw: AllMotionsFile,
  classified: ClassifiedMotion[],
  lookup: Map<string, CouncillorMeta>,
  resultMismatches: RawMotion[],
) {
  const currentCouncillors = [...lookup.values()].filter((c) => c.isCurrent);

  // Fixed 2026-08-31 (hub-recheck round-3 gate BLOCKER, P2): whether an axis
  // ever has an expansive-polarity and/or restrictive-polarity motion at
  // ALL, computed once across the WHOLE corpus (every councillor, every
  // direction-bearing motion) — not per-councillor, since this is a fact
  // about the axis's own motion population, used by buildPattern to avoid
  // rendering "0 times toward X" as if a motion of that polarity was ever
  // actually on the table for anyone.
  const axisPolarityPresence = new Map<
    string,
    { expansive: boolean; restrictive: boolean }
  >();
  for (const c of classified) {
    if (c.direction.axis === null) continue;
    const d = c.direction as Direction;
    const key = `${c.issue}::${d.axis}`;
    const entry = axisPolarityPresence.get(key) ?? {
      expansive: false,
      restrictive: false,
    };
    if (d.valence === 1) entry.expansive = true;
    else entry.restrictive = true;
    axisPolarityPresence.set(key, entry);
  }

  const councillorsOut: Record<string, unknown> = {};

  for (const councillor of currentCouncillors) {
    const issuesOut: Record<string, unknown> = {};

    for (const issueId of ISSUE_ORDER) {
      const directionBearing = classified.filter(
        (c) => c.issue === issueId && c.direction.axis !== null,
      );
      // Fixed 2026-08-31 (hub-recheck round-3 gate BLOCKER): the standing
      // disclaimer promises unclear-direction votes "stay linked below for
      // transparency", but nothing ever rendered them — writeStancesFile
      // only ever collected direction-bearing motions. Collected here
      // (issue-level, not per-axis, since an unclear motion has no axis) for
      // every position this councillor actually holds (yea/nay/recuse/
      // absent/abstain/other) on a motion the classify pipeline confirmed or
      // corrected but left with no clear direction (a referral, an
      // informational ask, or a motion downgraded by data/election/classify/
      // corrections.json) — never counted in any pattern/sample-size figure,
      // rendered separately and clearly labeled (see generate-hub-pages.ts).
      const unclearOnIssue = classified.filter(
        (c) => c.issue === issueId && c.direction.axis === null,
      );
      const unclearEvidence: ReturnType<typeof evidenceEntry>[] = [];
      for (const c of unclearOnIssue) {
        const vote = c.positions[councillor.slug];
        if (vote === undefined) continue; // not on this motion's roster at all
        unclearEvidence.push(evidenceEntry(c, vote));
      }
      unclearEvidence.sort((a, b) => (a.date < b.date ? 1 : -1));

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
      //
      // Fixed 2026-08-31 (hub-recheck round-3 gate BLOCKER, P3): the
      // committee bucket had the SAME defect council motions used to have —
      // "not a member of that committee" was asserted for every committee
      // motion missing this councillor, with no check for whether they were
      // demonstrably on that committee's roster (voted on something else at
      // the SAME meeting). Confirmed false on Josh Morgan's page: he appears
      // in a vote-kind bucket on other PEC motions at meetings where he was
      // also reported "not a member" of PEC.
      //
      // Fixed 2026-08-31 (round-4 gate BLOCKER item 1): the P3 fix above
      // still only checked whether the councillor had a vote recorded on
      // SOME OTHER motion at the same meeting — a per-motion-vote-bucket
      // proxy for membership, not membership itself. That proxy is still
      // wrong whenever a genuine committee member simply cast no recorded
      // vote at all that meeting: it wrongly asserted "not a member" for 49
      // of the 662 cases (e.g. a member in remote_attendance who happened
      // to have no OTHER motion at that meeting either, or a member the
      // meeting's own `absent` field names as absent for the whole thing).
      // Membership is now read directly from the raw meeting record's own
      // roster fields (present / remote_attendance / absent — see
      // loadMeetingRoster) rather than inferred from vote buckets:
      //   - notOnRosterCommittee: councillor appears in NONE of that
      //     meeting's roster fields at all (present, remote_attendance,
      //     absent, or also_present) — real evidence of non-membership.
      //   - memberAbsentCommittee: the meeting's own `absent` field names
      //     them — a committee member, recorded absent for the whole
      //     meeting, so no individual vote exists on ANY of that meeting's
      //     motions (honest: "member, but absent that day", never "not a
      //     member").
      //   - notOnRosterCommitteeMeetingGap: they're in present or
      //     remote_attendance (a member who attended) but this specific
      //     motion's individual position wasn't captured — a genuine data
      //     gap for this one motion, not evidence of non-membership.
      let notOnRosterCommittee = 0;
      let memberAbsentCommittee = 0;
      let notOnRosterCommitteeMeetingGap = 0;
      let notOnRosterCouncilGap = 0;

      for (const c of directionBearing) {
        const vote = c.positions[councillor.slug];
        if (vote === undefined) {
          // not on the roster for this motion — not applicable, not absent
          if (c.motion.meetingType === "Council") {
            notOnRosterCouncilGap++;
          } else {
            const roster = loadMeetingRoster(c.motion.meetingSlug);
            if (roster?.absentMembers.has(councillor.canonicalName)) {
              memberAbsentCommittee++;
            } else if (roster?.members.has(councillor.canonicalName)) {
              notOnRosterCommitteeMeetingGap++;
            } else {
              notOnRosterCommittee++;
            }
          }
          continue;
        }

        const d = c.direction as Direction;
        const key = d.axis;
        let agg = axisMap.get(key);
        if (!agg) {
          agg = {
            axis: d.axis,
            axisLabels: d.axisLabels,
            yeaExpansive: 0,
            nayExpansive: 0,
            yeaRestrictive: 0,
            nayRestrictive: 0,
            recused: 0,
            absent: 0,
            abstain: 0,
            other: 0,
            evidence: [],
          };
          axisMap.set(key, agg);
        }

        if (vote === "yea" || vote === "nay") {
          if (d.valence === 1) {
            if (vote === "yea") agg.yeaExpansive++;
            else agg.nayExpansive++;
          } else {
            if (vote === "yea") agg.yeaRestrictive++;
            else agg.nayRestrictive++;
          }
        } else if (vote === "recuse") {
          agg.recused++;
        } else if (vote === "absent") {
          agg.absent++;
        } else if (vote === "abstain") {
          agg.abstain++;
        } else {
          agg.other++;
        }

        agg.evidence.push(evidenceEntry(c, vote));
      }

      if (axisMap.size === 0 && unclearEvidence.length === 0) continue;

      const axes = [...axisMap.values()]
        .sort((a, b) => {
          const bTotal =
            b.yeaExpansive + b.nayExpansive + b.yeaRestrictive + b.nayRestrictive;
          const aTotal =
            a.yeaExpansive + a.nayExpansive + a.yeaRestrictive + a.nayRestrictive;
          return bTotal - aTotal;
        })
        .map((agg) => {
          const sortedEvidence = agg.evidence.sort((a, b) =>
            a.date < b.date ? 1 : -1,
          );

          // Fixed 2026-08-31 (round-4 gate item 4, amendment-ladder
          // tallying): grouped same-day, same-subject motions (see
          // groupIntoDecisions — the same union-find grouping
          // distinctItemCount already uses) can carry a councillor's vote
          // in BOTH directions on this axis — e.g. a nay on the weaker,
          // conditional version of a restriction, then a yea on the
          // unconditional version of the same restriction minutes later at
          // the same meeting (5c6d802b2c95 nay / e3e298593604 yea,
          // Stevenson, 2024-11-05). That isn't two real positions on the
          // underlying question; it's one person picking between two
          // wordings of the same decision. Rolling the nay into "for" and
          // the yea into "against" would silently manufacture a split
          // record out of what was actually consistent support for
          // restricting. Any decision group where this councillor's yea/nay
          // votes point in more than one direction on this axis has ALL of
          // its votes excluded from the for/against tally (and from
          // distinctItemCount) — listed separately below the table instead,
          // never silently dropped.
          const voteRows = sortedEvidence
            .filter(
              (e) =>
                (e.theirVote === "yea" || e.theirVote === "nay") &&
                e.axisDirection !== null,
            )
            .map((e) => ({ ...e, axisDirection: e.axisDirection as "for" | "against" }));
          const groups = groupIntoDecisions(voteRows);
          const ladderExcludedMotionIds = new Set<string>();
          let consistentGroupCount = 0;
          let ladderGroupIndex = 0;
          const ladderExclusions: {
            decisionGroupIndex: number;
            motionId: string;
            date: string;
            meetingSlug: string;
            itemTitle: string;
            anchor: string | null;
            anchorAmbiguous: boolean;
            theirVote: string;
            axisDirection: "for" | "against";
          }[] = [];
          for (const group of groups) {
            const directions = new Set(
              group.map((i) => voteRows[i].axisDirection),
            );
            if (directions.size > 1) {
              for (const i of group) {
                const row = voteRows[i];
                ladderExcludedMotionIds.add(row.motionId);
                ladderExclusions.push({
                  decisionGroupIndex: ladderGroupIndex,
                  motionId: row.motionId,
                  date: row.date,
                  meetingSlug: row.meetingSlug,
                  itemTitle: row.itemTitle,
                  anchor: row.anchor,
                  anchorAmbiguous: row.anchorAmbiguous,
                  theirVote: row.theirVote,
                  axisDirection: row.axisDirection,
                });
              }
              ladderGroupIndex++;
            } else {
              consistentGroupCount++;
            }
          }
          ladderExclusions.sort((a, b) => (a.date < b.date ? 1 : -1));

          // Ladder-adjusted per-bucket counts, recomputed from theirVote +
          // axisDirection (excluded rows omitted) rather than trusted from
          // agg.yeaExpansive/etc., which were tallied inline before this
          // exclusion existed and would otherwise still count Stevenson's
          // two 5c6d802b2c95/e3e298593604 rows in both buildPattern's
          // sentence AND this axis's for/against — the whole point of the
          // exclusion is that neither should happen.
          let forCount = 0;
          let againstCount = 0;
          const adjusted = {
            yeaExpansive: 0,
            nayExpansive: 0,
            yeaRestrictive: 0,
            nayRestrictive: 0,
          };
          for (const row of voteRows) {
            if (ladderExcludedMotionIds.has(row.motionId)) continue;
            if (row.axisDirection === "for") forCount++;
            else againstCount++;
            if (row.theirVote === "yea" && row.axisDirection === "for")
              adjusted.yeaExpansive++;
            else if (row.theirVote === "nay" && row.axisDirection === "against")
              adjusted.nayExpansive++;
            else if (row.theirVote === "yea" && row.axisDirection === "against")
              adjusted.yeaRestrictive++;
            else adjusted.nayRestrictive++;
          }
          const sampleSize = forCount + againstCount;
          // Counted from yea/nay evidence ONLY (finding fixed 2026-08-31
          // alongside blocker 5): an absence or recusal isn't a "distinct
          // decision" this councillor weighed in on, so it shouldn't be
          // able to inflate distinctItemCount past the pattern floor for
          // someone who actually only cast a handful of real votes on this
          // axis (found via spot-check on the Mayor's downtown axis: 4 real
          // votes + 2 absences let distinctItemCount hit 6, keeping a
          // "n=4" pattern sentence alive that the floor was supposed to
          // suppress). Further collapsed to DECISION level (round-2 finding
          // B3, 2026-08-31, strengthened again 2026-08-31 round 3): see
          // groupIntoDecisions — a committee-stage and council-stage
          // vote on the same policy decision (same normalized item title OR
          // the same business-case number, within 60 days) now count as ONE
          // decision, not two, so the floor can no longer be cleared by a
          // single decision that happened to generate two recorded stages
          // under differently-worded titles.
          //
          // Fixed 2026-08-31 (round-4 gate item 4): a decision group whose
          // votes were excluded above for pointing in opposite directions
          // contributes NOTHING to the pattern floor either — those rows
          // aren't a real, single-direction decision this councillor's
          // count of "distinct decisions" should include.
          const distinctItemCount = consistentGroupCount;
          const presence = axisPolarityPresence.get(
            `${issueId}::${agg.axis}`,
          ) ?? { expansive: true, restrictive: true };
          // Fixed 2026-08-31 (round-4 gate item 6, render minor): the
          // details-summary below used to count "distinct agenda items" by
          // literal (meetingSlug, itemNumber) pairs — a DIFFERENT grouping
          // than distinctItemCount's decision-level union-find (same-day,
          // same-title-or-business-case-number rows merged). On j-morgan's
          // Policing axis those two counts disagreed right next to each
          // other on the page (prose: "4 distinct decisions"; details
          // summary: "5 distinct agenda items") even though every row was a
          // real yea/nay vote — not a mismatch in WHAT was counted, just
          // two different definitions of "distinct" printed side by side
          // with no explanation. Both now use the same decision grouping
          // (applied here to the FULL evidence array, including any
          // recusal/absence rows, so it still covers every row shown in the
          // table below, not just the yea/nay subset distinctItemCount
          // itself is restricted to).
          const evidenceDecisionCount = groupIntoDecisions(sortedEvidence).length;
          return {
            axis: agg.axis,
            axisLabels: agg.axisLabels,
            sampleSize,
            distinctItemCount,
            evidenceDecisionCount,
            for: forCount,
            against: againstCount,
            forPct: pct(forCount, sampleSize),
            recused: agg.recused,
            absent: agg.absent,
            abstain: agg.abstain,
            other: agg.other,
            pattern: buildPattern(
              { ...adjusted, recused: agg.recused, absent: agg.absent, axisLabels: agg.axisLabels },
              distinctItemCount,
              presence.expansive,
              presence.restrictive,
            ),
            ladderExclusions,
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
          // Round-4 gate item 4: a real, on-roster yea/nay vote excluded
          // from sampleSize/for/against for pointing in a different
          // direction than a same-decision sibling vote (see
          // ladderExclusions on each axis) is still a vote this councillor
          // actually cast — it must be counted somewhere in the "on
          // roster" total below, or the page's own arithmetic invariant
          // (divisionsInCorpus === overall.for + against + recused +
          // absent + abstain + other + notOnRoster) breaks the moment any
          // axis has an exclusion.
          ladderExcluded: acc.ladderExcluded + a.ladderExclusions.length,
        }),
        {
          sampleSize: 0,
          for: 0,
          against: 0,
          recused: 0,
          absent: 0,
          abstain: 0,
          other: 0,
          ladderExcluded: 0,
        },
      );

      const notOnRoster =
        notOnRosterCommittee +
        memberAbsentCommittee +
        notOnRosterCommitteeMeetingGap +
        notOnRosterCouncilGap;

      issuesOut[issueId] = {
        issueLabel: ISSUES[issueId].label,
        // Direction-bearing divided votes on this issue since 2023 (across
        // all councillors) — NOT the same as the issue's total divided-vote
        // count (see /election/issues), which also counts votes with no
        // clear direction. Kept as its own field, always paired with
        // notOnRoster in the rendered summary, so the arithmetic on the
        // page actually closes: directionBearing.length === overall.for +
        // overall.against + recused + absent + abstain + other +
        // overall.ladderExcluded + notOnRoster (see overall.ladderExcluded
        // above, added round-4 gate item 4).
        divisionsInCorpus: directionBearing.length,
        notOnRoster,
        // Split for honest wording (see the comments above the counters
        // above): committee non-membership vs. a member absent that whole
        // meeting vs. a same-meeting committee data gap vs. a Council-meeting
        // data gap — all four now derived from the raw meeting record's own
        // roster fields, not from per-motion vote buckets (round-4 gate
        // BLOCKER item 1).
        notOnRosterCommittee,
        memberAbsentCommittee,
        notOnRosterCommitteeMeetingGap,
        notOnRosterCouncilGap,
        overall,
        axes,
        // Unclear-direction motions on this issue this councillor actually
        // voted/recused/was absent on — see the comment above
        // unclearEvidence. Never included in divisionsInCorpus, overall, or
        // any axis's sampleSize; rendered separately.
        unclearCount: unclearEvidence.length,
        unclearEvidence,
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
      "Per councillor per issue per axis: 'for' = their vote aligned with the axis's expansive/permissive outcome, 'against' = aligned with its restrictive outcome — but the rendered pattern sentence never collapses a nay into the language of an enacted action (see movedTowardText/buildPattern in generate-stances.ts): a nay on an expansive motion is described as opposing that motion, never as having performed the restrictive act, and vice versa. When an axis's WHOLE corpus since 2023 only ever contains motions of one polarity, the pattern sentence says so plainly instead of reporting a silent '0' on the missing side. Axis and polarity for every motion come from data/election/classify/batch-*-verified.json (a per-motion classification independently verified against each motion's own complete text in the source meeting record), with a small, published corrections layer (data/election/classify/corrections.json) applied on top for specific defects found after verification — never a silent edit to the verified batches. This is a genuine translation of what the clause did, not raw yea/nay, on every axis including the generic 'approved/denied the item' fallback used when no issue-specific content axis applies. Recusals and absences are counted separately, never folded into 'against' and never inferred as a position. Below 5 DISTINCT DECISIONS on an axis (committee and council votes on the same policy decision, identified by matching agenda-item title or business-case number within 60 days, count as one decision — not one per meeting stage), no pattern sentence is asserted; the individual votes are still shown. Motions the classify pipeline confirmed but left with no clear direction (a referral, an informational ask, or a corrections.json downgrade) are listed per issue as 'unclear' evidence — never counted in any pattern or sample size, but not hidden either. A councillor with no entry for a motion was not on that meeting's roster — for a Council meeting (where all 15 members sit) it means the source data has a gap for that person on that motion; for a committee meeting, membership is read from the raw meeting record's own roster fields (present / remote_attendance / absent — never from per-motion vote buckets), and means one of: genuine non-membership (they appear in none of that meeting's roster fields), a member the meeting's own `absent` field names as absent for the whole meeting (no vote possible on anything that day), or a member who attended (present/remote_attendance) but this one motion's individual position wasn't captured — a data gap for that motion only (see notOnRosterCommittee vs. memberAbsentCommittee vs. notOnRosterCommitteeMeetingGap vs. notOnRosterCouncilGap on each issue). Motions whose own minuted result disagrees with its parsed vote arrays, or that the classify pipeline flagged not a genuine division, are excluded entirely before any of this — see result-mismatches.json, not-divided.json, and each councillor's resultMismatchesExcluding count.",
    councillors: councillorsOut,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "stances.json"),
    JSON.stringify(out, null, 2),
  );
}

main();
