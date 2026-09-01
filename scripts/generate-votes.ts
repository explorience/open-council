/**
 * Extract per-councillor voting data from meeting JSON files
 *
 * Scans all meeting data and generates data/votes/{slug}.json for each councillor
 * with their complete voting history.
 *
 * Usage: npx tsx scripts/generate-votes.ts
 */

import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import {
  loadRegistry,
  normalizeCouncillorName,
  getSlug,
} from "../lib/councillors/index.js"
import { classifyVoteType, isProcedural, type VoteType, MOTION_TEXT_TRUNCATION_MARKER } from "../lib/votes/vote-type.js"

// Cap on stored motion text length. Was 500 chars, which cut off ~25% of real motions
// mid-word/mid-sentence while still being packaged downstream as "Full Motion Text" -
// see MOTION_TEXT_TRUNCATION_MARKER for how the cut is now signaled instead of hidden.
const MAX_MOTION_TEXT_LENGTH = 2000

// Types
interface VoteRow {
  vote: string // "Yeas:", "Nays:", "Absent:", "Recuse:", "Abstain(0.00", "Conflict", etc.
  voters: string[]
}

interface Vote {
  rows: VoteRow[]
  __class__: "Vote"
}

interface MotionResult {
  string: string // "Motion Passed (15 to 0)"
  __class__: "MotionResult"
}

interface ContentItem {
  vote?: Vote
  result?: MotionResult
  string?: string
  motion_texts?: { string: string }[]
  pre_motion_texts?: { string: string }[]
  __class__: string
}

interface MeetingItem {
  title: string
  number: string
  content: ContentItem[]
  items?: Record<string, MeetingItem>
  __class__: "MeetingItem"
}

interface Meeting {
  title: string
  datetime: string
  url: string
  meeting_type: string
  items: Record<string, MeetingItem>
  present?: string[]
  absent?: string[]
  remote_attendance?: string[]
}

interface VoteRecord {
  date: string
  meetingSlug: string
  meetingTitle: string
  meetingType: string
  meetingUrl: string
  itemNumber: string
  itemTitle: string
  motionText: string
  vote: VoteType
  result: string
  passed: boolean
  unanimous: boolean
  // How `unanimous` was determined - see parseResult(). "tally" means the
  // eSCRIBE-format "(N to M)" markup was present (2018+, always); "votes"
  // means it was derived from a resolvable Nay in the parsed rows
  // (pre-2018 only, genuinely divided - see the pre-2018 scoping in
  // parseResult()); "unresolved" means a Nay row was present but every
  // name in it failed to resolve against the registry (garbled Word-export
  // text) - there IS recorded dissent, it just can't be attributed to a
  // specific councillor, so `unanimous` is false but not "confirmed
  // divided" the way "votes" is (issue #199 d7); "unknown" means neither
  // signal was available and `unanimous: true` is a default, not a
  // confirmed fact - see issue #199 (d1).
  unanimousSource: "tally" | "votes" | "unresolved" | "unknown"
  // Position of this roll call's content object within its containing
  // agenda item's content array. Pre-2018 AND 2018+ minutes can both render
  // two distinct roll calls under the same item with textually-identical
  // (often boilerplate) motion text, which would otherwise collide in
  // motionKey below - see issue #199 (d3). Not pre-2018-specific: 49 stored
  // 2018-2026 motions were confirmed merging two roll calls with different
  // results before this field was included in the 2018+ key too.
  rollCallOrdinal: number
}

interface CouncillorVotesFile {
  councillor: string
  slug: string
  generatedAt: string
  sourceHash: string
  summary: {
    totalMeetings: number
    totalVotes: number
    yeas: number
    nays: number
    absent: number
    recuse: number
    abstain: number
    other: number
  }
  votes: VoteRecord[]
}

// isProcedural() lives in lib/votes/vote-type.ts - shared with
// generate-stats.ts so both artifacts, regenerated from the same source
// in the same run, agree on what "substantive" means (issue #199 punch
// list item 2). See that module for the hasResolvableDissent contract.

// Extract motion text from content item
function extractMotionText(content: ContentItem): string {
  const parts: string[] = []

  if (content.motion_texts) {
    parts.push(...content.motion_texts.map(t => t.string))
  }
  if (content.pre_motion_texts) {
    parts.push(...content.pre_motion_texts.map(t => t.string))
  }
  if (content.string && content.__class__ === "Paragraph") {
    parts.push(content.string)
  }

  const full = parts.join(" ")
  if (full.length <= MAX_MOTION_TEXT_LENGTH) return full

  // Truncated - append the marker so downstream chatbot formatting never presents this
  // as the "Full Motion Text" (see MOTION_TEXT_TRUNCATION_MARKER doc comment).
  return full.slice(0, MAX_MOTION_TEXT_LENGTH) + MOTION_TEXT_TRUNCATION_MARKER
}

// Normalize voter name from meeting format (e.g., "Mayor J. Morgan" -> "J. Morgan")
function normalizeVoterName(name: string): string | null {
  // Remove titles
  let cleaned = name
    .replace(/^(Mayor|Deputy Mayor|Councillor|Acting)\s+/i, "")
    .trim()

  return normalizeCouncillorName(cleaned)
}

// Does this vote have at least one Nay row naming a councillor the
// registry can actually resolve? Shared by parseResult()'s tri-state
// fallback and the procedural dissent-gate - both need the same "is there
// real, attributable dissent" signal (issue #199 d1/d4).
function hasResolvableNay(voteRows: VoteRow[], registry: ReturnType<typeof loadRegistry>): boolean {
  return voteRows.some(row => {
    if (classifyVoteType(row.vote) !== "nay") return false
    return row.voters.some(voterName => {
      const canonical = normalizeVoterName(voterName)
      return canonical !== null && !!registry[canonical]
    })
  })
}

// Does this vote have a Nay row that names at least one voter, but NONE of
// those names resolve against the registry? This is the "garbled Word-
// export text" case (issue #199 d7) - e.g. a Nays row whose entries are
// paragraph fragments instead of names, or a name split across a page
// break. There IS recorded dissent here; it's just unattributable. Must
// not be silently folded into "no dissent recorded" (which parseResult()
// treats as presumed-unanimous) - see the "unresolved" unanimousSource.
function hasUnresolvableNay(voteRows: VoteRow[], registry: ReturnType<typeof loadRegistry>): boolean {
  return voteRows.some(row => {
    if (classifyVoteType(row.vote) !== "nay") return false
    if (row.voters.length === 0) return false
    return !row.voters.some(voterName => {
      const canonical = normalizeVoterName(voterName)
      return canonical !== null && !!registry[canonical]
    })
  })
}

// London City Council: Mayor + 14 Councillors. A voter row naming more
// people than that isn't a real roll call - it's Word-export text that
// got split on the wrong delimiter (paragraph fragments, run-on
// sentences) and landed in the voters array instead. Shared by
// isGarbledRollCall() below; keep it here, not duplicated at each call
// site (issue #199 punch list item 1).
const MAX_COUNCIL_SIZE = 15

// Is this roll call's raw vote-row data garbled - a voter row too long to
// be real, or one where the MAJORITY of named "voters" fail to resolve
// against the registry? (issue #199 punch list item 1, e.g. 2013-01-24
// item 3's roll call 0: a 24-entry "Yeas" row and a 193-entry "Nays" row,
// both Word-export text fragments, not real names.)
//
// This is a STRONGER, more general condition than hasUnresolvableNay()
// above (which only looks at Nay rows, and only fires when ZERO names
// resolve): a garbled row can still contain one or two names that happen
// to coincidentally resolve against the registry among dozens of
// fragments that don't, and hasResolvableNay() alone would take that as
// "confirmed, resolvable dissent" - exactly the wrong conclusion for
// mis-split text. Checked across ALL rows (not just Nays): a garbled Yeas
// row is just as much evidence the whole roll call's voter data is
// unreliable.
function isGarbledRollCall(voteRows: VoteRow[], registry: ReturnType<typeof loadRegistry>): boolean {
  return voteRows.some(row => {
    if (row.voters.length === 0) return false
    if (row.voters.length > MAX_COUNCIL_SIZE) return true
    const resolvedCount = row.voters.filter(voterName => {
      const canonical = normalizeVoterName(voterName)
      return canonical !== null && !!registry[canonical]
    }).length
    return resolvedCount * 2 < row.voters.length // strictly fewer than half resolve
  })
}

// Parse vote result string.
//
// eSCRIBE (2018+) always renders a machine-readable "(N to M)" tally in
// the result string - that's the ground truth and is used whenever it's
// present, unchanged from before. Pre-2018 Word-format minutes never
// carry that markup (0 of 9,153 pre-2018 vote blocks have it - issue
// #199 d1): the result string is a bare "Motion Passed"/"Motion Failed".
// The old code treated "no tally" as "not unanimous", which made
// `unanimous` false for every single pre-2018 record in every year
// 2011-2017 - "contested" was the default, not a classification.
//
// When there's no tally AND the record is pre-2018, derive divided/
// unanimous from the vote rows themselves instead:
//   - a resolvable Nay voter means the motion was genuinely divided
//     (unanimousSource "votes");
//   - a Nay row that names voters but resolves none of them means there
//     IS recorded dissent, just unattributable - garbled Word-export text,
//     issue #199 d7 (unanimousSource "unresolved"; NOT folded into
//     unanimous:true - that would silently convert real dissent into
//     presumed unanimity);
//   - otherwise mark it unanimous, but flag that as `unanimousSource:
//     "unknown"` rather than `"votes"` so downstream code can tell
//     "confirmed unanimous" apart from "no dissent recorded, so presumed
//     unanimous".
//
// A missing tally on a 2018+ record is itself anomalous (eSCRIBE always
// emits one) - issue #199 d8 found 299 such 2018+ records. These do NOT
// get the votes-based fallback: that fallback exists solely to solve pre-
// 2018's total lack of tally markup, and applying it here silently flipped
// 299 records from unanimous:false to unanimous:true relative to the
// pre-tri-state baseline. 2018+ falls straight through to unanimous:false/
// "unknown", matching prior (pre-tri-state) behavior exactly.
function parseResult(
  result: string,
  voteRows: VoteRow[],
  registry: ReturnType<typeof loadRegistry>,
  isPre2018: boolean
): { passed: boolean; unanimous: boolean; unanimousSource: "tally" | "votes" | "unresolved" | "unknown" } {
  const passed = /passed|carried|approved/i.test(result)
  const tallyMatch = result.match(/\((\d+) to (\d+)\)/)

  if (tallyMatch) {
    return { passed, unanimous: tallyMatch[2] === "0", unanimousSource: "tally" }
  }

  if (!isPre2018) {
    return { passed, unanimous: false, unanimousSource: "unknown" }
  }

  // Garbled voter data (issue #199 punch list item 1) takes priority over
  // hasResolvableNay() below: a garbled row can still contain one
  // coincidentally-resolvable name, and that must never read as
  // "confirmed, resolvable dissent" - see isGarbledRollCall()'s doc
  // comment. Demoted to "unresolved", never "votes".
  if (isGarbledRollCall(voteRows, registry)) {
    return { passed, unanimous: false, unanimousSource: "unresolved" }
  }

  if (hasResolvableNay(voteRows, registry)) {
    return { passed, unanimous: false, unanimousSource: "votes" }
  }

  if (hasUnresolvableNay(voteRows, registry)) {
    return { passed, unanimous: false, unanimousSource: "unresolved" }
  }

  return { passed, unanimous: true, unanimousSource: "unknown" }
}

// Recursively find all votes in meeting items
function findVotes(
  items: Record<string, MeetingItem>,
  meeting: Meeting,
  meetingSlug: string,
  parentPath: string = ""
): VoteRecord[] {
  const votes: VoteRecord[] = []
  const registry = loadRegistry()
  const isPre2018 = meeting.datetime.split(" ")[0] < "2018-01-01"

  for (const [num, item] of Object.entries(items)) {
    const itemPath = parentPath ? `${parentPath}.${num}` : num

    // Check content for votes
    if (item.content && Array.isArray(item.content)) {
      let rollCallOrdinal = 0
      for (const content of item.content) {
        if (content.vote && content.vote.rows) {
          const ordinal = rollCallOrdinal++
          const motionText = extractMotionText(content)
          const resultStr = content.result?.string || ""
          const { passed, unanimous, unanimousSource } = parseResult(resultStr, content.vote.rows, registry, isPre2018)

          // A garbled roll call (issue #199 punch list item 1) emits NO
          // per-councillor vote records at all, even for the names that
          // happen to resolve - attributing an individual vote from a row
          // that's mostly mis-split Word-export text isn't trustworthy
          // just because one fragment coincidentally matches a real name.
          // The roll call itself is still recorded (unanimousSource
          // "unresolved" above), just with an empty voter attribution.
          if (!isGarbledRollCall(content.vote.rows, registry)) {
            // Process each voter
            for (const row of content.vote.rows) {
              const voteType = classifyVoteType(row.vote)

              for (const voterName of row.voters) {
                const canonicalName = normalizeVoterName(voterName)
                if (canonicalName && registry[canonicalName]) {
                  votes.push({
                    date: meeting.datetime.split(" ")[0],
                    meetingSlug,
                    meetingTitle: meeting.title,
                    meetingType: meeting.meeting_type || "Unknown",
                    meetingUrl: meeting.url,
                    itemNumber: itemPath,
                    itemTitle: item.title,
                    motionText,
                    vote: voteType,
                    result: resultStr,
                    passed,
                    unanimous,
                    unanimousSource,
                    rollCallOrdinal: ordinal,
                  })
                }
              }
            }
          }
        }
      }
    }

    // Recursively check nested items
    if (item.items && Object.keys(item.items).length > 0) {
      votes.push(...findVotes(item.items, meeting, meetingSlug, itemPath))
    }
  }

  return votes
}

// A meeting needs at least this many roll calls before a fingerprint
// match is trusted as "the same file republished" rather than dismissed
// as coincidence. Below this, two DISTINCT real meetings can legitimately
// produce identical vote-block text by chance - e.g. two different
// committee meetings each recording a single, identically-worded,
// unanimous "no pecuniary interest declared" vote from the same standing
// membership (confirmed: 2024-09-10 and 2024-11-12 Civic Works Committee,
// both real meetings, coincidentally share exactly one identical vote
// row). A real re-publication reproduces a whole meeting's substantive
// business, not one routine line - the known cases (issue #199 d6) carry
// 32-198 duplicated roll calls each.
const MIN_ROLL_CALLS_FOR_DUPLICATE_FILE = 3

// Fingerprint a meeting's full vote-row block: every roll call's motion
// text, result, and yeas/nays/etc. rows, concatenated in document order.
// Budget-season committee minutes get re-published verbatim inside later
// meeting files (13 known pre-2018 files carrying 198/62/72 duplicate
// divided motions in 2014/2015/2016 - issue #199 d6); two files with an
// identical fingerprint AND enough roll calls to rule out coincidence are
// the same votes filed twice, not two meetings that happened to agree on
// everything. Returns "" for a meeting with no votes, or too few to trust
// a match on (see MIN_ROLL_CALLS_FOR_DUPLICATE_FILE) - such a file is
// never treated as a duplicate of anything.
function computeVoteBlockFingerprint(meeting: Meeting): string {
  const rows: string[] = []

  const walk = (items: Record<string, MeetingItem> | undefined) => {
    if (!items) return
    for (const item of Object.values(items)) {
      if (item.content && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (content.vote && content.vote.rows && content.vote.rows.length > 0) {
            const motionText = extractMotionText(content)
            const resultStr = content.result?.string || ""
            const voteRows = content.vote.rows
              .map(r => `${r.vote}:${r.voters.join(",")}`)
              .join(";")
            rows.push(`${motionText}|${resultStr}|${voteRows}`)
          }
        }
      }
      walk(item.items)
    }
  }

  walk(meeting.items)
  if (rows.length < MIN_ROLL_CALLS_FOR_DUPLICATE_FILE) return ""
  return crypto.createHash("sha256").update(rows.join("\n")).digest("hex")
}

// Fingerprint a meeting's full set of agenda-item titles (every item, at
// every nesting depth, normalized and concatenated in document order).
// The vote-block fingerprint above collapses to just `result|voter-lists`
// for pre-2018 COMMITTEE files, because their motionText is still
// boilerplate "Motion Passed" (those files were never re-scraped by the
// d2/d5 recovery - see issue #199's disclosure of that gap). Two routine
// committee meetings sharing the same small standing membership voting
// unanimously produce byte-identical `result|voter-lists` fingerprints by
// pure coincidence (confirmed: issue #199 found 5 genuinely distinct
// meetings - different eSCRIBE meeting ids, different agenda-item counts
// and titles - wrongly collapsed together this way, silently dropping 59
// real roll calls and 5 real meetings). Requiring the item-title
// fingerprint to ALSO match is what tells a genuine byte-identical
// re-publication (same agenda, same items, same votes - the known d6
// cases) apart from that coincidence (different agenda, different items,
// same vote shape).
function computeItemTitleFingerprint(meeting: Meeting): string {
  const titles: string[] = []

  const walk = (items: Record<string, MeetingItem> | undefined) => {
    if (!items) return
    for (const item of Object.values(items)) {
      titles.push((item.title || "").trim().toLowerCase().replace(/\s+/g, " "))
      walk(item.items)
    }
  }

  walk(meeting.items)
  return titles.join("|")
}

// Generate a hash of the source data for staleness detection
function generateSourceHash(meetings: Meeting[]): string {
  const content = JSON.stringify(
    meetings.map(m => ({
      title: m.title,
      datetime: m.datetime,
      itemCount: Object.keys(m.items || {}).length,
    }))
  )
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
}

// Main function
async function main() {
  console.log("🗳️ Vote Extraction Script\n")

  const dataDir = path.join(process.cwd(), "data")
  const outputDir = path.join(dataDir, "votes")
  const registry = loadRegistry()

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true })

  // Initialize vote collections per councillor
  const councillorVotes: Record<string, VoteRecord[]> = {}
  const councillorMeetings: Record<string, Set<string>> = {}
  const garbledStats = { excludedRollCalls: 0 }

  for (const canonicalName of Object.keys(registry)) {
    const slug = getSlug(canonicalName)
    councillorVotes[slug] = []
    councillorMeetings[slug] = new Set()
  }

  // Scan all meeting directories
  console.log("📁 Scanning meeting data...")
  const entries = await fs.readdir(dataDir, { withFileTypes: true })
  const monthDirs = entries
    .filter(e => e.isDirectory() && /^\d{4}-\d{2}/.test(e.name))
    .map(e => e.name)
    .sort()

  let totalMeetings = 0
  let totalVotes = 0
  const allMeetings: Meeting[] = []

  // Combined (vote-block fingerprint, item-title fingerprint) -> the first
  // (chronologically earliest, since files are processed in sorted date
  // order) file that produced it. Files scanned in date order within each
  // month give the actual original meeting priority over a later re-
  // publication - issue #199 d6. Both fingerprints must match - see
  // computeItemTitleFingerprint's doc comment for why the vote-block
  // fingerprint alone isn't enough for pre-2018 committee files (issue
  // #199 verification: the vote-block-only key wrongly collapsed 5
  // genuinely distinct meetings into 3 "duplicates", dropping 59 real roll
  // calls).
  const seenVoteFingerprints = new Map<string, string>()
  const duplicateFiles: { duplicate: string; original: string }[] = []

  for (const monthDir of monthDirs) {
    const monthPath = path.join(dataDir, monthDir)
    const files = await fs.readdir(monthPath)
    const jsonFiles = files.filter(f => f.endsWith(".json")).sort()

    for (const file of jsonFiles) {
      const filePath = path.join(monthPath, file)
      const relativePath = `${monthDir}/${file}`

      try {
        const content = await fs.readFile(filePath, "utf-8")
        const meeting: Meeting = JSON.parse(content)

        if (!meeting.items || Object.keys(meeting.items).length === 0) {
          continue
        }

        const voteFingerprint = computeVoteBlockFingerprint(meeting)
        if (voteFingerprint) {
          const dedupeKey = `${voteFingerprint}::${computeItemTitleFingerprint(meeting)}`
          const original = seenVoteFingerprints.get(dedupeKey)
          if (original) {
            duplicateFiles.push({ duplicate: relativePath, original })
            continue // byte-identical re-published minutes - skip, don't double-count
          }
          seenVoteFingerprints.set(dedupeKey, relativePath)
        }

        totalMeetings++
        allMeetings.push(meeting)

        // Generate meeting slug
        const meetingSlug = `months/${monthDir}/${file.replace(".json", "")}`

        // Find all votes in this meeting (just for counting)
        const votes = findVotes(meeting.items, meeting, meetingSlug)
        totalVotes += votes.length

      } catch (err) {
        // Skip files with parse errors
        continue
      }
    }
  }

  console.log(`   Found ${totalMeetings} meetings with items`)
  if (duplicateFiles.length > 0) {
    console.log(`   Skipped ${duplicateFiles.length} duplicate (byte-identical re-published) file(s)`)
  }

  // Actually reprocess to properly attribute votes to councillors
  console.log("\n📊 Extracting votes per councillor...")

  const duplicateFilePaths = new Set(duplicateFiles.map(d => d.duplicate))

  for (const monthDir of monthDirs) {
    const monthPath = path.join(dataDir, monthDir)
    const files = await fs.readdir(monthPath)
    const jsonFiles = files.filter(f => f.endsWith(".json")).sort()

    for (const file of jsonFiles) {
      const filePath = path.join(monthPath, file)
      const relativePath = `${monthDir}/${file}`
      if (duplicateFilePaths.has(relativePath)) continue

      try {
        const content = await fs.readFile(filePath, "utf-8")
        const meeting: Meeting = JSON.parse(content)

        if (!meeting.items || Object.keys(meeting.items).length === 0) {
          continue
        }

        const meetingSlug = `months/${monthDir}/${file.replace(".json", "")}`

        // Find all votes with councillor attribution
        findVotesWithAttribution(
          meeting.items,
          meeting,
          meetingSlug,
          councillorVotes,
          councillorMeetings,
          registry,
          garbledStats
        )

      } catch (err) {
        continue
      }
    }
  }

  // Generate source hash
  const sourceHash = generateSourceHash(allMeetings)

  // Write vote files for each councillor
  console.log("\n📝 Writing vote files...")
  let councillorsWithVotes = 0

  for (const [slug, votes] of Object.entries(councillorVotes)) {
    if (votes.length === 0) continue

    councillorsWithVotes++

    // Find canonical name for this slug
    const canonicalName = Object.keys(registry).find(
      name => registry[name].slug === slug
    )!

    // Calculate summary stats
    const yeas = votes.filter(v => v.vote === "yea").length
    const nays = votes.filter(v => v.vote === "nay").length
    // NOTE: "absent" here must only count genuine no-shows. Pecuniary-interest
    // recusals ("recuse") and abstentions ("abstain") are distinct, ethical/
    // procedural acts and are tracked separately below - never folded into
    // "absent". See lib/votes/vote-type.ts for the classification.
    const absent = votes.filter(v => v.vote === "absent").length
    const recuse = votes.filter(v => v.vote === "recuse").length
    const abstain = votes.filter(v => v.vote === "abstain").length
    const other = votes.filter(v => v.vote === "other").length
    const meetings = councillorMeetings[slug]?.size || 0

    // Sort votes by date descending
    votes.sort((a, b) => b.date.localeCompare(a.date))

    const votesFile: CouncillorVotesFile = {
      councillor: canonicalName,
      slug,
      generatedAt: new Date().toISOString(),
      sourceHash,
      summary: {
        totalMeetings: meetings,
        totalVotes: votes.length,
        yeas,
        nays,
        absent,
        recuse,
        abstain,
        other,
      },
      votes,
    }

    const outputPath = path.join(outputDir, `${slug}.json`)
    await fs.writeFile(outputPath, JSON.stringify(votesFile, null, 2))

    console.log(`   ✓ ${registry[canonicalName].displayName}: ${votes.length} votes`)
  }

  // ─── Phase 1: Aggregate all councillor votes into _all-motions.json ───
  console.log("\n📊 Aggregating all motions...")

  const motionMap = new Map<string, {
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
    unanimousSource: "tally" | "votes" | "unresolved" | "unknown"
    rollCallOrdinal: number
    procedural: boolean
    yeas: string[]
    nays: string[]
    absent: string[]
    recuse: string[]
    abstain: string[]
    other: string[]
  }>()

  // Read all councillor vote files and aggregate
  for (const [slug, votes] of Object.entries(councillorVotes)) {
    if (votes.length === 0) continue

    // Find display name for this councillor
    const canonicalName = Object.keys(registry).find(
      name => registry[name].slug === slug
    )!
    const displayName = registry[canonicalName].displayName

    for (const vote of votes) {
      // Create a unique key for each motion. Minutes (pre-2018 AND 2018+
      // eSCRIBE alike) can render two textually-identical roll calls under
      // the same item - rollCallOrdinal (this content object's position
      // within the item) keeps them apart instead of silently merging
      // their voter lists and inheriting just one roll call's result
      // (issue #199 d3). This was originally scoped to pre-2018 only on
      // the theory that "eSCRIBE items don't share this failure mode" -
      // that premise was false: 49 stored 2018-2026 motions were confirmed
      // merging two roll calls with DIFFERENT results (e.g. 2019-03-05
      // item 8.1.9 stored "Passed (8 to 7)" while unioning in the nay
      // voters from a separate "Failed (7 to 8)" roll call). Applying
      // rollCallOrdinal everywhere is also what makes the 2019-2025 name-
      // vs-tally identity oracle hold exactly rather than merely
      // approximately.
      const motionKey = `${vote.date}|${vote.meetingSlug}|${vote.itemNumber}|${vote.motionText}|${vote.rollCallOrdinal}`

      if (!motionMap.has(motionKey)) {
        motionMap.set(motionKey, {
          date: vote.date,
          meetingSlug: vote.meetingSlug,
          meetingTitle: vote.meetingTitle,
          meetingType: vote.meetingType,
          meetingUrl: vote.meetingUrl,
          itemNumber: vote.itemNumber,
          itemTitle: vote.itemTitle,
          motionText: vote.motionText,
          result: vote.result,
          passed: vote.passed,
          unanimous: vote.unanimous,
          unanimousSource: vote.unanimousSource,
          rollCallOrdinal: vote.rollCallOrdinal,
          // Placeholder - computed in a final pass below once every
          // voter (and therefore the full `nays` list) has been
          // aggregated for this motion. isProcedural() needs to know
          // whether there's recorded dissent, which isn't known yet
          // from just the first voter processed.
          procedural: false,
          yeas: [],
          nays: [],
          absent: [],
          recuse: [],
          abstain: [],
          other: [],
        })
      }

      const motion = motionMap.get(motionKey)!
      if (vote.vote === "yea") motion.yeas.push(displayName)
      else if (vote.vote === "nay") motion.nays.push(displayName)
      else if (vote.vote === "absent") motion.absent.push(displayName)
      else if (vote.vote === "recuse") motion.recuse.push(displayName)
      else if (vote.vote === "abstain") motion.abstain.push(displayName)
      else motion.other.push(displayName)
    }
  }

  // Now that every motion's full nays list is populated, gate procedural
  // classification on recorded dissent (issue #199 d4).
  for (const motion of motionMap.values()) {
    motion.procedural = isProcedural(motion.motionText, motion.nays.length > 0)
  }

  // Convert to array with IDs, sorted by date descending then item number.
  // IDs mirror motionKey's uniqueness domain above: always include the
  // roll-call ordinal so two distinct motions sharing the rest of the key
  // don't collide onto the same id (issue #199 d3 - see the motionKey
  // comment above for why this is no longer pre-2018-only). NOTE: this
  // changes ids for the (rare) 2018-2026 motions that previously collided
  // - by construction, those ids were already wrong (two distinct roll
  // calls sharing one id/record).
  const allMotions = Array.from(motionMap.values())
    .map(m => ({
      id: crypto.createHash("sha256")
        .update(`${m.date}|${m.meetingSlug}|${m.itemNumber}|${m.motionText}|${m.rollCallOrdinal}`)
        .digest("hex")
        .slice(0, 12),
      ...m,
      margin: Math.abs(m.yeas.length - m.nays.length),
    }))
    .sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date)
      if (dateCompare !== 0) return dateCompare
      return a.itemNumber.localeCompare(b.itemNumber)
    })

  const substantiveCount = allMotions.filter(m => !m.procedural).length
  const contestedCount = allMotions.filter(m => !m.procedural && !m.unanimous).length

  const allMotionsFile = {
    generatedAt: new Date().toISOString(),
    sourceHash,
    totalMotions: allMotions.length,
    substantiveMotions: substantiveCount,
    contestedMotions: contestedCount,
    // Disclosure list (issue #199 d6): files whose full vote-row block was
    // byte-identical to an earlier file's and were therefore skipped
    // rather than double-counted. `original` is the file whose votes were
    // kept.
    duplicateFiles,
    motions: allMotions,
  }

  await fs.writeFile(
    path.join(outputDir, "_all-motions.json"),
    JSON.stringify(allMotionsFile)
  )

  console.log(`   Total motions: ${allMotions.length}`)
  console.log(`   Substantive: ${substantiveCount}`)
  console.log(`   Contested: ${contestedCount}`)
  if (garbledStats.excludedRollCalls > 0) {
    console.log(`   Garbled roll calls excluded from attribution: ${garbledStats.excludedRollCalls}`)
  }

  // Write metadata file
  const metaFile = {
    generatedAt: new Date().toISOString(),
    sourceHash,
    totalMeetings,
    councillorsWithVotes,
    totalMotions: allMotions.length,
    substantiveMotions: substantiveCount,
    contestedMotions: contestedCount,
    duplicateFilesSkipped: duplicateFiles.length,
    // Roll calls demoted to unanimousSource "unresolved" because the raw
    // voter data was garbled (a row too long to be real, or a majority of
    // named "voters" not resolving against the registry) - see
    // isGarbledRollCall(). These get NO per-councillor vote records at
    // all (issue #199 punch list item 1).
    garbledRollCallsExcluded: garbledStats.excludedRollCalls,
  }
  await fs.writeFile(
    path.join(outputDir, "_meta.json"),
    JSON.stringify(metaFile, null, 2)
  )

  console.log(`\n✅ Vote extraction complete!`)
  console.log(`   Meetings processed: ${totalMeetings}`)
  console.log(`   Councillors with votes: ${councillorsWithVotes}`)
  console.log(`   All motions aggregated: ${allMotions.length}`)
}

// Find votes and attribute to councillors
function findVotesWithAttribution(
  items: Record<string, MeetingItem>,
  meeting: Meeting,
  meetingSlug: string,
  councillorVotes: Record<string, VoteRecord[]>,
  councillorMeetings: Record<string, Set<string>>,
  registry: ReturnType<typeof loadRegistry>,
  // Mutated in place (not returned - this function recurses, and every
  // level shares one running total): counts garbled roll calls excluded
  // from per-councillor attribution, exposed in _meta.json's
  // garbledRollCallsExcluded (issue #199 punch list item 1).
  garbledStats: { excludedRollCalls: number },
  parentPath: string = ""
): void {
  const isPre2018 = meeting.datetime.split(" ")[0] < "2018-01-01"

  for (const [num, item] of Object.entries(items)) {
    const itemPath = parentPath ? `${parentPath}.${num}` : num

    if (item.content && Array.isArray(item.content)) {
      let rollCallOrdinal = 0
      for (const content of item.content) {
        if (content.vote && content.vote.rows) {
          const ordinal = rollCallOrdinal++
          const motionText = extractMotionText(content)
          const resultStr = content.result?.string || ""
          const { passed, unanimous, unanimousSource } = parseResult(resultStr, content.vote.rows, registry, isPre2018)

          // See the matching comment in findVotes() above - a garbled
          // roll call emits NO per-councillor attribution at all.
          if (isGarbledRollCall(content.vote.rows, registry)) {
            garbledStats.excludedRollCalls++
          } else {
            for (const row of content.vote.rows) {
              const voteType = classifyVoteType(row.vote)

              for (const voterName of row.voters) {
                const canonicalName = normalizeVoterName(voterName)
                if (canonicalName && registry[canonicalName]) {
                  const slug = registry[canonicalName].slug

                  if (councillorVotes[slug]) {
                    councillorVotes[slug].push({
                      date: meeting.datetime.split(" ")[0],
                      meetingSlug,
                      meetingTitle: meeting.title,
                      meetingType: meeting.meeting_type || "Unknown",
                      meetingUrl: meeting.url,
                      itemNumber: itemPath,
                      itemTitle: item.title,
                      motionText,
                      vote: voteType,
                      result: resultStr,
                      passed,
                      unanimous,
                      unanimousSource,
                      rollCallOrdinal: ordinal,
                    })

                    councillorMeetings[slug]?.add(meetingSlug)
                  }
                }
              }
            }
          }
        }
      }
    }

    if (item.items && Object.keys(item.items).length > 0) {
      findVotesWithAttribution(
        item.items,
        meeting,
        meetingSlug,
        councillorVotes,
        councillorMeetings,
        registry,
        garbledStats,
        itemPath
      )
    }
  }
}

main().catch(console.error)
