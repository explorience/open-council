/**
 * Election Hub — shared methodology text
 *
 * Round-8 gate items 1-3: before this module existed, issues.json and
 * stances.json each carried their OWN hand-written "methodology" paragraph
 * (both built in generate-stances.ts, one per output file). They drifted:
 * stances.json's had already been de-jargoned for a voter audience
 * (round-7 gate items 1 and 4), issues.json's had not and still read like an
 * internal engineering note — file names, glob patterns, snake_case field
 * names, and the phrase "regex engine" all appeared in text a voter or
 * campaign staffer would actually read on a published issue page.
 *
 * Fixed by deleting the second paragraph rather than reconciling two: ONE
 * function here builds the complete plain-English methodology voters see,
 * covering both what issues.json needs (what counts as a "divided" vote,
 * and why) and what stances.json needs (how a "for"/"against" pattern is
 * computed) in a single paragraph, so the two files can never again publish
 * two different accounts of the same process. The three drop-count numbers
 * are the only thing that varies by call site, and even those are computed
 * once in generate-stances.ts's main() and passed to both writers — so in
 * practice both files get byte-identical text.
 *
 * Also drops, permanently, the "Window note" sentence about the 24 divided
 * motions from Nov-Dec 2022 that a prior draft published alongside a
 * "pending a decision" hedge (round-8 gate item 3). Whether to extend the
 * cutoff back to include them is an internal editorial question — it has no
 * bearing on what the CURRENT published window covers, so a voter reading
 * this methodology doesn't need to know that question is open. If that
 * decision is ever made, the fix is to change CUTOFF_DATE and regenerate;
 * until then, the fact that Nov-Dec 2022 motions exist in the classify data
 * but aren't published lives only in this comment and in the classify
 * pipeline's own internal records, never in anything voters read.
 *
 * Round-9 gate items 3, 4, 8:
 *  - item 3: formatDate() is the ONE place in this codebase that turns an
 *    ISO "YYYY-MM-DD" cutoff into voter-facing prose ("January 1, 2023").
 *    Every site that renders the cutoff — this module's own long
 *    methodology, generate-hub-pages.ts's landing-page byline, its per-issue
 *    "Methodology:" footer, and the issues-index page — imports it instead
 *    of interpolating the raw ISO string or hand-typing the English date a
 *    second time.
 *  - item 4: the landing page used to carry a THIRD, hand-written 385-
 *    character methodology blurb (jargon: "non-unanimous, non-procedural"),
 *    independent of both this module's long text and of each other. That
 *    blurb is gone; buildMethodologyShort() below is composed from the same
 *    DIVIDED_VOTE_DEFINITION / DIRECTION_SOURCING sentence constants
 *    buildMethodology() itself uses — one wording, never retyped a third
 *    time — just without the drop-count accounting paragraph a landing page
 *    doesn't need.
 *  - item 8: the drop-count sentence used to always name all three
 *    categories, so a zero count (e.g. "0 more where a motion's own written
 *    result didn't match its recorded yea/nay count") published a clause
 *    about a defect class that didn't currently have any members. Zero-count
 *    categories are now filtered out before the sentence is built, and the
 *    sentence itself (and its own "in N ways" lead-in) is omitted entirely
 *    when every category is zero.
 */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Round-9 gate item 3: the one formatter every voter-facing render of the
 * corpus cutoff date goes through — "2023-01-01" -> "January 1, 2023".
 * Deliberately narrow (no timezone handling, no Date object): the only
 * input this ever receives is a plain "YYYY-MM-DD" string like CUTOFF_DATE
 * in generate-stances.ts, and parsing it as a literal string instead of via
 * `new Date(iso)` sidesteps that constructor's UTC-midnight/local-timezone
 * footgun entirely — there's no timezone question for a plain calendar
 * date. */
export function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`formatDate: expected "YYYY-MM-DD", got ${JSON.stringify(isoDate)}`);
  }
  const [, year, month, day] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (!monthName) {
    throw new Error(`formatDate: month out of range in ${JSON.stringify(isoDate)}`);
  }
  return `${monthName} ${Number(day)}, ${year}`;
}

export interface MethodologyCounts {
  cutoffDate: string;
  rosterConflictCount: number;
  resultMismatchCount: number;
  notDividedCount: number;
}

/** The corpus's own definition of a "divided" vote — shared verbatim between
 * the long and short methodology text (round-9 gate item 4: a short variant
 * is DERIVED from this module's single source, never hand-typed a third
 * time). */
function dividedVoteDefinition(cutoffDate: string): string {
  return `A "divided" vote is any council or committee motion since ${formatDate(cutoffDate)} that wasn't approved unanimously and wasn't a routine procedural step, and it doesn't include a vote decided by secret ballot to fill an appointment, since those don't produce a recorded yea or nay by councillor.`;
}

/** How direction ("what a yea did") is sourced and verified — the other
 * sentence shared between the long and short methodology text. */
const DIRECTION_SOURCING =
  `Every motion's issue, axis, and direction ("what a yea did") come from an independent, motion-by-motion review, checked against that motion's own complete text in the official meeting record rather than a keyword search, with a small, separately published list of after-the-fact corrections applied on top — never a silent edit to the reviewed record.`;

/** Round-9 gate item 8: the three ways motions were dropped from the
 * divided-vote universe before classification, filtered to only the
 * categories that currently have at least one member, and joined into one
 * sentence (or omitted entirely when all three are zero) — never a "0 more
 * where ..." clause naming a defect class with nothing in it. */
function dropCountSentence(counts: MethodologyCounts): string {
  const categories = [
    {
      count: counts.rosterConflictCount,
      text: `where the same person was recorded as voting more than one way on the same motion (a roster conflict in the source data)`,
    },
    {
      count: counts.resultMismatchCount,
      text: `where a motion's own written result didn't match its recorded yea/nay count (a result mismatch)`,
    },
    {
      count: counts.notDividedCount,
      text: `that turned out, on review, not to be a genuine division at all — a lopsided result the source data's own "unanimous" marker missed, or the same motion recorded twice under two item numbers`,
    },
  ].filter((c) => c.count > 0);

  if (categories.length === 0) return "";

  const clauses = categories.map(
    (c, i) => `${c.count.toLocaleString()}${i > 0 ? " more" : ""} ${c.text}`,
  );
  const joined =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join("; ")}; and ${clauses[clauses.length - 1]}`;
  const wayWord = categories.length === 1 ? "one way" : `${categories.length} ways`;

  return ` Before any of the above, motions were also dropped in ${wayWord}, none of them guessed at or repaired: ${joined}.`;
}

export function buildMethodology(counts: MethodologyCounts): string {
  return `${dividedVoteDefinition(counts.cutoffDate)} For each councillor, on each issue, on each axis: a vote counts as "for" when it matched that axis's more permissive outcome, and "against" when it matched the more restrictive one — but a nay is never described as if it enacted the restrictive outcome; it's described as opposing the motion it was cast on, and the same care is taken in the other direction. When every recorded vote on an axis since ${formatDate(counts.cutoffDate)} happens to fall on one side, the pattern sentence says so plainly instead of silently reporting a zero on the other side. ${DIRECTION_SOURCING} This is a genuine reading of what each clause did, not a raw yea/nay count, including for the generic "approved or denied the item" description used when no issue-specific axis applies. Recusals and absences are always counted on their own, never folded into "against" and never treated as a hidden position. A pattern sentence is only stated once a councillor has at least 5 separate underlying decisions on an axis — a committee vote followed later by a council vote on the same policy question counts as one decision, not two, so a motion with several stages can't inflate the count; below that threshold the individual votes are still shown, just without a summary sentence. Some motions were reviewed and confirmed to have no clear direction at all — a referral, a request for more information, or a genuinely ambiguous clause — and these are listed, on every relevant issue, as motions with no clear direction: never counted in any pattern or sample size, but never hidden either. This project has no source recording which committee a councillor belongs to — that list isn't published or collected anywhere; a meeting's own attendance record shows who was there that day, not who belongs to it. So when a councillor has no recorded vote on a motion, nothing is claimed about why, in either direction: only whether that meeting's own record separately listed this councillor as present without a recorded vote, or whether nothing else can be said at all.${dropCountSentence(counts)} Each motion is filed under exactly one issue, so a motion that touches two topics — a housing decision with a budget line, say — appears on one issue page only, never both. Where the source text has a hash symbol immediately followed by a case or item number — as in a title reading "Business Case", then a hash, then "P-5" — this hub shows it instead as "Business Case No. P-5", so the character can't be misread as a link; the underlying wording is not otherwise changed.`;
}

/** Round-9 gate item 4: the landing page's own short methodology blurb,
 * derived from the same two sentence constants buildMethodology() uses
 * above (the "divided" vote definition and how direction is sourced) — not
 * a third hand-written variant. Plain English throughout: no "non-unanimous,
 * non-procedural" jargon, no raw ISO date. */
export function buildMethodologyShort(cutoffDate: string): string {
  return `${dividedVoteDefinition(cutoffDate)} ${DIRECTION_SOURCING} See the [issues page](/election/issues) for the exact counts and the unclassified/unclear disclosure.`;
}
