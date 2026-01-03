/**
 * Vote Query Engine - Structured queries for multi-hop vote lookups
 *
 * Instead of relying on RAG for complex vote cross-referencing,
 * this engine directly queries the structured vote JSON files.
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

// Types
interface VoteRecord {
  date: string;
  meetingSlug: string;
  meetingTitle: string;
  meetingType: string;
  itemNumber: string;
  itemTitle: string;
  motionText: string;
  vote: 'yea' | 'nay' | 'absent';
  result: string;
  passed: boolean;
  unanimous: boolean;
}

interface CouncillorVotes {
  councillor: string;
  slug: string;
  votes: VoteRecord[];
}

export interface VoteCriterion {
  motionKeywords: string[];  // Keywords to match in itemTitle or motionText
  voteType: 'yea' | 'nay' | 'any';
  dateRange?: {
    start?: string;  // YYYY-MM-DD
    end?: string;
  };
}

export interface MultiHopQuery {
  isMultiHop: boolean;
  criteria: VoteCriterion[];
  operation: 'intersection' | 'union';  // AND vs OR
}

export interface VoteMatch {
  councillor: string;
  slug: string;
  matchedVotes: Array<{
    criterion: number;  // Which criterion this matched
    vote: VoteRecord;
  }>;
}

export interface MultiHopResult {
  success: boolean;
  councillors: string[];
  matches: VoteMatch[];
  summary: string;
}

// Cache for loaded vote data
let voteCache: Map<string, CouncillorVotes> | null = null;

/**
 * Load all councillor vote files
 */
async function loadAllVotes(votesDir: string): Promise<Map<string, CouncillorVotes>> {
  if (voteCache) return voteCache;

  const cache = new Map<string, CouncillorVotes>();
  const files = await readdir(votesDir);

  for (const file of files) {
    if (!file.endsWith('.json') || file === '_meta.json') continue;

    try {
      const content = await readFile(join(votesDir, file), 'utf-8');
      const data = JSON.parse(content) as CouncillorVotes;
      cache.set(data.slug, data);
    } catch (error) {
      console.error(`Error loading vote file ${file}:`, error);
    }
  }

  voteCache = cache;
  console.log(`📊 Vote Query Engine: Loaded ${cache.size} councillor vote files`);
  return cache;
}

/**
 * Check if a vote matches a criterion
 * Returns a score: 0 = no match, 1 = motionText match only, 2 = title match
 */
function voteMatchScore(vote: VoteRecord, criterion: VoteCriterion): number {
  // Check vote type
  if (criterion.voteType !== 'any' && vote.vote !== criterion.voteType) {
    return 0;
  }

  // Check date range
  if (criterion.dateRange) {
    const voteDate = vote.date;
    if (criterion.dateRange.start && voteDate < criterion.dateRange.start) return 0;
    if (criterion.dateRange.end && voteDate > criterion.dateRange.end) return 0;
  }

  // Normalize helper
  const normalize = (text: string) => text.toLowerCase().replace(/-/g, '').replace(/\s+/g, ' ');

  // Check if ALL keywords match in title (stronger match)
  const titleText = normalize(vote.itemTitle);
  const titleMatch = criterion.motionKeywords.every(keyword =>
    titleText.includes(normalize(keyword))
  );
  if (titleMatch) return 2;

  // Check if ALL keywords match in motionText (weaker match)
  const motionText = normalize(vote.motionText);
  const motionMatch = criterion.motionKeywords.every(keyword =>
    motionText.includes(normalize(keyword))
  );
  if (motionMatch) return 1;

  return 0;
}

/**
 * Check if a vote matches a criterion (boolean)
 */
function voteMatchesCriterion(vote: VoteRecord, criterion: VoteCriterion): boolean {
  return voteMatchScore(vote, criterion) > 0;
}

/**
 * Find all votes matching a criterion for a councillor
 */
function findMatchingVotes(
  councillorVotes: CouncillorVotes,
  criterion: VoteCriterion
): VoteRecord[] {
  return councillorVotes.votes.filter(vote => voteMatchesCriterion(vote, criterion));
}

/**
 * Execute a multi-hop vote query
 */
export async function executeMultiHopQuery(
  query: MultiHopQuery,
  votesDir: string = join(process.cwd(), 'data', 'votes')
): Promise<MultiHopResult> {
  if (!query.isMultiHop || query.criteria.length === 0) {
    return {
      success: false,
      councillors: [],
      matches: [],
      summary: 'Not a valid multi-hop query',
    };
  }

  const allVotes = await loadAllVotes(votesDir);
  const matches: VoteMatch[] = [];

  // For each councillor, check if they match all criteria (intersection) or any (union)
  for (const [slug, councillorVotes] of allVotes) {
    const matchedVotes: VoteMatch['matchedVotes'] = [];

    for (let i = 0; i < query.criteria.length; i++) {
      const criterion = query.criteria[i];
      const votesMatchingCriterion = findMatchingVotes(councillorVotes, criterion);

      if (votesMatchingCriterion.length > 0) {
        // Sort by match quality (title match > motionText match), then by date
        const sortedVotes = votesMatchingCriterion.sort((a, b) => {
          const scoreA = voteMatchScore(a, criterion);
          const scoreB = voteMatchScore(b, criterion);
          if (scoreB !== scoreA) return scoreB - scoreA;  // Higher score first
          return b.date.localeCompare(a.date);  // Then most recent
        });
        matchedVotes.push({
          criterion: i,
          vote: sortedVotes[0],
        });
      }
    }

    // Check if councillor matches based on operation
    const criteriaMatched = new Set(matchedVotes.map(m => m.criterion));

    if (query.operation === 'intersection') {
      // Must match ALL criteria
      if (criteriaMatched.size === query.criteria.length) {
        matches.push({
          councillor: councillorVotes.councillor,
          slug,
          matchedVotes,
        });
      }
    } else {
      // Union: match ANY criterion
      if (matchedVotes.length > 0) {
        matches.push({
          councillor: councillorVotes.councillor,
          slug,
          matchedVotes,
        });
      }
    }
  }

  // Generate summary
  const councillorNames = matches.map(m => m.councillor);
  let summary: string;

  if (matches.length === 0) {
    summary = 'No councillors matched all the specified voting criteria.';
  } else if (query.operation === 'intersection') {
    summary = `Found ${matches.length} councillor(s) who matched ALL criteria: ${councillorNames.join(', ')}.`;
  } else {
    summary = `Found ${matches.length} councillor(s) who matched at least one criterion: ${councillorNames.join(', ')}.`;
  }

  return {
    success: matches.length > 0,
    councillors: councillorNames,
    matches,
    summary,
  };
}

/**
 * Detect if a query is a multi-hop vote query and parse it
 */
export function detectMultiHopVoteQuery(query: string): MultiHopQuery {
  const lowerQuery = query.toLowerCase();

  // Three-vote pattern: "voted X on A, Y on B, and Z on C"
  const threeVotePattern = /voted?\s+(yea|nay|yes|no|for|against)\s+on\s+([^,]+),\s+(yea|nay|yes|no|for|against)\s+on\s+([^,]+),\s+and\s+(yea|nay|yes|no|for|against)\s+on\s+(.+)/i;
  const threeVoteMatch = lowerQuery.match(threeVotePattern);
  if (threeVoteMatch) {
    return {
      isMultiHop: true,
      criteria: [
        { motionKeywords: extractKeywords(threeVoteMatch[2]), voteType: normalizeVoteType(threeVoteMatch[1]) },
        { motionKeywords: extractKeywords(threeVoteMatch[4]), voteType: normalizeVoteType(threeVoteMatch[3]) },
        { motionKeywords: extractKeywords(threeVoteMatch[6]), voteType: normalizeVoteType(threeVoteMatch[5]) },
      ],
      operation: 'intersection',
    };
  }

  // Two-vote pattern with "but" or "and": "voted X on A but Y on B"
  const twoVotePattern = /voted?\s+(yea|nay|yes|no|for|against)\s+on\s+(.+?)\s+(but|and)\s+(yea|nay|yes|no|for|against)\s+on\s+(.+?)(?:\?|$)/i;
  const twoVoteMatch = lowerQuery.match(twoVotePattern);
  if (twoVoteMatch) {
    return {
      isMultiHop: true,
      criteria: [
        { motionKeywords: extractKeywords(twoVoteMatch[2]), voteType: normalizeVoteType(twoVoteMatch[1]) },
        { motionKeywords: extractKeywords(twoVoteMatch[5]), voteType: normalizeVoteType(twoVoteMatch[4]) },
      ],
      operation: 'intersection',
    };
  }

  // "voted against both X and Y" pattern
  const bothPattern = /voted?\s+(against|for)\s+both\s+(.+?)\s+and\s+(.+?)(?:\?|$)/i;
  const bothMatch = lowerQuery.match(bothPattern);
  if (bothMatch) {
    const voteType = normalizeVoteType(bothMatch[1]);
    return {
      isMultiHop: true,
      criteria: [
        { motionKeywords: extractKeywords(bothMatch[2]), voteType },
        { motionKeywords: extractKeywords(bothMatch[3]), voteType },
      ],
      operation: 'intersection',
    };
  }

  return { isMultiHop: false, criteria: [], operation: 'intersection' };
}

/**
 * Normalize vote type string to 'yea' | 'nay' | 'any'
 */
function normalizeVoteType(input: string): 'yea' | 'nay' | 'any' {
  const lower = input.toLowerCase().trim();
  if (['yea', 'yes', 'for', 'in favour', 'in favor', 'support'].includes(lower)) {
    return 'yea';
  }
  if (['nay', 'no', 'against', 'oppose', 'opposed'].includes(lower)) {
    return 'nay';
  }
  return 'any';
}

/**
 * Extract keywords from a motion description
 */
function extractKeywords(text: string): string[] {
  // Clean up the text
  let cleaned = text
    .toLowerCase()
    .replace(/[,.]$/, '')  // Remove trailing punctuation
    .replace(/^the\s+/, '')  // Remove leading "the"
    .replace(/\s+motion$/, '')  // Remove trailing "motion"
    .replace(/\s+by-?law$/, ' bylaw')  // Normalize "by-law" to "bylaw"
    .trim();

  // Split into meaningful keywords
  const stopWords = ['the', 'a', 'an', 'on', 'in', 'for', 'to', 'of', 'and', 'or'];
  const words = cleaned.split(/\s+/).filter(w => !stopWords.includes(w) && w.length > 2);

  // Return unique keywords
  return [...new Set(words)];
}

/**
 * Format multi-hop results as context for the LLM
 */
export function formatMultiHopContext(result: MultiHopResult, _query: MultiHopQuery): string {
  if (!result.success) {
    return `[Multi-Hop Vote Query Result]\n${result.summary}`;
  }

  const lines: string[] = [
    '[Multi-Hop Vote Query Result]',
    result.summary,
    '',
    'Evidence:',
  ];

  for (const match of result.matches) {
    lines.push(`\n**${match.councillor}**:`);
    for (const { vote } of match.matchedVotes) {
      lines.push(`  - ${vote.date}: Voted ${vote.vote.toUpperCase()} on "${vote.itemTitle}" (${vote.result})`);
    }
  }

  return lines.join('\n');
}

/**
 * Clear the vote cache (useful for testing or after data updates)
 */
export function clearVoteCache(): void {
  voteCache = null;
}
