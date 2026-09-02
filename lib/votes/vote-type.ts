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

/**
 * The OLD hard truncation length (pre-fix) that scripts/generate-votes.ts used before
 * MAX_MOTION_TEXT_LENGTH was raised to 2000 and truncated text started getting the
 * marker above appended. The ~199k records already committed under data/votes/*.json
 * were generated under that old 500-char cap and were never retroactively marked -
 * regenerating that 160MB, git-committed, nightly-job-owned dataset is out of scope for
 * this fix (the nightly scrape will produce marked records going forward). Without this
 * legacy heuristic, isMotionTextTruncated()/motionTextLabel() would call every one of
 * those ~29k truncated records "Full Motion Text" even though they are cut off mid
 * sentence - exactly the mislabeling this module exists to prevent. A short, deliberately
 * short motion happening to land at exactly 500 chars would be a rare false positive
 * (mislabeled as "may be cut off" when it's actually complete) - a far safer failure mode
 * than the reverse.
 */
const LEGACY_UNMARKED_TRUNCATION_LENGTH = 500

/**
 * True if a stored motionText was cut off - either the new explicit marker (records
 * generated after this fix) or the old hard cap with no marker (records generated
 * before it - see LEGACY_UNMARKED_TRUNCATION_LENGTH).
 */
export function isMotionTextTruncated(motionText: string | undefined | null): boolean {
  if (!motionText) return false
  if (motionText.endsWith(MOTION_TEXT_TRUNCATION_MARKER)) return true
  return motionText.length === LEGACY_UNMARKED_TRUNCATION_LENGTH
}

/**
 * Does this roll call have recorded, attributable dissent - "at least one
 * resolvable Nay for this motion"? THE shared signal (issue #199 final
 * verify, punch list item 2): generate-votes.ts and generate-stats.ts
 * each need this, from different-shaped data, and must reach the SAME
 * boolean for the same roll call or their published motion counts
 * diverge.
 *
 * generate-votes.ts already computes it directly from the aggregated
 * per-motion voter lists (`motion.nays.length > 0`) - it has the real
 * list, so it doesn't call this helper. generate-stats.ts only has one
 * councillor's own VoteRecord (unanimous/unanimousSource), not the full
 * per-motion nays list, so it calls this to derive the identical answer
 * from those two fields:
 *
 *   - `unanimousSource: "tally"` (2018+, or any record with a machine-
 *     readable "(N to M)" result): the tally IS the nay count, so
 *     `!unanimous` <=> `nays.length > 0` exactly - no approximation.
 *   - `unanimousSource: "votes"` (pre-2018 only): by construction this is
 *     set exactly when a resolvable Nay was found (see generate-votes.ts's
 *     parseResult()), so it already means `nays.length > 0`.
 *   - `unanimousSource: "unresolved"` or `"unknown"`: NOT confirmed,
 *     attributable dissent (either the row was demoted as garbled/
 *     unresolvable text, or there's no dissent signal at all) - `false`
 *     either way, even though `unanimous` is `false` for "unresolved".
 *
 * Before this shared helper, generate-stats.ts passed
 * `unanimousSource === "votes"` alone - correct for pre-2018 but NEVER
 * true for a 2018+ eSCRIBE record (whose unanimousSource is always
 * "tally"), which silently classified every genuinely divided 2018+
 * motion whose text also matched a boilerplate pattern (first/second/
 * third reading, consent items, closed session, "be received") as
 * procedural - 1,046 motions, 2018-2026, that data/votes correctly called
 * substantive.
 */
export function hasRecordedDissent(
  unanimousSource: "tally" | "votes" | "unresolved" | "unknown" | undefined,
  unanimous: boolean
): boolean {
  if (unanimousSource === "votes") return true
  if (unanimousSource === "tally") return !unanimous
  return false
}

/**
 * Check if a motion is procedural (routine/administrative) vs substantive.
 *
 * `hasResolvableDissent` gates the whole check: a motion with a recorded,
 * resolvable Nay voter is never procedural, no matter what its text
 * matches. Compound substantive motions routinely contain a clause like
 * "...be received" alongside real, contested content (68/51/71 genuinely
 * divided motions were wrongly excluded this way in 2019/2020/2021 - see
 * issue #199 d4); recorded dissent is decisive evidence the motion was
 * substantive.
 *
 * SINGLE SOURCE OF TRUTH (issue #199 punch list item 2): scripts/generate-
 * votes.ts and scripts/generate-stats.ts each carried their own copy of
 * this function, textually identical but fed a DIFFERENT
 * `hasResolvableDissent` argument at their respective call sites - see
 * hasRecordedDissent() above for the shared signal generate-stats.ts now
 * passes, and generate-votes.ts's `motion.nays.length > 0` for the
 * equivalent it computes directly from the full per-motion nays list.
 */
export function isProcedural(motionText: string | undefined, hasResolvableDissent: boolean): boolean {
  if (hasResolvableDissent) return false
  if (!motionText) return false
  const text = motionText.toLowerCase()
  return (
    /be received/i.test(text) ||
    /be noted/i.test(text) ||
    /minutes.*be approved/i.test(text) ||
    /be adjourned/i.test(text) ||
    /closed session/i.test(text) ||
    /public participation meeting/i.test(text) ||
    /first reading|second reading|third reading/i.test(text) ||
    /consent items/i.test(text)
  )
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
