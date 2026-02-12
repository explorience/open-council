/**
 * Councillor Stats Lookup Service
 *
 * Provides access to pre-computed councillor statistics including:
 * - Voting patterns (yea/nay rates)
 * - Alignment scores between councillors
 * - Top/bottom alignments for each councillor
 *
 * Used by the RAG service when detecting alignment/pattern queries.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to stats data files
const STATS_DIR = join(__dirname, '..', 'data', 'stats');

/**
 * Individual councillor stats file structure
 */
interface CouncillorStats {
  councillor: string;
  slug: string;
  attendance: {
    totalMeetings: number;
    present: number;
    absent: number;
    remote: number;
    attendanceRate: number;
    trendDirection?: string;
  };
  voting: {
    totalVotes: number;
    yeas: number;
    nays: number;
    absent: number;
    participationRate: number;
    yeaRate: number;
    contestedDissentRate?: number;
    contestedVotes?: number;
  };
  budgetVoting?: {
    totalBudgetVotes: number;
    budgetYeas: number;
    budgetNays: number;
    budgetAbsent: number;
  };
  notableDissents?: {
    date: string;
    meetingTitle: string;
    itemTitle: string;
    motionText: string;
    vote: string;
    result: string;
    meetingUrl: string;
  }[];
  topAlignments: {
    councillor: string;
    sharedVotes: number;
    agreedVotes: number;
    alignmentRate: number;
  }[];
  bottomAlignments: {
    councillor: string;
    sharedVotes: number;
    agreedVotes: number;
    alignmentRate: number;
  }[];
}

/**
 * Alignment matrix structure
 */
interface AlignmentMatrix {
  generatedAt: string;
  matrix: Record<string, Record<string, number>>;
}

/**
 * Combined councillor stats file
 */
interface CombinedStats {
  generatedAt: string;
  councillorStats: Record<string, CouncillorStats>;
  alignmentMatrix: Record<string, Record<string, number>>;
}

// Cache for loaded data
let alignmentMatrixCache: AlignmentMatrix | null = null;
let combinedStatsCache: CombinedStats | null = null;

/**
 * Load the combined councillor stats file
 */
function loadCombinedStats(): CombinedStats | null {
  if (combinedStatsCache) return combinedStatsCache;

  const filePath = join(STATS_DIR, 'councillor-stats.json');
  if (!existsSync(filePath)) {
    console.log('⚠️ councillor-stats.json not found');
    return null;
  }

  try {
    combinedStatsCache = JSON.parse(readFileSync(filePath, 'utf-8'));
    return combinedStatsCache;
  } catch (error) {
    console.error('Error loading councillor-stats.json:', error);
    return null;
  }
}

/**
 * Load alignment matrix
 */
function loadAlignmentMatrix(): AlignmentMatrix | null {
  if (alignmentMatrixCache) return alignmentMatrixCache;

  const filePath = join(STATS_DIR, 'alignment-matrix.json');
  if (!existsSync(filePath)) {
    console.log('⚠️ alignment-matrix.json not found');
    return null;
  }

  try {
    alignmentMatrixCache = JSON.parse(readFileSync(filePath, 'utf-8'));
    return alignmentMatrixCache;
  } catch (error) {
    console.error('Error loading alignment-matrix.json:', error);
    return null;
  }
}

/**
 * Load individual councillor stats
 */
function loadCouncillorStats(slug: string): CouncillorStats | null {
  // Try combined file first
  const combined = loadCombinedStats();
  if (combined?.councillorStats?.[slug]) {
    return combined.councillorStats[slug];
  }

  // Fall back to individual file
  const filePath = join(STATS_DIR, `${slug}.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`Error loading stats for ${slug}:`, error);
    return null;
  }
}

export class CouncillorStatsLookupService {
  private initialized = false;

  /**
   * Initialize the service by preloading data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('📊 Loading councillor stats data...');
    loadCombinedStats();
    loadAlignmentMatrix();
    this.initialized = true;
    console.log('✅ Councillor stats lookup service initialized');
  }

  /**
   * Get stats for a specific councillor
   */
  getCouncillorStats(slug: string): CouncillorStats | null {
    return loadCouncillorStats(slug);
  }

  /**
   * Get alignment between two councillors
   */
  getAlignment(slug1: string, slug2: string): number | null {
    const matrix = loadAlignmentMatrix();
    if (!matrix?.matrix) return null;

    return matrix.matrix[slug1]?.[slug2] || matrix.matrix[slug2]?.[slug1] || null;
  }

  /**
   * Get councillors who align most with the Mayor (j-morgan)
   */
  getMayorAllies(topN: number = 5): { councillor: string; alignmentRate: number }[] {
    const matrix = loadAlignmentMatrix();
    if (!matrix?.matrix?.['j-morgan']) return [];

    const mayorAlignments = matrix.matrix['j-morgan'];
    const sorted = Object.entries(mayorAlignments)
      .map(([slug, rate]) => ({ councillor: this.slugToName(slug), slug, alignmentRate: rate }))
      .sort((a, b) => b.alignmentRate - a.alignmentRate)
      .slice(0, topN);

    return sorted;
  }

  /**
   * Get councillors who align least with the Mayor
   */
  getMayorOpposition(topN: number = 5): { councillor: string; alignmentRate: number }[] {
    const matrix = loadAlignmentMatrix();
    if (!matrix?.matrix?.['j-morgan']) return [];

    const mayorAlignments = matrix.matrix['j-morgan'];
    const sorted = Object.entries(mayorAlignments)
      .map(([slug, rate]) => ({ councillor: this.slugToName(slug), slug, alignmentRate: rate }))
      .sort((a, b) => a.alignmentRate - b.alignmentRate)
      .slice(0, topN);

    return sorted;
  }

  /**
   * Find councillors who frequently vote alone (high nay rate, low alignment)
   */
  getLoneDissenters(): { councillor: string; nayRate: number; avgAlignment: number }[] {
    const combined = loadCombinedStats();
    if (!combined?.councillorStats) return [];

    const dissenters: { councillor: string; slug: string; nayRate: number; avgAlignment: number }[] = [];

    for (const [slug, stats] of Object.entries(combined.councillorStats)) {
      const nayRate = stats.voting.nays / (stats.voting.yeas + stats.voting.nays) * 100;

      // Calculate average alignment with all other councillors
      const alignments = combined.alignmentMatrix?.[slug];
      if (alignments) {
        const avgAlignment = Object.values(alignments).reduce((a, b) => a + b, 0) / Object.values(alignments).length;
        dissenters.push({
          councillor: stats.councillor,
          slug,
          nayRate,
          avgAlignment,
        });
      }
    }

    // Sort by nay rate descending (most frequent dissenters first)
    return dissenters
      .sort((a, b) => b.nayRate - a.nayRate)
      .slice(0, 5);
  }

  /**
   * Get councillors with moderate alignment (potential swing voters)
   */
  getSwingVoters(): { councillor: string; alignmentVariance: number }[] {
    const combined = loadCombinedStats();
    if (!combined?.councillorStats || !combined?.alignmentMatrix) return [];

    const swingVoters: { councillor: string; slug: string; alignmentVariance: number }[] = [];

    for (const [slug, alignments] of Object.entries(combined.alignmentMatrix)) {
      const rates = Object.values(alignments);
      if (rates.length === 0) continue;

      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      const variance = rates.reduce((sum, rate) => sum + Math.pow(rate - mean, 2), 0) / rates.length;
      const stats = combined.councillorStats[slug];

      if (stats) {
        swingVoters.push({
          councillor: stats.councillor,
          slug,
          alignmentVariance: variance,
        });
      }
    }

    // High variance = votes differently with different people = swing voter
    return swingVoters
      .sort((a, b) => b.alignmentVariance - a.alignmentVariance)
      .slice(0, 5);
  }

  /**
   * Check if councillor A supports councillor B (high alignment)
   */
  doesSupport(slugA: string, slugB: string, threshold: number = 85): boolean {
    const alignment = this.getAlignment(slugA, slugB);
    return alignment !== null && alignment >= threshold;
  }

  /**
   * Convert slug to display name
   */
  private slugToName(slug: string): string {
    const stats = loadCouncillorStats(slug);
    return stats?.councillor || slug;
  }

  /**
   * Format Mayor alignment for LLM context
   */
  formatMayorAlignmentForContext(): string {
    const allies = this.getMayorAllies(8);
    const opposition = this.getMayorOpposition(5);

    if (allies.length === 0) return '';

    return `
## VERIFIED COUNCILLOR ALIGNMENT DATA (from structured data - USE THIS)

**Councillors who vote most often with Mayor Morgan:**
${allies.map((a, i) => `${i + 1}. ${a.councillor} (${a.alignmentRate.toFixed(1)}% alignment)`).join('\n')}

**Councillors who vote least often with Mayor Morgan:**
${opposition.map((a, i) => `${i + 1}. ${a.councillor} (${a.alignmentRate.toFixed(1)}% alignment)`).join('\n')}

⚠️ This is verified structured data. Use these exact details in your response.
`;
  }

  /**
   * Format lone dissenters for LLM context
   */
  formatLoneDissentersForContext(): string {
    const dissenters = this.getLoneDissenters();

    if (dissenters.length === 0) return '';

    return `
## VERIFIED LONE DISSENTER DATA (from structured data - USE THIS)

**Councillors who most frequently vote against the majority (by nay rate):**
${dissenters.map((d, i) => `${i + 1}. ${d.councillor} - ${d.nayRate.toFixed(1)}% nay rate, ${d.avgAlignment.toFixed(1)}% avg alignment`).join('\n')}

⚠️ This is verified structured data. Use these exact details in your response.
`;
  }

  /**
   * Format specific councillor alignment for LLM context
   */
  formatCouncillorAlignmentForContext(slug: string): string {
    const stats = loadCouncillorStats(slug);
    if (!stats) return '';

    return `
## VERIFIED COUNCILLOR PROFILE: ${stats.councillor} (from structured data - USE THIS)

**Voting Record:**
- Total votes: ${stats.voting.totalVotes}
- Yea rate: ${stats.voting.yeaRate.toFixed(1)}%
- Participation rate: ${stats.voting.participationRate.toFixed(1)}%

**Top Alignments (votes with most often):**
${stats.topAlignments.slice(0, 5).map((a, i) => `${i + 1}. ${a.councillor} (${a.alignmentRate.toFixed(1)}%)`).join('\n')}

**Bottom Alignments (votes with least often):**
${stats.bottomAlignments.slice(0, 5).map((a, i) => `${i + 1}. ${a.councillor} (${a.alignmentRate.toFixed(1)}%)`).join('\n')}

⚠️ This is verified structured data. Use these exact details in your response.
`;
  }

  /**
   * Format comprehensive councillor record for LLM context.
   * Used for "overall record" queries to provide hard numbers that prevent
   * the model from producing vague positive summaries.
   */
  formatCouncillorRecordForContext(slug: string): string {
    const stats = loadCouncillorStats(slug);
    if (!stats) return '';

    const totalCast = stats.voting.yeas + stats.voting.nays;
    const nayRate = totalCast > 0 ? ((stats.voting.nays / totalCast) * 100).toFixed(1) : '0.0';

    let output = `
## VERIFIED COUNCILLOR RECORD: ${stats.councillor} (from structured data - USE THIS)

**Voting Summary:**
- Total votes cast: ${totalCast} (${stats.voting.absent} absences)
- Yea rate: ${stats.voting.yeaRate.toFixed(1)}% | Nay rate: ${nayRate}%
- Participation: ${stats.voting.participationRate.toFixed(1)}%`;

    if (stats.voting.contestedDissentRate != null) {
      output += `
- Contested dissent rate: ${stats.voting.contestedDissentRate.toFixed(1)}% (how often they vote against the majority on close/contested votes)`;
    }

    if (stats.budgetVoting && stats.budgetVoting.totalBudgetVotes > 0) {
      const budgetCast = stats.budgetVoting.budgetYeas + stats.budgetVoting.budgetNays;
      const budgetNayRate = budgetCast > 0 ? ((stats.budgetVoting.budgetNays / budgetCast) * 100).toFixed(1) : '0.0';
      output += `

**Budget Voting:**
- ${stats.budgetVoting.totalBudgetVotes} budget votes: ${stats.budgetVoting.budgetYeas} yea, ${stats.budgetVoting.budgetNays} nay (${budgetNayRate}% nay rate on budget items)`;
    }

    if (stats.attendance.trendDirection) {
      output += `

**Attendance:** ${stats.attendance.attendanceRate.toFixed(1)}% overall (trend: ${stats.attendance.trendDirection})`;
    }

    output += `

**Votes most often with:**
${stats.topAlignments.slice(0, 3).map((a, i) => `${i + 1}. ${a.councillor} (${a.alignmentRate.toFixed(1)}%)`).join('\n')}

**Votes least often with:**
${stats.bottomAlignments.slice(0, 3).map((a, i) => `${i + 1}. ${a.councillor} (${a.alignmentRate.toFixed(1)}%)`).join('\n')}`;

    if (stats.notableDissents && stats.notableDissents.length > 0) {
      const recentDissents = stats.notableDissents.slice(0, 5);
      output += `

**Recent Notable Dissents (votes where they were in the minority):**
${recentDissents.map(d => `- ${d.date}: "${d.itemTitle}" - voted ${d.vote}, ${d.result}`).join('\n')}`;
    }

    output += `

⚠️ This is verified structured data. Use these numbers directly in your response. State the dissent rate, name their closest allies and opponents, and characterize their position relative to council majority. Do NOT produce a vague positive summary.`;

    return output;
  }

  /**
   * Format swing voters for LLM context
   */
  formatSwingVotersForContext(): string {
    const swingVoters = this.getSwingVoters();

    if (swingVoters.length === 0) return '';

    return `
## VERIFIED SWING VOTER DATA (from structured data - USE THIS)

**Councillors with highest voting variance (potential swing voters):**
${swingVoters.map((s, i) => `${i + 1}. ${s.councillor}`).join('\n')}

These councillors show the most variance in who they align with, suggesting they vote based on individual issues rather than consistent bloc alignment.

⚠️ This is verified structured data. Use these exact details in your response.
`;
  }
}

// Singleton instance
export const councillorStatsLookupService = new CouncillorStatsLookupService();
