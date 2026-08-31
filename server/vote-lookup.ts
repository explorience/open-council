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
   * @param topicKeywords - keywords to match against motion/item title
   * @param options.recentMonths - only look at votes from last N months (default: 24),
   *   ignored when month/year is given
   * @param options.month - 0-indexed month to narrow to (e.g. from "in June 2026")
   * @param options.year - year to narrow to, paired with options.month
   */
  findCouncillorVote(
    councillorSlug: string,
    topicKeywords: string[],
    options: { recentMonths?: number; month?: number; year?: number } = {}
  ): VoteLookupResult[] | null {
    const { recentMonths = 24, month, year } = options;
    const voteFile = loadCouncillorVotes(councillorSlug);
    if (!voteFile) {
      console.log(`   Vote lookup: No data for councillor ${councillorSlug}`);
      return null;
    }

    // A month/year named in the query (e.g. "in June 2026") NARROWS the candidate set
    // to that exact month rather than being ignored - previously this date info never
    // reached findCouncillorVote at all because Strategy 1 in rag-service.ts intercepted
    // any month/year query before the structured vote lookup ran.
    let candidateVotes: VoteRecord[];
    if (month !== undefined && year !== undefined) {
      candidateVotes = voteFile.votes.filter(v => {
        const d = new Date(v.date);
        return d.getUTCMonth() === month && d.getUTCFullYear() === year;
      });
    } else {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths);
      candidateVotes = voteFile.votes.filter(v => new Date(v.date) >= cutoffDate);
    }

    const meaningfulKeywords = significantKeywords(topicKeywords);
    const requiredMatches = Math.min(2, meaningfulKeywords.length || 1);

    const scored: Array<{ vote: VoteRecord; score: number; matches: number }> = [];
    for (const vote of candidateVotes) {
      const itemTitleNorm = normalizeForMatch(vote.itemTitle);
      const itemTitleAnchored = meaningfulKeywords.some(kw => itemTitleNorm.includes(normalizeForMatch(kw)));
      if (!itemTitleAnchored) continue;

      const searchText = `${vote.itemTitle} ${vote.motionText}`;
      const detail = calculateMatchDetail(searchText, topicKeywords);
      if (detail.score >= 0.3 && detail.matches >= requiredMatches) {
        scored.push({ vote, score: detail.score, matches: detail.matches });
      }
    }

    if (scored.length === 0) {
      console.log(`   Vote lookup: No matching vote for ${councillorSlug} on "${topicKeywords.join(' ')}" (no item-title-anchored match above floor)`);
      return null;
    }

    scored.sort((a, b) => b.score - a.score);

    // Group: return every motion recorded on the single best-matching (date, itemTitle).
    const best = scored[0];
    const related = scored.filter(
      s => s.vote.itemTitle === best.vote.itemTitle && s.vote.date === best.vote.date
    );

    return related.map(r => {
      const confidence: VoteLookupResult['confidence'] = r.score >= 0.8 ? 'exact' : r.score >= 0.5 ? 'high' : 'medium';
      console.log(`   Vote lookup: Found ${confidence} match for ${councillorSlug} (score: ${r.score.toFixed(2)}, item: "${r.vote.itemTitle}")`);
      return {
        councillor: voteFile.councillor,
        councillorSlug: voteFile.slug,
        vote: r.vote,
        confidence,
      };
    });
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
    let context = `## VERIFIED VOTE RECORD: Multiple motions on this item (from structured data - USE THIS)\n`;
    context += `⚠️ There were ${results.length} separate recorded motions on this single agenda item for ${councillor}. Each is listed separately below - they are DIFFERENT motions with their own tallies. Do not merge or swap their outcomes.\n\n`;

    results.forEach((result, i) => {
      const v = result.vote;
      const voteWord = voteTypeLabel(v.vote);
      const outcomeWord = v.passed ? 'PASSED' : 'FAILED';
      context += `### Motion ${i + 1} of ${results.length}\n`;
      context += `**Item:** ${v.itemTitle}\n`;
      if (v.motionText) context += `${motionTextLabel(v.motionText)} ${v.motionText}\n`;
      context += `**Date:** ${v.date}\n`;
      context += `**Meeting:** ${v.meetingTitle}\n`;
      context += `**${councillor}'s Vote:** ${voteWord}\n`;
      context += `**Outcome:** ${outcomeWord} - ${v.result}\n`;
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
