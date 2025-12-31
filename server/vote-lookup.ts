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
  vote: 'yea' | 'nay' | 'absent';
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
 */
function containsAllKeywords(text: string, keywords: string[]): boolean {
  const normalized = normalizeForMatch(text);
  return keywords.every(kw => normalized.includes(normalizeForMatch(kw)));
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
   * Find a specific councillor's vote on a topic
   *
   * @param councillorSlug - e.g., "s-stevenson"
   * @param topicKeywords - keywords to match against motion/item title
   * @param recentMonths - only look at votes from last N months (default: 24)
   */
  findCouncillorVote(
    councillorSlug: string,
    topicKeywords: string[],
    recentMonths: number = 24
  ): VoteLookupResult | null {
    const voteFile = loadCouncillorVotes(councillorSlug);
    if (!voteFile) {
      console.log(`   Vote lookup: No data for councillor ${councillorSlug}`);
      return null;
    }

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - recentMonths);

    // Filter to recent votes and find best match
    const recentVotes = voteFile.votes.filter(v => new Date(v.date) >= cutoffDate);

    let bestMatch: VoteRecord | null = null;
    let bestScore = 0;

    for (const vote of recentVotes) {
      // Check both item title and motion text
      const searchText = `${vote.itemTitle} ${vote.motionText}`;
      const score = calculateMatchScore(searchText, topicKeywords);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = vote;
      }
    }

    if (!bestMatch || bestScore < 0.3) {
      console.log(`   Vote lookup: No matching vote for ${councillorSlug} on "${topicKeywords.join(' ')}"`);
      return null;
    }

    const confidence = bestScore >= 0.8 ? 'exact' : bestScore >= 0.5 ? 'high' : 'medium';
    console.log(`   Vote lookup: Found ${confidence} match for ${councillorSlug} (score: ${bestScore.toFixed(2)})`);

    return {
      councillor: voteFile.councillor,
      councillorSlug: voteFile.slug,
      vote: bestMatch,
      confidence,
    };
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
    };
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

    for (const [_, vote] of voteMap) {
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
   * Format a vote lookup result for inclusion in LLM context
   * This provides VERIFIED data that the LLM should use directly
   */
  formatVoteForContext(result: VoteLookupResult): string {
    const v = result.vote;
    const voteWord = v.vote === 'yea' ? 'IN FAVOR (YEA)' : v.vote === 'nay' ? 'AGAINST (NAY)' : 'ABSENT';
    const outcomeWord = v.passed ? 'PASSED' : 'FAILED';

    return `
## VERIFIED VOTE RECORD (from structured data - USE THIS)
**Councillor:** ${result.councillor}
**Motion:** ${v.itemTitle}
**Date:** ${v.date}
**Meeting:** ${v.meetingTitle}
**Vote:** ${voteWord}
**Outcome:** ${outcomeWord} - ${v.result}
**Match Confidence:** ${result.confidence}

⚠️ This is verified structured data. Use these exact details in your response.
`;
  }

  /**
   * Format a motion votes result for inclusion in LLM context
   */
  formatMotionVotesForContext(result: MotionVotesResult): string {
    const outcomeWord = result.passed ? 'PASSED' : 'FAILED';

    return `
## VERIFIED VOTE BREAKDOWN (from structured data - USE THIS)
**Motion:** ${result.motionTitle}
**Date:** ${result.date}
**Meeting:** ${result.meetingTitle}
**Outcome:** ${outcomeWord} - ${result.result}

**Voted YEA (${result.yeas.length}):** ${result.yeas.join(', ') || 'None'}
**Voted NAY (${result.nays.length}):** ${result.nays.join(', ') || 'None'}
**Absent (${result.absent.length}):** ${result.absent.join(', ') || 'None'}

⚠️ This is verified structured data. Use these exact details in your response.
`;
  }
}

// Singleton instance
export const voteLookupService = new VoteLookupService();
