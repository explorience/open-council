/**
 * Vote Lookup Service
 *
 * Provides direct access to structured vote records for accurate councillor voting queries.
 * This bypasses semantic search to give exact, verified vote information.
 *
 * Used by the RAG service when detecting councillor voting queries.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { voteTypeLabel, isMotionTextTruncated, type VoteType } from '../lib/votes/vote-type.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to vote data files
const VOTES_DIR = join(__dirname, '..', 'data', 'votes');

/**
 * Individual vote record from structured data
 */
export interface VoteRecord {
  date: string;
  meetingSlug: string;
  meetingTitle: string;
  meetingType: string;
  meetingUrl?: string;
  itemNumber?: string;
  itemTitle: string;
  motionText: string;
  vote: VoteType;
  result: string;
  passed: boolean;
  unanimous: boolean;
}

/**
 * Councillor vote file structure
 */
interface CouncillorVoteFile {
  councillor: string;
  slug: string;
  generatedAt: string;
  sourceHash: string;
  summary: {
    totalMeetings: number;
    totalVotes: number;
    yeas: number;
    nays: number;
    absent: number;
    recuse?: number;
    abstain?: number;
    other?: number;
  };
  votes: VoteRecord[];
}

/**
 * Result from a vote lookup
 */
export interface VoteLookupResult {
  councillor: string;
  councillorSlug: string;
  vote: VoteRecord;
  confidence: 'exact' | 'high' | 'medium';
}

/**
 * Result from a motion lookup (all councillors who voted on a motion)
 */
export interface MotionVotesResult {
  motionTitle: string;
  motionText: string;
  date: string;
  meetingTitle: string;
  result: string;
  passed: boolean;
  yeas: string[];
  nays: string[];
  absent: string[];
  /** Councillors who recused/declared a conflict of interest - NOT the same as absent. */
  recused: string[];
  /** Councillors who formally abstained - NOT the same as absent. */
  abstained: string[];
  /** Councillors whose vote row had an unrecognized raw label - visible, not silently dropped. */
  other: string[];
}

/**
 * Result from a close vote lookup
 */
export interface CloseVoteResult {
  date: string;
  itemTitle: string;
  motionText: string;
  meetingTitle: string;
  result: string;
  passed: boolean;
  yeas: string[];
  nays: string[];
  margin: number;
}

/**
 * Cache for loaded vote files
 */
const voteCache: Map<string, CouncillorVoteFile> = new Map();

/**
 * Load a councillor's vote file
 */
function loadCouncillorVotes(slug: string): CouncillorVoteFile | null {
  if (voteCache.has(slug)) {
    return voteCache.get(slug)!;
  }

  const filePath = join(VOTES_DIR, `${slug}.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    voteCache.set(slug, data);
    return data;
  } catch (error) {
    console.error(`Error loading vote file for ${slug}:`, error);
    return null;
  }
}

/**
 * Get all councillor slugs from the votes directory
 */
function getAllCouncillorSlugs(): string[] {
  if (!existsSync(VOTES_DIR)) {
    return [];
  }

  return readdirSync(VOTES_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => f.replace('.json', ''));
}

/**
 * Normalize text for matching (lowercase, remove extra spaces, punctuation)
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if text contains all keywords
 * @internal Reserved for future use
 */
// @ts-expect-error Reserved for future use
function _containsAllKeywords(text: string, keywords: string[]): boolean {
  const normalized = normalizeForMatch(text);
  return keywords.every(kw => normalized.includes(normalizeForMatch(kw)));
}

/**
 * Format the optional Recused/Abstained/Other lines for a MotionVotesResult.
 * Omitted entirely when nobody fell into a given category, to keep the
 * common case (no recusals) uncluttered. These are ALWAYS reported
 * separately from "Absent" - a recusal for a declared conflict of interest
 * is an ethical/legal act, not a no-show.
 */
function formatNonAbsentNonVoteLines(r: {
  recused: string[];
  abstained: string[];
  other: string[];
}): string {
  let lines = '';
  if (r.recused.length > 0) {
    lines += `**Recused - declared conflict of interest (${r.recused.length}):** ${r.recused.join(', ')}\n`;
  }
  if (r.abstained.length > 0) {
    lines += `**Abstained (${r.abstained.length}):** ${r.abstained.join(', ')}\n`;
  }
  if (r.other.length > 0) {
    lines += `**Other/unrecorded vote (${r.other.length}):** ${r.other.join(', ')}\n`;
  }
  return lines;
}

/**
 * Calculate match score based on keyword overlap
 */
function calculateMatchScore(text: string, keywords: string[]): number {
  const normalized = normalizeForMatch(text);
  let matches = 0;
  for (const kw of keywords) {
    if (normalized.includes(normalizeForMatch(kw))) {
      matches++;
    }
  }
  return matches / keywords.length;
}

/**
 * Very common words that show up in almost any topic-keyword list (either as literal
 * query words like "how"/"did"/"vote", or leaked in from a topic clause like "the
 * affordable housing land at..."). They are excluded from the itemTitle anchor check and
 * the absolute-match floor below because they are true everywhere and would let an
 * unrelated record satisfy either gate on a coincidental hit.
 */
const KEYWORD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'was', 'were', 'are', 'not',
  'his', 'her', 'has', 'have', 'had', 'they', 'them', 'you', 'your', 'our', 'its',
  'who', 'how', 'did', 'vote', 'voted', 'voting', 'council', 'councillor', 'motion',
]);

/** Keywords with generic stopwords removed - used only for the anchor/floor checks below. */
function significantKeywords(keywords: string[]): string[] {
  return keywords.filter(kw => kw.length > 0 && !KEYWORD_STOPWORDS.has(kw.toLowerCase()));
}

/**
 * Further restricts to keywords usable for the itemTitle ANCHOR gate specifically - a
 * bare year (e.g. "2026", from "...in July 2026") is near-universal noise as an anchor:
 * agenda item titles routinely reference a fiscal/program year for reasons unrelated to
 * the vote's own date (a "Proposed Winter Response for 2026-2027" title, a budget
 * process named after its year, etc.), so a query's stated year alone can wrongly anchor
 * a same-year but otherwise-unrelated item once anchoring stopped being generic-stopword
 * gated. Years are still useful for scoring/the match-count floor (via
 * significantKeywords) - only the anchor gate excludes them, since the anchor's whole
 * job is to require an identifying, on-topic word, not merely a temporal coincidence.
 */
function anchorableKeywords(keywords: string[]): string[] {
  return significantKeywords(keywords).filter(kw => !/^\d+$/.test(kw));
}

/**
 * Normalize an item title for GROUPING sibling motions recorded on the same real-world
 * agenda item, by stripping a leading numbering/ADDED prefix and casefolding/collapsing
 * whitespace. Two motions can be the SAME agenda item but have different raw itemTitle
 * strings - e.g. "455 Highbury Avenue North - (OZ-9739)" (a procedural referral) vs
 * "(3.3) 455 Highbury Avenue North - (OZ-9739)" (the substantive rezoning decision), or
 * "(ADDED) Amendment - Councillor D. Ferreira" vs the same string with trailing
 * whitespace. Grouping on the raw string used to split these apart and silently return
 * only one of them. This is ONLY for deciding which sibling motions belong together in a
 * findCouncillorVote() result group - it is never used for display (the original
 * itemTitle is always shown) or for the itemTitle-anchor keyword check.
 */
function normalizeItemTitleForGrouping(title: string): string {
  return title
    .replace(/^\s*\(\s*(?:added|[\d]+(?:\.[\d]+)*)\s*\)\s*/i, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cap on how many sibling motions a single findCouncillorVote() call returns for one
 * agenda item - some items (e.g. a slate of committee appointments) carry dozens of
 * separately-recorded motions, and an uncapped group renders a context block tens of
 * thousands of characters long that bypasses the usual retrieval context budget. */
const MAX_GROUPED_MOTIONS = 15;

interface MatchDetail {
  score: number;
  matches: number;
}

/**
 * Like calculateMatchScore, but also reports the raw hit count (not just the ratio) so
 * callers can apply an absolute floor in addition to the ratio threshold.
 */
function calculateMatchDetail(text: string, keywords: string[]): MatchDetail {
  const normalized = normalizeForMatch(text);
  let matches = 0;
  for (const kw of keywords) {
    if (normalizeForMatch(kw) && normalized.includes(normalizeForMatch(kw))) {
      matches++;
    }
  }
  return { score: keywords.length > 0 ? matches / keywords.length : 0, matches };
}

/** Label to use for a stored motion text depending on whether it was truncated at generation time. */
function motionTextLabel(motionText: string): string {
  return isMotionTextTruncated(motionText)
    ? '**Motion Text (truncated in source data - may be cut off mid-sentence):**'
    : '**Full Motion Text:**';
}

export class VoteLookupService {
  private initialized = false;

  /**
   * Initialize the service by preloading vote files
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const slugs = getAllCouncillorSlugs();
    console.log(`📊 Loading vote data for ${slugs.length} councillors...`);

    for (const slug of slugs) {
      loadCouncillorVotes(slug);
    }

    this.initialized = true;
    console.log(`✅ Vote lookup service initialized with ${voteCache.size} councillors`);
  }

  /**
   * Find a specific councillor's vote(s) on a topic.
   *
   * Returns an ARRAY (not a single best guess) because one agenda item can carry
   * multiple recorded motions - e.g. a "part c) BE APPROVED" motion plus a separate
   * "balance of the motion BE APPROVED" motion on the same NRFP award item. Returning
   * only the single highest-scoring row used to silently drop the sibling motion; every
   * motion on the winning (date, itemTitle) pair is now returned so the caller/LLM can
   * see and distinguish all of them (mirrors findAllMotionVotes' per-item grouping).
   *
   * Two gates protect against an unrelated record winning on a diluted/generic keyword
   * set (e.g. dictionary-expanded "housing" synonyms with no identifying term): the
   * agenda item's own TITLE must contain at least one meaningful keyword
   * (itemTitle-anchored matching - a procedural item like "Communications and
   * Petitions" whose motion text happens to mention "homelessness" in passing will
   * never itself be titled that way), and at least 2 meaningful keywords (or all of
   * them, if fewer than 2 were given) must hit, not just the score ratio - a short
   * generic keyword list can otherwise clear the 0.3 ratio bar on a single coincidental
   * hit. If nothing clears both gates, this returns null rather than an unrelated
   * argmax.
   *
   * @param councillorSlug - e.g., "s-stevenson"
   * @param topicKeywords - keywords to match against motion/item title (may include
   *   dictionary-expanded synonyms the user did not type - used for scoring only)
   * @param options.recentMonths - only look at votes from last N months (default: 24),
   *   ignored when month/year is given
   * @param options.month - 0-indexed month to narrow to (e.g. from "in June 2026")
   * @param options.year - year to narrow to, paired with options.month
   * @param options.anchorKeywords - user-supplied words only (no dictionary expansions),
   *   used for the itemTitle anchor gate. Defaults to topicKeywords when omitted. Keeping
   *   this separate matters: an unrelated item whose title happens to contain an
   *   injected synonym (e.g. "safety"/"property" appended for a "police" query) must
   *   never itself satisfy the anchor - only a word the user actually typed should.
   */
  findCouncillorVote(
    councillorSlug: string,
    topicKeywords: string[],
    options: { recentMonths?: number; month?: number; year?: number; anchorKeywords?: string[] } = {}
  ): VoteLookupResult[] | null {
    const { recentMonths = 24, month, year, anchorKeywords } = options;
    const voteFile = loadCouncillorVotes(councillorSlug);
    if (!voteFile) {
      console.log(`   Vote lookup: No data for councillor ${councillorSlug}`);
      return null;
    }

    const meaningfulKeywords = significantKeywords(topicKeywords);
    const meaningfulAnchorKeywords = anchorableKeywords(anchorKeywords ?? topicKeywords);
    const requiredMatches = Math.min(2, meaningfulKeywords.length || 1);

    // Score a candidate set of votes against the item-title anchor + match-floor gates.
    // Pulled out into a closure so it can run twice: once against a month-narrowed set,
    // and (only if that finds nothing) once against the wider unnarrowed set.
    const search = (candidateVotes: VoteRecord[]): Array<{ vote: VoteRecord; score: number; matches: number }> => {
      const scored: Array<{ vote: VoteRecord; score: number; matches: number }> = [];
      for (const vote of candidateVotes) {
        // Word-boundary (exact token) match, not substring - a substring check let the
        // single keyword "land" match inside "Wonderland Road" and anchor an unrelated
        // record under a councillor-vote query that also named "Duluth Crescent land".
        const itemTitleWords = new Set(normalizeForMatch(vote.itemTitle).split(' ').filter(Boolean));
        const itemTitleAnchored = meaningfulAnchorKeywords.some(kw => itemTitleWords.has(normalizeForMatch(kw)));
        if (!itemTitleAnchored) continue;

        const searchText = `${vote.itemTitle} ${vote.motionText}`;
        const detail = calculateMatchDetail(searchText, topicKeywords);
        // The absolute floor must count MEANINGFUL keyword hits only - counting a
        // stopword like "the" toward the >=2 floor let a query keyword set clear the
        // floor via "the" + a single generic word, with zero identifying terms actually
        // hitting (the function's own doc comment above promises "2 meaningful
        // keywords", but the count used to include stopwords).
        const meaningfulDetail = calculateMatchDetail(searchText, meaningfulKeywords);
        if (detail.score >= 0.3 && meaningfulDetail.matches >= requiredMatches) {
          scored.push({ vote, score: detail.score, matches: detail.matches });
        }
      }
      return scored;
    };

    // Build the final grouped result from a scored candidate set. `dateWasNarrowed`
    // marks a result that came from the FALLBACK (unnarrowed) search after a
    // month-narrowed search found nothing - such a result answers a plausible adjacent
    // month rather than the exact month the user named, so it is capped at 'medium'
    // confidence rather than potentially 'exact'.
    const buildResult = (
      candidateVotes: VoteRecord[],
      scored: Array<{ vote: VoteRecord; score: number; matches: number }>,
      dateWasNarrowed: boolean
    ): VoteLookupResult[] | null => {
      if (scored.length === 0) return null;

      // Pick the winning (date, normalized-title) GROUP by best individual score, but
      // group MEMBERSHIP is decided on a normalized title (numbering-prefix/whitespace
      // stripped, casefolded via normalizeItemTitleForGrouping) so sibling motions
      // recorded under slightly different itemTitle strings for the SAME real agenda
      // item aren't split apart and silently dropped.
      const bestByScore = [...scored].sort((a, b) => b.score - a.score)[0];
      const bestKey = normalizeItemTitleForGrouping(bestByScore.vote.itemTitle);
      const relatedScored = scored.filter(
        s => normalizeItemTitleForGrouping(s.vote.itemTitle) === bestKey && s.vote.date === bestByScore.vote.date
      );

      // Order by the SOURCE data's original recorded order (how the motions actually
      // appear on this item - typically part a/b/c or original-then-amendment order),
      // not by match score - sorting by score interleaves each motion's own relative
      // rank into what should read as a stable "motion 1, motion 2, ..." sequence.
      const orderIndex = new Map(candidateVotes.map((v, i) => [v, i]));
      const ordered = [...relatedScored].sort(
        (a, b) => (orderIndex.get(a.vote) ?? 0) - (orderIndex.get(b.vote) ?? 0)
      );

      const capped = ordered.slice(0, MAX_GROUPED_MOTIONS);
      if (ordered.length > capped.length) {
        console.log(`   Vote lookup: capped ${ordered.length} motions on "${bestByScore.vote.itemTitle}" to ${capped.length}`);
      }

      return capped.map(r => {
        const confidence: VoteLookupResult['confidence'] =
          dateWasNarrowed ? 'medium' : r.score >= 0.8 ? 'exact' : r.score >= 0.5 ? 'high' : 'medium';
        console.log(`   Vote lookup: Found ${confidence} match for ${councillorSlug} (score: ${r.score.toFixed(2)}, item: "${r.vote.itemTitle}")`);
        return {
          councillor: voteFile.councillor,
          councillorSlug: voteFile.slug,
          vote: r.vote,
          confidence,
        };
      });
    };

    if (month !== undefined && year !== undefined) {
      // A month/year named in the query (e.g. "in June 2026") NARROWS the candidate set
      // to that exact month rather than being ignored - previously this date info never
      // reached findCouncillorVote at all because Strategy 1 in rag-service.ts
      // intercepted any month/year query before the structured vote lookup ran.
      const narrowedVotes = voteFile.votes.filter(v => {
        const d = new Date(v.date);
        return d.getUTCMonth() === month && d.getUTCFullYear() === year;
      });
      const narrowedResult = buildResult(narrowedVotes, search(narrowedVotes), false);
      if (narrowedResult) return narrowedResult;

      // The named month is a HARD FILTER with no fallback used to mean: if the user
      // misremembers the month, or names a committee month when the item was ratified
      // by full Council the following month, the search comes back empty (or, worse,
      // an item-title anchor with no real candidate in scope could still coincidentally
      // clear the gates on an unrelated record). Fall back to an unnarrowed search
      // rather than giving up - this is common enough (committee vs Council month,
      // simple misremembering) to be worth a wider retry, at reduced confidence.
      console.log(`   Vote lookup: nothing in ${month + 1}/${year} for ${councillorSlug} on "${topicKeywords.join(' ')}" - falling back to unnarrowed search`);
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths);
      const fallbackVotes = voteFile.votes.filter(v => new Date(v.date) >= cutoffDate);
      const fallbackResult = buildResult(fallbackVotes, search(fallbackVotes), true);
      if (!fallbackResult) {
        console.log(`   Vote lookup: No matching vote for ${councillorSlug} on "${topicKeywords.join(' ')}" (no item-title-anchored match above floor, with or without month narrowing)`);
      }
      return fallbackResult;
    }

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths);
    const candidateVotes = voteFile.votes.filter(v => new Date(v.date) >= cutoffDate);
    const result = buildResult(candidateVotes, search(candidateVotes), false);
    if (!result) {
      console.log(`   Vote lookup: No matching vote for ${councillorSlug} on "${topicKeywords.join(' ')}" (no item-title-anchored match above floor)`);
    }
    return result;
  }

  /**
   * Find all councillors who voted on a specific motion
   *
   * @param topicKeywords - keywords to match against motion/item title
   * @param recentMonths - only look at votes from last N months
   */
  findMotionVotes(
    topicKeywords: string[],
    recentMonths: number = 24
  ): MotionVotesResult | null {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths);

    const slugs = getAllCouncillorSlugs();

    // First, find the best matching motion across all councillors
    let bestMotion: { date: string; itemTitle: string; motionText: string; meetingTitle: string } | null = null;
    let bestScore = 0;

    for (const slug of slugs) {
      const voteFile = loadCouncillorVotes(slug);
      if (!voteFile) continue;

      for (const vote of voteFile.votes) {
        if (new Date(vote.date) < cutoffDate) continue;

        const searchText = `${vote.itemTitle} ${vote.motionText}`;
        const score = calculateMatchScore(searchText, topicKeywords);

        if (score > bestScore) {
          bestScore = score;
          bestMotion = {
            date: vote.date,
            itemTitle: vote.itemTitle,
            motionText: vote.motionText,
            meetingTitle: vote.meetingTitle,
          };
        }
      }
    }

    if (!bestMotion || bestScore < 0.3) {
      console.log(`   Motion lookup: No matching motion for "${topicKeywords.join(' ')}"`);
      return null;
    }

    console.log(`   Motion lookup: Found motion "${bestMotion.itemTitle}" (score: ${bestScore.toFixed(2)})`);

    // Now collect all votes on this specific motion
    const yeas: string[] = [];
    const nays: string[] = [];
    const absent: string[] = [];
    const recused: string[] = [];
    const abstained: string[] = [];
    const other: string[] = [];
    let result = '';
    let passed = false;

    for (const slug of slugs) {
      const voteFile = loadCouncillorVotes(slug);
      if (!voteFile) continue;

      // Find the matching vote for this councillor
      const matchingVote = voteFile.votes.find(
        v => v.date === bestMotion!.date &&
          v.itemTitle === bestMotion!.itemTitle &&
          v.motionText === bestMotion!.motionText
      );

      if (matchingVote) {
        result = matchingVote.result;
        passed = matchingVote.passed;

        // NOTE: every branch is explicit (no fallthrough default bucket) so a
        // recusal/abstention/unrecognized label is never silently counted as
        // "absent" - that conflated an ethical/legal recusal with a no-show.
        switch (matchingVote.vote) {
          case 'yea':
            yeas.push(voteFile.councillor);
            break;
          case 'nay':
            nays.push(voteFile.councillor);
            break;
          case 'absent':
            absent.push(voteFile.councillor);
            break;
          case 'recuse':
            recused.push(voteFile.councillor);
            break;
          case 'abstain':
            abstained.push(voteFile.councillor);
            break;
          default:
            other.push(voteFile.councillor);
            break;
        }
      }
    }

    return {
      motionTitle: bestMotion.itemTitle,
      motionText: bestMotion.motionText,
      date: bestMotion.date,
      meetingTitle: bestMotion.meetingTitle,
      result,
      passed,
      yeas,
      nays,
      absent,
      recused,
      abstained,
      other,
    };
  }

  /**
   * Find ALL motions matching keywords (returns multiple when same item has original + alternative)
   * This fixes the bug where only one motion is returned for items like OEV BIA
   * which had an original motion (failed 5-8) AND an alternative (passed 10-3).
   */
  findAllMotionVotes(
    topicKeywords: string[],
    recentMonths: number = 24
  ): MotionVotesResult[] {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths);

    const slugs = getAllCouncillorSlugs();

    // Collect all matching motions above threshold, keyed by (date, itemTitle, motionText)
    const motionMap = new Map<string, { date: string; itemTitle: string; motionText: string; meetingTitle: string; score: number }>();

    for (const slug of slugs) {
      const voteFile = loadCouncillorVotes(slug);
      if (!voteFile) continue;

      for (const vote of voteFile.votes) {
        if (new Date(vote.date) < cutoffDate) continue;

        const searchText = `${vote.itemTitle} ${vote.motionText}`;
        const score = calculateMatchScore(searchText, topicKeywords);

        if (score >= 0.3) {
          const key = `${vote.date}|${vote.itemTitle}|${vote.motionText}`;
          if (!motionMap.has(key)) {
            motionMap.set(key, {
              date: vote.date,
              itemTitle: vote.itemTitle,
              motionText: vote.motionText,
              meetingTitle: vote.meetingTitle,
              score,
            });
          }
        }
      }
    }

    if (motionMap.size === 0) return [];

    // Sort by score descending, then collect vote details for each motion
    const sortedMotions = Array.from(motionMap.values()).sort((a, b) => b.score - a.score);

    // Group motions by itemTitle (same agenda item = original + alternatives)
    const bestItemTitle = sortedMotions[0].itemTitle;
    const relatedMotions = sortedMotions.filter(m =>
      m.itemTitle === bestItemTitle && m.date === sortedMotions[0].date
    );

    console.log(`   Motion lookup: Found ${relatedMotions.length} motion(s) on "${bestItemTitle}"`);

    const results: MotionVotesResult[] = [];
    for (const motion of relatedMotions) {
      const yeas: string[] = [];
      const nays: string[] = [];
      const absent: string[] = [];
      const recused: string[] = [];
      const abstained: string[] = [];
      const other: string[] = [];
      let result = '';
      let passed = false;

      for (const slug of slugs) {
        const voteFile = loadCouncillorVotes(slug);
        if (!voteFile) continue;

        const matchingVote = voteFile.votes.find(
          v => v.date === motion.date &&
            v.itemTitle === motion.itemTitle &&
            v.motionText === motion.motionText
        );

        if (matchingVote) {
          result = matchingVote.result;
          passed = matchingVote.passed;
          // No fallthrough default to "absent" - see findMotionVotes above.
          switch (matchingVote.vote) {
            case 'yea': yeas.push(voteFile.councillor); break;
            case 'nay': nays.push(voteFile.councillor); break;
            case 'absent': absent.push(voteFile.councillor); break;
            case 'recuse': recused.push(voteFile.councillor); break;
            case 'abstain': abstained.push(voteFile.councillor); break;
            default: other.push(voteFile.councillor); break;
          }
        }
      }

      results.push({
        motionTitle: motion.itemTitle,
        motionText: motion.motionText,
        date: motion.date,
        meetingTitle: motion.meetingTitle,
        result,
        passed,
        yeas,
        nays,
        absent,
        recused,
        abstained,
        other,
      });
    }

    // Sort: failed motions first (original typically fails, then alternative passes)
    results.sort((a, b) => {
      if (a.passed === b.passed) return 0;
      return a.passed ? 1 : -1; // failed first
    });

    return results;
  }

  /**
   * Format multiple motion votes for context (original + alternatives)
   */
  formatAllMotionVotesForContext(results: MotionVotesResult[]): string {
    if (results.length === 0) return '';
    if (results.length === 1) return this.formatMotionVotesForContext(results[0]);

    let context = `## VERIFIED VOTE DATA: Multiple motions on same item (from structured data - USE THIS)\n`;
    context += `⚠️ There were ${results.length} separate votes on this item. The FIRST is the original motion, subsequent ones are alternatives/amendments.\n\n`;

    results.forEach((r, i) => {
      const label = i === 0 ? 'ORIGINAL MOTION' : `ALTERNATIVE MOTION #${i}`;
      const outcomeWord = r.passed ? 'PASSED' : 'FAILED';
      context += `### ${label}\n`;
      context += `**Motion:** ${r.motionTitle}\n`;
      if (r.motionText) context += `${motionTextLabel(r.motionText)} ${r.motionText}\n`;
      context += `**Date:** ${r.date}\n`;
      context += `**Meeting:** ${r.meetingTitle}\n`;
      context += `**Outcome:** ${outcomeWord} - ${r.result}\n`;
      context += `**Voted YEA (${r.yeas.length}):** ${r.yeas.join(', ')}\n`;
      context += `**Voted NAY (${r.nays.length}):** ${r.nays.join(', ')}\n`;
      context += `**Absent (${r.absent.length}):** ${r.absent.join(', ')}\n`;
      context += formatNonAbsentNonVoteLines(r);
      context += `\n`;
    });

    context += `⚠️ When the user asks about the "original" motion, refer to the FIRST vote above. The alternative motions came later.\n`;
    return context;
  }

  /**
   * Get a councillor's voting summary
   */
  getCouncillorSummary(councillorSlug: string): CouncillorVoteFile['summary'] | null {
    const voteFile = loadCouncillorVotes(councillorSlug);
    return voteFile?.summary || null;
  }

  /**
   * Find close votes on a specific date
   * Close votes are defined as votes with a margin of 3 or less (e.g., 7-8, 6-9, etc.)
   *
   * @param date - Date in YYYY-MM-DD format
   * @param maxMargin - Maximum margin to consider "close" (default: 3)
   */
  findCloseVotesByDate(date: string, maxMargin: number = 3): CloseVoteResult[] {
    const slugs = getAllCouncillorSlugs();

    // Build a map of unique votes on this date
    const voteMap = new Map<string, {
      itemTitle: string;
      motionText: string;
      meetingTitle: string;
      result: string;
      passed: boolean;
      yeas: string[];
      nays: string[];
    }>();

    for (const slug of slugs) {
      const voteFile = loadCouncillorVotes(slug);
      if (!voteFile) continue;

      for (const vote of voteFile.votes) {
        if (vote.date !== date) continue;

        // Create unique key for this vote
        const key = `${vote.itemTitle}|${vote.motionText.slice(0, 100)}`;

        if (!voteMap.has(key)) {
          voteMap.set(key, {
            itemTitle: vote.itemTitle,
            motionText: vote.motionText,
            meetingTitle: vote.meetingTitle,
            result: vote.result,
            passed: vote.passed,
            yeas: [],
            nays: [],
          });
        }

        const entry = voteMap.get(key)!;
        if (vote.vote === 'yea') {
          entry.yeas.push(voteFile.councillor);
        } else if (vote.vote === 'nay') {
          entry.nays.push(voteFile.councillor);
        }
      }
    }

    // Filter to close votes only
    const closeVotes: CloseVoteResult[] = [];

    for (const vote of voteMap.values()) {
      const margin = Math.abs(vote.yeas.length - vote.nays.length);
      const totalVotes = vote.yeas.length + vote.nays.length;

      // Only include if margin is small AND enough councillors voted
      if (margin <= maxMargin && totalVotes >= 10) {
        closeVotes.push({
          date,
          itemTitle: vote.itemTitle,
          motionText: vote.motionText,
          meetingTitle: vote.meetingTitle,
          result: vote.result,
          passed: vote.passed,
          yeas: vote.yeas,
          nays: vote.nays,
          margin,
        });
      }
    }

    // Sort by margin (closest first), then by item title
    return closeVotes.sort((a, b) => a.margin - b.margin || a.itemTitle.localeCompare(b.itemTitle));
  }

  /**
   * Find all close votes across all dates (for general "what divides council" queries)
   * Returns the closest/most contentious votes
   *
   * @param maxMargin - Maximum margin to consider "close" (default: 2 for very close votes)
   * @param limit - Maximum number of results (default: 10)
   * @param recentMonths - Only look at votes from last N months (default: 12)
   */
  findAllCloseVotes(maxMargin: number = 2, limit: number = 10, recentMonths: number = 12): CloseVoteResult[] {
    const slugs = getAllCouncillorSlugs();
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths);

    // Build a map of unique votes
    const voteMap = new Map<string, {
      date: string;
      itemTitle: string;
      motionText: string;
      meetingTitle: string;
      result: string;
      passed: boolean;
      yeas: string[];
      nays: string[];
    }>();

    for (const slug of slugs) {
      const voteFile = loadCouncillorVotes(slug);
      if (!voteFile) continue;

      for (const vote of voteFile.votes) {
        if (new Date(vote.date) < cutoffDate) continue;

        // Create unique key for this vote
        const key = `${vote.date}|${vote.itemTitle}|${vote.motionText.slice(0, 100)}`;

        if (!voteMap.has(key)) {
          voteMap.set(key, {
            date: vote.date,
            itemTitle: vote.itemTitle,
            motionText: vote.motionText,
            meetingTitle: vote.meetingTitle,
            result: vote.result,
            passed: vote.passed,
            yeas: [],
            nays: [],
          });
        }

        const entry = voteMap.get(key)!;
        if (vote.vote === 'yea') {
          entry.yeas.push(voteFile.councillor);
        } else if (vote.vote === 'nay') {
          entry.nays.push(voteFile.councillor);
        }
      }
    }

    // Filter to close votes only
    const closeVotes: CloseVoteResult[] = [];

    for (const vote of voteMap.values()) {
      const margin = Math.abs(vote.yeas.length - vote.nays.length);
      const totalVotes = vote.yeas.length + vote.nays.length;

      // Only include if margin is small AND enough councillors voted
      if (margin <= maxMargin && totalVotes >= 10) {
        closeVotes.push({
          date: vote.date,
          itemTitle: vote.itemTitle,
          motionText: vote.motionText,
          meetingTitle: vote.meetingTitle,
          result: vote.result,
          passed: vote.passed,
          yeas: vote.yeas,
          nays: vote.nays,
          margin,
        });
      }
    }

    // Sort by margin (closest first), then by date (most recent first)
    return closeVotes
      .sort((a, b) => a.margin - b.margin || new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);
  }

  /**
   * Format close votes for LLM context
   */
  formatCloseVotesForContext(votes: CloseVoteResult[]): string {
    if (votes.length === 0) {
      return '';
    }

    const sections = votes.map(v => {
      const outcomeWord = v.passed ? 'PASSED' : 'FAILED';
      return `
### ${v.itemTitle}
**Date:** ${v.date}
**Result:** ${outcomeWord} (${v.yeas.length}-${v.nays.length})
**Margin:** ${v.margin} vote${v.margin !== 1 ? 's' : ''}
**Voted YEA:** ${v.yeas.join(', ') || 'None'}
**Voted NAY:** ${v.nays.join(', ') || 'None'}`;
    });

    return `
## VERIFIED CLOSE VOTES (from structured data - USE THIS)
The following votes had a margin of 3 or less:
${sections.join('\n')}

⚠️ This is verified structured data. Use these exact details in your response.
`;
  }

  /**
   * Find votes where the Mayor (Morgan) was in the minority
   * i.e., voted NAY on passing motions or YEA on failing motions
   */
  findVotesWhereMayorInMinority(limit: number = 5, recentMonths: number = 24): CloseVoteResult[] {
    const slugs = getAllCouncillorSlugs();
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths);

    // Build a map of unique votes
    const voteMap = new Map<string, {
      date: string;
      itemTitle: string;
      motionText: string;
      meetingTitle: string;
      result: string;
      passed: boolean;
      yeas: string[];
      nays: string[];
      mayorVote: 'yea' | 'nay' | 'absent';
    }>();

    for (const slug of slugs) {
      const voteFile = loadCouncillorVotes(slug);
      if (!voteFile) continue;

      for (const vote of voteFile.votes) {
        if (new Date(vote.date) < cutoffDate) continue;

        const key = `${vote.date}|${vote.itemTitle}|${vote.motionText.slice(0, 100)}`;

        if (!voteMap.has(key)) {
          voteMap.set(key, {
            date: vote.date,
            itemTitle: vote.itemTitle,
            motionText: vote.motionText,
            meetingTitle: vote.meetingTitle,
            result: vote.result,
            passed: vote.passed,
            yeas: [],
            nays: [],
            mayorVote: 'absent',
          });
        }

        const entry = voteMap.get(key)!;
        const councillorName = voteFile.councillor.toLowerCase();

        if (vote.vote === 'yea') {
          entry.yeas.push(voteFile.councillor);
          if (councillorName.includes('morgan') || councillorName.includes('mayor')) {
            entry.mayorVote = 'yea';
          }
        } else if (vote.vote === 'nay') {
          entry.nays.push(voteFile.councillor);
          if (councillorName.includes('morgan') || councillorName.includes('mayor')) {
            entry.mayorVote = 'nay';
          }
        }
      }
    }

    // Filter to votes where Mayor was in minority
    const mayorMinorityVotes: CloseVoteResult[] = [];

    for (const vote of voteMap.values()) {
      const margin = Math.abs(vote.yeas.length - vote.nays.length);
      const totalVotes = vote.yeas.length + vote.nays.length;

      // Mayor in minority if: voted NAY on passing OR voted YEA on failing
      const mayorInMinority =
        (vote.passed && vote.mayorVote === 'nay') ||
        (!vote.passed && vote.mayorVote === 'yea');

      if (mayorInMinority && totalVotes >= 10) {
        mayorMinorityVotes.push({
          date: vote.date,
          itemTitle: vote.itemTitle,
          motionText: vote.motionText,
          meetingTitle: vote.meetingTitle,
          result: vote.result,
          passed: vote.passed,
          yeas: vote.yeas,
          nays: vote.nays,
          margin,
        });
      }
    }

    // Sort by date (most recent first)
    return mayorMinorityVotes
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);
  }

  /**
   * Format Mayor-minority votes for LLM context
   */
  formatMayorMinorityVotesForContext(votes: CloseVoteResult[]): string {
    if (votes.length === 0) {
      return '';
    }

    const sections = votes.map(v => {
      const outcomeWord = v.passed ? 'PASSED' : 'FAILED';
      const mayorPosition = v.passed ? 'voted NAY (against)' : 'voted YEA (for)';
      return `
### ${v.itemTitle}
**Date:** ${v.date}
**Result:** ${outcomeWord} (${v.yeas.length}-${v.nays.length})
**Mayor Morgan ${mayorPosition}** - was in the MINORITY
**Voted YEA:** ${v.yeas.join(', ') || 'None'}
**Voted NAY:** ${v.nays.join(', ') || 'None'}`;
    });

    return `
## VERIFIED VOTES WHERE MAYOR WAS IN MINORITY (from structured data - USE THIS)
${sections.join('\n')}

⚠️ This is verified structured data. Use these exact details in your response.
`;
  }

  /**
   * Find votes by searching motion text content
   * Useful for finding specific motions like "PA Day motion"
   *
   * @param searchTerms - Keywords to search for in motion text
   * @param recentMonths - Only look at votes from last N months (default: 24)
   */
  findVoteByMotionContent(searchTerms: string[], recentMonths: number = 24): MotionVotesResult | null {
    const slugs = getAllCouncillorSlugs();
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths);

    // Build a map of unique votes matching the search terms
    const voteMap = new Map<string, {
      date: string;
      itemTitle: string;
      motionText: string;
      meetingTitle: string;
      result: string;
      passed: boolean;
      yeas: string[];
      nays: string[];
      absent: string[];
      recused: string[];
      abstained: string[];
      other: string[];
      matchScore: number;
    }>();

    for (const slug of slugs) {
      const voteFile = loadCouncillorVotes(slug);
      if (!voteFile) continue;

      for (const vote of voteFile.votes) {
        // Check date is recent enough
        const voteDate = new Date(vote.date);
        if (voteDate < cutoffDate) continue;

        // Check if motion matches search terms
        const textToSearch = `${vote.itemTitle} ${vote.motionText}`.toLowerCase();
        const matchScore = searchTerms.filter(term => textToSearch.includes(term.toLowerCase())).length;

        if (matchScore === 0) continue;

        // Create unique key for this vote
        const key = `${vote.date}|${vote.itemTitle}|${vote.motionText.slice(0, 100)}`;

        if (!voteMap.has(key)) {
          voteMap.set(key, {
            date: vote.date,
            itemTitle: vote.itemTitle,
            motionText: vote.motionText,
            meetingTitle: vote.meetingTitle,
            result: vote.result,
            passed: vote.passed,
            yeas: [],
            nays: [],
            absent: [],
            recused: [],
            abstained: [],
            other: [],
            matchScore,
          });
        }

        const entry = voteMap.get(key)!;
        // BUG FIX: this used to have a catch-all `else` that pushed every
        // non-yea/non-nay vote (recuse, abstain, unrecognized labels) into
        // `absent`, mislabeling pecuniary-interest recusals as no-shows.
        // Every category is now explicit.
        if (vote.vote === 'yea') {
          entry.yeas.push(voteFile.councillor);
        } else if (vote.vote === 'nay') {
          entry.nays.push(voteFile.councillor);
        } else if (vote.vote === 'absent') {
          entry.absent.push(voteFile.councillor);
        } else if (vote.vote === 'recuse') {
          entry.recused.push(voteFile.councillor);
        } else if (vote.vote === 'abstain') {
          entry.abstained.push(voteFile.councillor);
        } else {
          entry.other.push(voteFile.councillor);
        }
      }
    }

    // Find the best match (highest score, most recent)
    let bestMatch: {
      date: string;
      itemTitle: string;
      motionText: string;
      meetingTitle: string;
      result: string;
      passed: boolean;
      yeas: string[];
      nays: string[];
      absent: string[];
      recused: string[];
      abstained: string[];
      other: string[];
      matchScore: number;
    } | null = null;
    let bestScore = 0;
    let bestDate = '';

    for (const vote of voteMap.values()) {
      if (vote.matchScore > bestScore || (vote.matchScore === bestScore && vote.date > bestDate)) {
        bestMatch = vote;
        bestScore = vote.matchScore;
        bestDate = vote.date;
      }
    }

    if (!bestMatch) return null;

    return {
      motionTitle: bestMatch.itemTitle,
      motionText: bestMatch.motionText,
      date: bestMatch.date,
      meetingTitle: bestMatch.meetingTitle,
      result: bestMatch.result,
      passed: bestMatch.passed,
      yeas: bestMatch.yeas,
      nays: bestMatch.nays,
      absent: bestMatch.absent,
      recused: bestMatch.recused,
      abstained: bestMatch.abstained,
      other: bestMatch.other,
    };
  }

  /**
   * Format a vote lookup result for inclusion in LLM context
   * This provides VERIFIED data that the LLM should use directly
   */
  formatVoteForContext(result: VoteLookupResult): string {
    const v = result.vote;
    // BUG FIX: this used to default anything that wasn't 'yea'/'nay' to
    // 'ABSENT', which mislabeled recusals/abstentions/unrecognized rows as
    // no-shows. voteTypeLabel() gives each category its own honest wording.
    const voteWord = voteTypeLabel(v.vote);
    const outcomeWord = v.passed ? 'PASSED' : 'FAILED';

    const lines = [
      '## VERIFIED VOTE RECORD (from structured data - USE THIS)',
      `**Councillor:** ${result.councillor}`,
      `**Motion:** ${v.itemTitle}`,
      ...(v.motionText ? [`${motionTextLabel(v.motionText)} ${v.motionText}`] : []),
      `**Date:** ${v.date}`,
      `**Meeting:** ${v.meetingTitle}`,
      `**Vote:** ${voteWord}`,
      `**Outcome:** ${outcomeWord} - ${v.result}`,
      `**Match Confidence:** ${result.confidence}`,
      '',
      '⚠️ This is verified structured data. Use these exact details in your response. When reporting this vote, include a plain-language summary of what was being voted on.',
    ];

    return '\n' + lines.join('\n') + '\n';
  }

  /**
   * Format the result of findCouncillorVote (which can be one or several recorded
   * motions on the same agenda item) for inclusion in LLM context. Single-result case
   * delegates to formatVoteForContext for identical output/backward compatibility;
   * multi-result case labels each motion separately and warns against blending tallies,
   * mirroring formatAllMotionVotesForContext.
   */
  formatVoteResultsForContext(results: VoteLookupResult[]): string {
    if (results.length === 0) return '';
    if (results.length === 1) return this.formatVoteForContext(results[0]);

    const councillor = results[0].councillor;
    // Motions are listed in their original recorded order (part a/b/c, or
    // original-then-amendment), NOT sorted by match score - see findCouncillorVote.
    // When the group mixes passed and failed motions, mark which one(s) actually took
    // effect ("operative") so the LLM doesn't have to guess which tally answers a
    // question about the item's real-world outcome.
    const mixedOutcomes = results.some(r => r.vote.passed) && results.some(r => !r.vote.passed);
    let context = `## VERIFIED VOTE RECORD: Multiple motions on this item (from structured data - USE THIS)\n`;
    context += `⚠️ There were ${results.length} separate recorded motions on this single agenda item for ${councillor}, listed in their original recorded order. Each is a DIFFERENT motion with its own tally. Do not merge or swap their outcomes.\n\n`;

    results.forEach((result, i) => {
      const v = result.vote;
      const voteWord = voteTypeLabel(v.vote);
      const outcomeWord = v.passed ? 'PASSED' : 'FAILED';
      const operativeTag = mixedOutcomes && v.passed ? ' ⭐ OPERATIVE (this is the motion that took effect)' : '';
      context += `### Motion ${i + 1} of ${results.length}\n`;
      context += `**Item:** ${v.itemTitle}\n`;
      if (v.motionText) context += `${motionTextLabel(v.motionText)} ${v.motionText}\n`;
      context += `**Date:** ${v.date}\n`;
      context += `**Meeting:** ${v.meetingTitle}\n`;
      context += `**${councillor}'s Vote:** ${voteWord}\n`;
      context += `**Outcome:** ${outcomeWord} - ${v.result}${operativeTag}\n`;
      context += `**Match Confidence:** ${result.confidence}\n\n`;
    });

    context += `⚠️ This is verified structured data. Use these exact details in your response. Never attribute one of these motions' tally to a different one - if the user asked about a specific part of this item, cite only that motion's result.\n`;
    return context;
  }

  /**
   * Format a motion votes result for inclusion in LLM context
   */
  formatMotionVotesForContext(result: MotionVotesResult): string {
    const outcomeWord = result.passed ? 'PASSED' : 'FAILED';

    const lines = [
      '## VERIFIED VOTE BREAKDOWN (from structured data - USE THIS)',
      `**Motion:** ${result.motionTitle}`,
      ...(result.motionText ? [`${motionTextLabel(result.motionText)} ${result.motionText}`] : []),
      `**Date:** ${result.date}`,
      `**Meeting:** ${result.meetingTitle}`,
      `**Outcome:** ${outcomeWord} - ${result.result}`,
      '',
      `**Voted YEA (${result.yeas.length}):** ${result.yeas.join(', ') || 'None'}`,
      `**Voted NAY (${result.nays.length}):** ${result.nays.join(', ') || 'None'}`,
      `**Absent (${result.absent.length}):** ${result.absent.join(', ') || 'None'}`,
      ...(result.recused.length > 0
        ? [`**Recused - declared conflict of interest (${result.recused.length}):** ${result.recused.join(', ')}`]
        : []),
      ...(result.abstained.length > 0
        ? [`**Abstained (${result.abstained.length}):** ${result.abstained.join(', ')}`]
        : []),
      ...(result.other.length > 0
        ? [`**Other/unrecorded vote (${result.other.length}):** ${result.other.join(', ')}`]
        : []),
      '',
      '⚠️ This is verified structured data. Use these exact details in your response. When reporting this vote, include the motion text so users understand what was decided.',
      '⚠️ A councillor who RECUSED declared a conflict of interest and stepped out - this is an ethical/legal act, NOT the same as being absent. Never describe a recusal as an absence.',
    ];

    return '\n' + lines.join('\n') + '\n';
  }
}

// Singleton instance
export const voteLookupService = new VoteLookupService();
