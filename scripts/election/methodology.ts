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
 */

export interface MethodologyCounts {
  rosterConflictCount: number;
  resultMismatchCount: number;
  notDividedCount: number;
}

export function buildMethodology(counts: MethodologyCounts): string {
  const { rosterConflictCount, resultMismatchCount, notDividedCount } =
    counts;

  return `A "divided" vote is any council or committee motion since January 1, 2023 that wasn't approved unanimously and wasn't a routine procedural step, and it doesn't include a vote decided by secret ballot to fill an appointment, since those don't produce a recorded yea or nay by councillor. For each councillor, on each issue, on each axis: a vote counts as "for" when it matched that axis's more permissive outcome, and "against" when it matched the more restrictive one — but a nay is never described as if it enacted the restrictive outcome; it's described as opposing the motion it was cast on, and the same care is taken in the other direction. When every recorded vote on an axis since 2023 happens to fall on one side, the pattern sentence says so plainly instead of silently reporting a zero on the other side. Every motion's issue, axis, and direction ("what a yea did") come from an independent, motion-by-motion review, checked against that motion's own complete text in the official meeting record rather than a keyword search, with a small, separately published list of after-the-fact corrections applied on top — never a silent edit to the reviewed record. This is a genuine reading of what each clause did, not a raw yea/nay count, including for the generic "approved or denied the item" description used when no issue-specific axis applies. Recusals and absences are always counted on their own, never folded into "against" and never treated as a hidden position. A pattern sentence is only stated once a councillor has at least 5 separate underlying decisions on an axis — a committee vote followed later by a council vote on the same policy question counts as one decision, not two, so a motion with several stages can't inflate the count; below that threshold the individual votes are still shown, just without a summary sentence. Some motions were reviewed and confirmed to have no clear direction at all — a referral, a request for more information, or a genuinely ambiguous clause — and these are listed, on every relevant issue, as motions with no clear direction: never counted in any pattern or sample size, but never hidden either. This project has no source recording which committee a councillor belongs to — that list isn't published or collected anywhere; a meeting's own attendance record shows who was there that day, not who belongs to it. So when a councillor has no recorded vote on a motion, nothing is claimed about why, in either direction: only whether that meeting's own record separately listed this councillor as present without a recorded vote, or whether nothing else can be said at all. Before any of the above, motions were also dropped in three ways, none of them guessed at or repaired: ${rosterConflictCount.toLocaleString()} where the same person was recorded as voting more than one way on the same motion (a roster conflict in the source data); ${resultMismatchCount.toLocaleString()} more where a motion's own written result didn't match its recorded yea/nay count (a result mismatch); and ${notDividedCount.toLocaleString()} more that turned out, on review, not to be a genuine division at all — a lopsided result the source data's own "unanimous" marker missed, or the same motion recorded twice under two item numbers. Each motion is filed under exactly one issue, so a motion that touches two topics — a housing decision with a budget line, say — appears on one issue page only, never both. Where the source text has a hash symbol immediately followed by a case or item number — as in a title reading "Business Case", then a hash, then "P-5" — this hub shows it instead as "Business Case No. P-5", so the character can't be misread as a link; the underlying wording is not otherwise changed.`;
}
