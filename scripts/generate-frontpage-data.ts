/**
 * Front Page v3 — division wall data generator
 *
 * Reads data/votes/_all-motions.json (every motion the site has scraped)
 * and data/election/issues.json (the Election Hub's per-issue vote
 * clusters), and writes data/frontpage/division-wall.json: one compact
 * record per "divided" vote (not procedural, not unanimous, and — per the
 * round-3 fixer, matching generate-stances.ts's own guards and
 * methodology.ts's published definition of "divided" — not a one-sided
 * tally, not a roster-conflict motion, not a secret-ballot appointment
 * ballot) since the site's established election-coverage cutoff, sorted
 * chronologically ascending.
 *
 * Cutoff: 2023-01-01, the same CUTOFF_DATE constant generate-stances.ts
 * uses (and issues.json's own `cutoffDate` field) — not the full 2011+
 * scrape range. Two independent reasons this is the right "coverage
 * start" for this feature, not just a convenience match to an existing
 * constant: (1) it's the boundary the rest of the election-coverage
 * surface (Election Hub, issue pages, councillor stance pages) already
 * uses, so "divided vote" means the same thing everywhere on the site;
 * (2) it lands well inside the wall's stated 600–2,000 cell performance
 * envelope — the full-history count (5,170+ divided votes back to 2011)
 * does not. (Record count is computed at build time and logged below —
 * not hand-typed here, since a comment claiming a specific figure is
 * exactly the kind of second source of truth that drifts.)
 *
 * Output shape: { cutoffDate, recordCount, records }, where
 * each record is a 7-tuple (matches the approved prototype's compact
 * tuple contract — see design/frontpage-v3-spec.md's "Data contract" —
 * extended by one field, `url`, because this is a real site: every cell
 * and every closest-20 row must link through to the real evidence, per
 * standing review-pages-link-the-evidence practice; the prototype's fake
 * data had nothing to link to):
 *
 *   [dateYYYYMMDD, yea, nay, passed(0|1), title(<=80 chars), issueSlug, url]
 *
 * `passed` is always recomputed as (yea > nay) — a tie always fails — and
 * is never taken from the source motion's own `passed`/`result` field if
 * that disagrees, per the spec's explicit derivation rule.
 *
 * `issueSlug` is looked up by motion id in issues.json's eight known
 * clusters (housing/budget/encampments/transit/climate/downtown/
 * policing/bikes); a motion issues.json didn't classify (most of them —
 * issues.json only tags directionBearing votes on its own axes, not
 * every divided vote) gets "other" rather than being dropped or guessed
 * at classified.
 *
 * `url` is the real evidence link: scripts/election/anchors.ts's
 * motionAnchor() resolves to the specific heading on the real meeting
 * page when one can be identified, falling back to the bare meeting page
 * (never a dead link, never a guess at an ambiguous heading — same
 * behavior the Election Hub's own evidence links already rely on).
 *
 * Does NOT store wallCount, the "N decided by two votes or fewer" count,
 * or the closest-20 rows — those are trivially derivable from `records`
 * at template-render time (see quartz/components/util/divisionWall.ts),
 * and a second stored copy of a derivable count is exactly the kind of
 * drift risk the spec calls out by name.
 *
 * Deterministic and idempotent: same input files in, byte-identical
 * output out (motions are read in their existing source order and sorted
 * by date string, JSON.stringify has no non-determinism here). This is
 * why the output has no `generatedAt` timestamp field: a wall-clock
 * value would make the file non-byte-identical across two runs over the
 * same input by definition, silently contradicting this very claim and
 * dirtying this git-tracked file on every build for no informational
 * gain (nothing reads it — see FrontpageWall.tsx's loadWallData). Build
 * provenance belongs in the console log line below, not the tracked
 * data file.
 *
 * Usage: npx tsx scripts/generate-frontpage-data.ts
 */

import fs from "fs/promises";
import path from "path";
import { motionAnchor } from "./election/anchors.js";
import { slugifyFilePath } from "../quartz/util/path.js";
import type { FilePath } from "../quartz/util/path.js";

const REPO_ROOT = process.cwd();
const MOTIONS_PATH = path.join(REPO_ROOT, "data/votes/_all-motions.json");
const ISSUES_PATH = path.join(REPO_ROOT, "data/election/issues.json");
const OUT_PATH = path.join(REPO_ROOT, "data/frontpage/division-wall.json");

// Same convention as generate-stances.ts's CUTOFF_DATE and issues.json's
// own cutoffDate field — see module doc above for why this, not the full
// scrape range, is "the site's coverage start" for this feature.
const CUTOFF_DATE = "2023-01-01";

const KNOWN_ISSUES = [
  "housing",
  "budget",
  "encampments",
  "transit",
  "climate",
  "downtown",
  "policing",
  "bikes",
] as const;
type KnownIssueSlug = (typeof KNOWN_ISSUES)[number];
type IssueSlug = KnownIssueSlug | "other";

interface Motion {
  id: string;
  date: string;
  meetingSlug: string;
  itemNumber: string;
  itemTitle: string;
  result: string;
  procedural?: boolean;
  unanimous?: boolean;
  yeas: string[];
  nays: string[];
  absent: string[];
  recuse: string[];
  abstain: string[];
  other: string[];
}

/**
 * Round-3 fixer (integrity, BLOCKING): the divided-vote filter below used to
 * be only `!procedural && !unanimous && date>=cutoff` — three guards short of
 * generate-stances.ts's own definition of a genuine division (see that
 * file's isOneSidedTally/hasRosterConflict/isAppointmentBallot and
 * methodology.ts's dividedVoteDefinition, which explicitly excludes "a vote
 * decided by secret ballot to fill an appointment"). Concretely this let 70
 * of 1,803 wall cells (3.9%) through: 26 secret-ballot committee-appointment
 * "Majority Winner" picks (0 recorded yeas/nays), 31 roster-conflict
 * motions, and 13 one-sided tallies — none of them a genuine division.
 * Ported here verbatim (same logic, same field shapes) rather than imported,
 * since generate-stances.ts's RawMotion/guard functions aren't exported for
 * reuse and this generator has its own narrower Motion type.
 */

/** Same as generate-stances.ts's isOneSidedTally: a genuine division needs
 * votes recorded on BOTH sides. */
function isOneSidedTally(m: Motion): boolean {
  return m.yeas.length === 0 || m.nays.length === 0;
}

/** Same as generate-stances.ts's hasRosterConflict: the same person named in
 * more than one vote-kind bucket is a data-entry conflict, not a real
 * position — drop the motion rather than let a bucket silently win. */
function hasRosterConflict(m: Motion): boolean {
  const seen = new Set<string>();
  for (const bucket of [m.yeas, m.nays, m.recuse, m.absent, m.abstain, m.other]) {
    for (const name of bucket) {
      if (seen.has(name)) return true;
      seen.add(name);
    }
  }
  return false;
}

/** Same as generate-stances.ts's isAppointmentBallot: a secret-ballot
 * "Majority Winner: ..." appointment round, not a divided policy decision —
 * per methodology.ts's published definition of "divided". */
function isAppointmentBallot(m: Motion): boolean {
  return /^Majority Winner\b/i.test(m.result);
}

/** Same as generate-stances.ts's extractResultTally: parse the "(N to M)"
 * tally out of a motion's own result string. */
function extractResultTally(resultText: string): { yea: number; nay: number } | null {
  const m = resultText.match(/\((\d+)\s*(?:to|[-–—])\s*(\d+)\)/i);
  return m ? { yea: Number(m[1]), nay: Number(m[2]) } : null;
}

/** Same as generate-stances.ts's isSupermajorityFailure: the motion's own
 * minuted tally and its parsed yeas/nays arrays fully agree, but it Failed
 * despite a yea majority — the shape of a genuine supermajority requirement,
 * not a data error. Without this carve-out the wall's blind `yea>nay`
 * derivation shows "Passed" on the tooltip for a motion whose official
 * result is "Motion Failed" — a real, confirmed factual error on 3 records
 * (15e2e6266aa2, 7384547749fb, 797a57bae40a). */
function isSupermajorityFailure(m: Motion): boolean {
  const tally = extractResultTally(m.result);
  if (!tally) return false;
  if (tally.yea !== m.yeas.length || tally.nay !== m.nays.length) return false;
  return /^Motion\s+Failed/i.test(m.result) && m.yeas.length > m.nays.length;
}

interface MotionsFile {
  motions: Motion[];
}

interface IssuesFile {
  issues: Record<KnownIssueSlug, { votes: { id: string }[] }>;
}

// 6-tuple-plus-url record — see module doc for the shape and why it's a
// tuple, not an object (payload size, matches the prototype's contract).
export type DivisionWallRecord = [
  date: string,
  yea: number,
  nay: number,
  passed: 0 | 1,
  title: string,
  issue: IssueSlug,
  url: string,
];

/**
 * motionAnchor()/generate-hub-pages.ts produce evidence URLs built from the
 * RAW meetingSlug (spaces and all) — the convention every markdown-embedded
 * evidence link on this site follows, because Quartz's CrawlLinks
 * transformer slugifies those paths automatically while processing
 * markdown. A TSX component's raw `href` never passes through that
 * transformer, so the division-wall data (consumed directly by a TSX
 * component and its client script, not by markdown) must carry the
 * already-slugified path. Uses Quartz's own slugifyFilePath — the same
 * function that produces the real output paths — rather than
 * reimplementing the transform a second time.
 */
function slugifyEvidenceUrl(rawUrl: string): string {
  const [rawPath, fragment] = rawUrl.split("#");
  const slug = slugifyFilePath(rawPath.replace(/^\//, "") as FilePath);
  return fragment ? `/${slug}#${fragment}` : `/${slug}`;
}

function truncateTitle(raw: string): string {
  const t = (raw ?? "").trim();
  // Hard cut, no ellipsis — per spec.
  return t.length <= 80 ? t : t.slice(0, 80);
}

async function main() {
  const [motionsRaw, issuesRaw] = await Promise.all([
    fs.readFile(MOTIONS_PATH, "utf-8"),
    fs.readFile(ISSUES_PATH, "utf-8"),
  ]);
  const motionsFile: MotionsFile = JSON.parse(motionsRaw);
  const issuesFile: IssuesFile = JSON.parse(issuesRaw);

  // motion id -> issue slug, first cluster that claims a given id wins
  // (in practice each divided-vote id appears in at most one cluster).
  const issueByMotionId = new Map<string, KnownIssueSlug>();
  for (const slug of KNOWN_ISSUES) {
    const bucket = issuesFile.issues[slug];
    if (!bucket) continue;
    for (const v of bucket.votes) {
      if (!issueByMotionId.has(v.id)) issueByMotionId.set(v.id, slug);
    }
  }

  const divided = motionsFile.motions.filter(
    (m) =>
      !m.procedural &&
      !m.unanimous &&
      m.date >= CUTOFF_DATE &&
      !isOneSidedTally(m) &&
      !hasRosterConflict(m) &&
      !isAppointmentBallot(m),
  );

  const withSortKey = divided.map((m) => {
    const yea = m.yeas.length;
    const nay = m.nays.length;
    // `passed` is yea>nay by default (per spec: recomputed, never trusted
    // from source) EXCEPT for a confirmed supermajority failure, where the
    // motion's own minuted result and vote arrays fully agree that it
    // Failed despite a yea majority — a governance-rule outcome, not a data
    // disagreement, so recomputing blind here would publish a factual error
    // (see isSupermajorityFailure doc above).
    const passed: 0 | 1 = isSupermajorityFailure(m) ? 0 : yea > nay ? 1 : 0;
    const anchor = motionAnchor(m.meetingSlug, m.itemNumber, m.result);
    const rawUrl = anchor?.url ?? `/${m.meetingSlug}`;
    const url = slugifyEvidenceUrl(rawUrl);
    const record: DivisionWallRecord = [
      m.date.replace(/-/g, ""),
      yea,
      nay,
      passed,
      truncateTitle(m.itemTitle),
      issueByMotionId.get(m.id) ?? "other",
      url,
    ];
    return { sortDate: m.date, record };
  });

  withSortKey.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  const records = withSortKey.map((r) => r.record);

  const output = {
    cutoffDate: CUTOFF_DATE,
    recordCount: records.length,
    records,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(output));
  console.log(
    `Wrote ${records.length} division-wall records (since ${CUTOFF_DATE}) -> ` +
      `${path.relative(REPO_ROOT, OUT_PATH)} at ${new Date().toISOString()}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
