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

import fs from "fs"
import path from "path"
import { loadRegistry } from "../../lib/councillors/registry.js"
import { classifyIssue, ISSUE_ORDER, ISSUES, type IssueId } from "./issue-rules.js"
import { deriveDirection, type Direction } from "./direction-rules.js"
import { motionAnchor } from "./anchors.js"

const CUTOFF_DATE = "2023-01-01"
const REPO_ROOT = path.join(process.cwd())
const MOTIONS_PATH = path.join(REPO_ROOT, "data/votes/_all-motions.json")
const OUT_DIR = path.join(REPO_ROOT, "data/election")

type VoteKind = "yea" | "nay" | "recuse" | "absent" | "abstain" | "other"

interface RawMotion {
  id: string
  date: string
  meetingSlug: string
  meetingTitle: string
  meetingType: string
  meetingUrl: string
  itemNumber: string
  itemTitle: string
  motionText: string
  result: string
  passed: boolean
  unanimous: boolean
  procedural: boolean
  yeas: string[]
  nays: string[]
  absent: string[]
  recuse: string[]
  abstain: string[]
  other: string[]
  margin: number
}

interface AllMotionsFile {
  generatedAt: string
  sourceHash: string
  totalMotions: number
  substantiveMotions: number
  contestedMotions: number
  motions: RawMotion[]
}

// ---------------------------------------------------------------------------
// Councillor lookup: displayName (as it appears in yeas/nays/etc arrays) ->
// { slug, canonicalName, displayName, ward, role, isCurrent }
// ---------------------------------------------------------------------------

interface CouncillorMeta {
  canonicalName: string
  slug: string
  displayName: string
  ward?: number
  role: string
  isCurrent: boolean
}

function buildCouncillorLookup(): Map<string, CouncillorMeta> {
  const registry = loadRegistry()
  const byDisplayName = new Map<string, CouncillorMeta>()

  for (const [canonicalName, info] of Object.entries(registry)) {
    const currentTerm = info.terms.find((t) => t.end >= 2026)
    const latestTerm = info.terms[info.terms.length - 1]
    const term = currentTerm ?? latestTerm
    byDisplayName.set(info.displayName, {
      canonicalName,
      slug: info.slug,
      displayName: info.displayName,
      ward: term.ward,
      role: term.role,
      isCurrent: Boolean(currentTerm),
    })
  }

  return byDisplayName
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
  }
}

function positionsOf(m: RawMotion, lookup: Map<string, CouncillorMeta>): Record<string, VoteKind> {
  const positions: Record<string, VoteKind> = {}
  const assign = (names: string[], kind: VoteKind) => {
    for (const name of names) {
      const meta = lookup.get(name)
      const key = meta?.slug ?? name
      positions[key] = kind
    }
  }
  assign(m.yeas, "yea")
  assign(m.nays, "nay")
  assign(m.recuse, "recuse")
  assign(m.absent, "absent")
  assign(m.abstain, "abstain")
  assign(m.other, "other")
  return positions
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ClassifiedMotion {
  motion: RawMotion
  issue: IssueId
  matchedKeywords: string[]
  direction: Direction | { axis: null; label: "unclear" }
  tally: ReturnType<typeof tallyOf>
  positions: Record<string, VoteKind>
  anchor: string | null
}

function main() {
  const allMotionsRaw: AllMotionsFile = JSON.parse(fs.readFileSync(MOTIONS_PATH, "utf-8"))
  const lookup = buildCouncillorLookup()

  const divided = allMotionsRaw.motions.filter(
    (m) => !m.procedural && !m.unanimous && m.date >= CUTOFF_DATE
  )

  const classified: ClassifiedMotion[] = []
  const unclassifiedSample: { id: string; date: string; itemNumber: string; itemTitle: string }[] = []
  let unclassifiedCount = 0

  for (const motion of divided) {
    const result = classifyIssue(motion.itemTitle, motion.motionText)
    if (!result) {
      unclassifiedCount++
      if (unclassifiedSample.length < 40) {
        unclassifiedSample.push({
          id: motion.id,
          date: motion.date,
          itemNumber: motion.itemNumber,
          itemTitle: motion.itemTitle,
        })
      }
      continue
    }

    const direction = deriveDirection(result.issue, motion.motionText)
    const anchor = motionAnchor(motion.meetingSlug, motion.itemNumber)

    classified.push({
      motion,
      issue: result.issue,
      matchedKeywords: result.matchedKeywords,
      direction,
      tally: tallyOf(motion),
      positions: positionsOf(motion, lookup),
      anchor,
    })
  }

  writeIssuesFile(allMotionsRaw, classified, unclassifiedCount, unclassifiedSample)
  writeStancesFile(allMotionsRaw, classified, lookup)

  console.log(`Divided motions since ${CUTOFF_DATE}: ${divided.length}`)
  console.log(`Classified: ${classified.length}  Unclassified: ${unclassifiedCount}`)
  const directionBearing = classified.filter((c) => c.direction.axis !== null).length
  console.log(`Direction-bearing (used in stance aggregation): ${directionBearing}`)
  for (const issueId of ISSUE_ORDER) {
    const forIssue = classified.filter((c) => c.issue === issueId)
    const bearing = forIssue.filter((c) => c.direction.axis !== null)
    console.log(`  ${issueId.padEnd(12)} classified=${forIssue.length}  direction-bearing=${bearing.length}`)
  }
}

function evidenceEntry(c: ClassifiedMotion, theirVote: VoteKind | "n/a") {
  const m = c.motion
  return {
    motionId: m.id,
    date: m.date,
    meetingSlug: m.meetingSlug,
    meetingTitle: m.meetingTitle,
    meetingType: m.meetingType,
    meetingUrl: m.meetingUrl,
    itemNumber: m.itemNumber,
    itemTitle: m.itemTitle,
    anchor: c.anchor,
    result: m.result,
    tally: `${c.tally.yea}-${c.tally.nay}`,
    theirVote,
  }
}

function writeIssuesFile(
  allMotionsRaw: AllMotionsFile,
  classified: ClassifiedMotion[],
  unclassifiedCount: number,
  unclassifiedSample: { id: string; date: string; itemNumber: string; itemTitle: string }[]
) {
  const issues: Record<string, unknown> = {}

  for (const issueId of ISSUE_ORDER) {
    const forIssue = classified.filter((c) => c.issue === issueId)
    const directionBearing = forIssue.filter((c) => c.direction.axis !== null)

    issues[issueId] = {
      label: ISSUES[issueId].label,
      dividedVoteCount: forIssue.length,
      directionBearingVoteCount: directionBearing.length,
      votes: forIssue
        .sort((a, b) => (a.motion.date < b.motion.date ? 1 : -1))
        .map((c) => {
          const m = c.motion
          const motionText = m.motionText.length > 600 ? m.motionText.slice(0, 597) + "..." : m.motionText
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
          }
        }),
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    sourceHash: allMotionsRaw.sourceHash,
    sourceGeneratedAt: allMotionsRaw.generatedAt,
    cutoffDate: CUTOFF_DATE,
    methodology:
      "Divided = non-unanimous, non-procedural motion, 2023-01-01 onward. Classified via scripts/election/issue-rules.ts. Direction ('what a yea did') derived via scripts/election/direction-rules.ts; motions with direction 'unclear' are listed here but excluded from stance aggregation in stances.json.",
    issues,
    unclassified: {
      count: unclassifiedCount,
      note: "Divided motions since 2023 that matched no issue's keyword rules (or matched a GLOBAL_EXCLUDE governance/procedure phrase). Listed, never force-fit into a cluster.",
      sample: unclassifiedSample,
    },
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, "issues.json"), JSON.stringify(out, null, 2))
}

interface AxisAgg {
  axis: string
  axisLabels: { expansive: string; restrictive: string }
  forCount: number // aligned with the axis's expansive outcome
  againstCount: number // aligned with the axis's restrictive outcome
  recused: number
  absent: number
  abstain: number
  other: number
  evidence: ReturnType<typeof evidenceEntry>[]
}

function pct(n: number, d: number): string {
  return d === 0 ? "0" : Math.round((n / d) * 100).toString()
}

function writeStancesFile(
  allMotionsRaw: AllMotionsFile,
  classified: ClassifiedMotion[],
  lookup: Map<string, CouncillorMeta>
) {
  const currentCouncillors = [...lookup.values()].filter((c) => c.isCurrent)

  const councillorsOut: Record<string, unknown> = {}

  for (const councillor of currentCouncillors) {
    const issuesOut: Record<string, unknown> = {}

    for (const issueId of ISSUE_ORDER) {
      const directionBearing = classified.filter((c) => c.issue === issueId && c.direction.axis !== null)

      // Group this councillor's direction-bearing motions on this issue by axis.
      const axisMap = new Map<string, AxisAgg>()

      for (const c of directionBearing) {
        const vote = c.positions[councillor.slug]
        if (vote === undefined) continue // not on the roster for this motion — not applicable, not absent

        const d = c.direction as Direction
        const key = d.axis
        let agg = axisMap.get(key)
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
          }
          axisMap.set(key, agg)
        }

        if (vote === "yea" || vote === "nay") {
          const alignedExpansive = (d.valence === 1 && vote === "yea") || (d.valence === -1 && vote === "nay")
          if (alignedExpansive) agg.forCount++
          else agg.againstCount++
        } else if (vote === "recuse") {
          agg.recused++
        } else if (vote === "absent") {
          agg.absent++
        } else if (vote === "abstain") {
          agg.abstain++
        } else {
          agg.other++
        }

        agg.evidence.push(evidenceEntry(c, vote))
      }

      if (axisMap.size === 0) continue

      const axes = [...axisMap.values()]
        .sort((a, b) => b.forCount + b.againstCount - (a.forCount + a.againstCount))
        .map((agg) => {
          const sampleSize = agg.forCount + agg.againstCount
          const pattern =
            sampleSize === 0
              ? `No direction-bearing votes cast on this axis since 2023 (recused ${agg.recused}, absent ${agg.absent}).`
              : `Voted for the measure in ${agg.forCount} of ${sampleSize} votes since 2023 that ${agg.axisLabels.expansive} (voted against — i.e. toward measures that ${agg.axisLabels.restrictive} — in ${agg.againstCount})` +
                (agg.recused || agg.absent
                  ? `; recused ${agg.recused}, absent ${agg.absent}.`
                  : ".")
          return {
            axis: agg.axis,
            axisLabels: agg.axisLabels,
            sampleSize,
            for: agg.forCount,
            against: agg.againstCount,
            forPct: pct(agg.forCount, sampleSize),
            recused: agg.recused,
            absent: agg.absent,
            abstain: agg.abstain,
            other: agg.other,
            pattern,
            evidence: agg.evidence.sort((a, b) => (a.date < b.date ? 1 : -1)),
          }
        })

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
        { sampleSize: 0, for: 0, against: 0, recused: 0, absent: 0, abstain: 0, other: 0 }
      )

      issuesOut[issueId] = {
        issueLabel: ISSUES[issueId].label,
        divisionsInCorpus: directionBearing.length,
        overall,
        axes,
      }
    }

    councillorsOut[councillor.slug] = {
      displayName: councillor.displayName,
      ward: councillor.ward,
      role: councillor.role,
      issues: issuesOut,
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    sourceHash: allMotionsRaw.sourceHash,
    sourceGeneratedAt: allMotionsRaw.generatedAt,
    cutoffDate: CUTOFF_DATE,
    methodology:
      "Per councillor per issue per axis: 'for' = their vote aligned with the axis's expansive/permissive outcome, 'against' = aligned with its restrictive outcome (not raw yea/nay — see direction-rules.ts). Recusals and absences are counted separately, never folded into 'against' and never inferred as a position. A councillor with no entry for a motion was not on that meeting's roster (e.g. not a committee member) — not applicable, not absent.",
    councillors: councillorsOut,
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, "stances.json"), JSON.stringify(out, null, 2))
}

main()
