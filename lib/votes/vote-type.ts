/**
 * Vote type classification
 *
 * London City Council roll-call vote rows come from eScribe with a raw
 * label string (e.g. "Yeas:", "Nays:", "Absent:", "Recuse:", "Abstain(0.00",
 * "Conflict"). This module maps that raw label to a normalized VoteType.
 *
 * BUG FIX (2026-08): The original classifier only recognized "yea" and
 * "nay" and silently bucketed EVERYTHING else — including genuine
 * "Recuse:" (pecuniary-interest recusal), "Abstain" and "Conflict" rows,
 * plus assorted scraper noise (stray first names, "Councillor", page
 * numbers) — as "absent". A councillor who declared a conflict of
 * interest and legally stepped out of a vote was therefore indistinguishable
 * from a councillor who simply didn't show up. See scripts/generate-votes.ts
 * for where this is applied to raw meeting data.
 *
 * Recusing for a declared pecuniary interest is an ethical/legal act, not
 * a no-show, so it must never be counted as "absent". Anything we can't
 * confidently classify is preserved as "other" so it stays *visible*
 * instead of silently disappearing into the absence count.
 */

export type VoteType = "yea" | "nay" | "absent" | "recuse" | "abstain" | "other"

/**
 * Vote types that represent the councillor actually taking a yes/no
 * position on the motion. Used by downstream stats (participation rate,
 * alignment, dissent) to distinguish "voted" from "did not vote" for any
 * reason (absent, recused, abstained, or unrecognized).
 */
export const PARTICIPATING_VOTE_TYPES: ReadonlySet<VoteType> = new Set<VoteType>(["yea", "nay"])

export function isParticipatingVote(voteType: VoteType): boolean {
  return PARTICIPATING_VOTE_TYPES.has(voteType)
}

/**
 * Classify a raw eScribe vote-row label into a normalized VoteType.
 *
 * Handles real observed variants:
 *   "Yeas:", "Nays:", "Absent:", "Absent", "Absent(0.00", "Absent(7.14"
 *   "Recuse:"
 *   "Conflict" (declared conflict of interest; in practice always paired
 *     with voters: ["None"], but classified the same as "recuse" in case
 *     that ever changes)
 *   "Abstain(0.00" (and bare "Abstain")
 *
 * Anything else (stray scraper noise like a lone first name, "Councillor",
 * "1.", etc.) is classified as "other" rather than silently folded into
 * "absent".
 */
export function classifyVoteType(rawLabel: string | null | undefined): VoteType {
  const label = (rawLabel ?? "").trim().toLowerCase()

  if (label.includes("yea")) return "yea"
  if (label.includes("nay")) return "nay"
  if (label.startsWith("recuse")) return "recuse"
  if (label.startsWith("conflict")) return "recuse"
  if (label.startsWith("abstain")) return "abstain"
  if (label.startsWith("absent")) return "absent"

  return "other"
}

/**
 * Marker appended to a VoteRecord's `motionText` by scripts/generate-votes.ts when the
 * source text had to be cut off at the length cap. Chatbot-facing formatting
 * (server/vote-lookup.ts) checks for this marker so it never tells the LLM a truncated
 * excerpt is the "Full Motion Text" - a truncated mid-sentence fragment mislabeled as
 * complete is exactly the kind of confidently-wrong context that produces bad answers.
 */
export const MOTION_TEXT_TRUNCATION_MARKER = " […motion text truncated]"

/** True if a stored motionText was cut off (carries the truncation marker). */
export function isMotionTextTruncated(motionText: string | undefined | null): boolean {
  return !!motionText && motionText.endsWith(MOTION_TEXT_TRUNCATION_MARKER)
}

/** Human-readable label for a VoteType, used in chatbot-facing text. */
export function voteTypeLabel(voteType: VoteType): string {
  switch (voteType) {
    case "yea":
      return "IN FAVOR (YEA)"
    case "nay":
      return "AGAINST (NAY)"
    case "absent":
      return "ABSENT"
    case "recuse":
      return "RECUSED (declared a conflict of interest)"
    case "abstain":
      return "ABSTAINED"
    case "other":
      return "UNRECORDED (raw vote label not recognized)"
  }
}
