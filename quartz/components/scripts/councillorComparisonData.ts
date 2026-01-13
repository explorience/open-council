/**
 * Councillor Comparison Data Service
 *
 * Provides functions to load and compare councillor statistics across different metrics.
 * Used by comparison chart components to display ranked councillor data.
 */

// Types for councillor stats data structure
interface AttendanceData {
  totalMeetings: number;
  present: number;
  absent: number;
  remote: number;
  attendanceRate: number;
  trendDirection: string;
}

interface VotingData {
  totalVotes: number;
  yeas: number;
  nays: number;
  absent: number;
  participationRate: number;
  yeaRate: number;
  contestedDissentRate: number;
  contestedVotes: number;
  substantiveVotes: number;
  substantiveYeas: number;
  substantiveNays: number;
  substantiveParticipationRate: number;
  substantiveYeaRate: number;
}

interface CouncillorStatsEntry {
  councillor: string;
  slug: string;
  attendance: AttendanceData;
  voting: VotingData;
}

interface StatsData {
  generatedAt: string;
  councillorStats: Record<string, CouncillorStatsEntry>;
}

// Comparison result item
export interface ComparisonItem {
  name: string;
  slug: string;
  value: number;
  rank: number;
}

// Highlighted comparison result
export interface HighlightedComparisonItem extends ComparisonItem {
  isHighlighted: boolean;
}

// Current council members (2022-2026 term)
export const CURRENT_COUNCIL = new Set([
  "j-morgan",
  "h-mcalister",
  "s-lewis",
  "p-cuddy",
  "s-stevenson",
  "j-pribil",
  "s-trosow",
  "c-rahman",
  "s-lehman",
  "a-hopkins",
  "p-van-meerbergen",
  "s-franke",
  "e-peloza",
  "d-ferreira",
  "s-hillier",
]);

// Cache for loaded stats data
let cachedStats: StatsData | null = null;

/**
 * Load councillor stats from the JSON file
 * Results are cached after first load
 */
export async function loadCouncillorStats(): Promise<StatsData | null> {
  if (cachedStats) {
    return cachedStats;
  }

  try {
    const response = await fetch("/static/data/stats/councillor-stats.json");
    if (!response.ok) {
      console.error("Failed to load councillor stats:", response.status);
      return null;
    }
    cachedStats = await response.json();
    return cachedStats;
  } catch (error) {
    console.error("Error loading councillor stats:", error);
    return null;
  }
}

/**
 * Clear the cached stats (useful for testing or forcing refresh)
 */
export function clearStatsCache(): void {
  cachedStats = null;
}

/**
 * Filter councillors based on current/all and minimum vote threshold
 */
function filterCouncillors(
  stats: Record<string, CouncillorStatsEntry>,
  currentOnly: boolean = false,
  minVotes: number = 50,
): CouncillorStatsEntry[] {
  return Object.values(stats).filter((c) => {
    if (currentOnly) {
      return CURRENT_COUNCIL.has(c.slug);
    }
    // Only include councillors with meaningful voting data
    return c.voting.totalVotes >= minVotes;
  });
}

/**
 * Sort councillors by a given metric and assign ranks
 */
function sortAndRank(
  councillors: CouncillorStatsEntry[],
  getValue: (c: CouncillorStatsEntry) => number,
  descending: boolean = true,
): ComparisonItem[] {
  const sorted = [...councillors].sort((a, b) => {
    const valueA = getValue(a);
    const valueB = getValue(b);
    return descending ? valueB - valueA : valueA - valueB;
  });

  return sorted.map((c, index) => ({
    name: c.councillor,
    slug: c.slug,
    value: getValue(c),
    rank: index + 1,
  }));
}

/**
 * Get attendance rate comparison for all councillors
 * Returns councillors sorted by attendance rate (highest first)
 */
export async function getAttendanceComparison(
  currentOnly: boolean = false,
): Promise<ComparisonItem[]> {
  const stats = await loadCouncillorStats();
  if (!stats) return [];

  const councillors = filterCouncillors(stats.councillorStats, currentOnly);
  return sortAndRank(councillors, (c) => c.attendance.attendanceRate);
}

/**
 * Get participation rate comparison for all councillors
 * Returns councillors sorted by voting participation rate (highest first)
 */
export async function getParticipationComparison(
  currentOnly: boolean = false,
): Promise<ComparisonItem[]> {
  const stats = await loadCouncillorStats();
  if (!stats) return [];

  const councillors = filterCouncillors(stats.councillorStats, currentOnly);
  return sortAndRank(councillors, (c) => c.voting.participationRate);
}

/**
 * Get yea rate comparison for all councillors
 * Returns councillors sorted by yea voting rate (highest first)
 */
export async function getYeaRateComparison(
  currentOnly: boolean = false,
): Promise<ComparisonItem[]> {
  const stats = await loadCouncillorStats();
  if (!stats) return [];

  const councillors = filterCouncillors(stats.councillorStats, currentOnly);
  return sortAndRank(councillors, (c) => c.voting.yeaRate);
}

/**
 * Get total votes comparison for all councillors
 * Returns councillors sorted by total votes cast (highest first)
 */
export async function getTotalVotesComparison(
  currentOnly: boolean = false,
): Promise<ComparisonItem[]> {
  const stats = await loadCouncillorStats();
  if (!stats) return [];

  const councillors = filterCouncillors(stats.councillorStats, currentOnly);
  return sortAndRank(councillors, (c) => c.voting.totalVotes);
}

/**
 * Highlight a specific councillor in a comparison dataset
 * Adds an `isHighlighted` property to each item
 */
export function highlightCouncillor(
  data: ComparisonItem[],
  councillorSlug: string,
): HighlightedComparisonItem[] {
  return data.map((item) => ({
    ...item,
    isHighlighted: item.slug === councillorSlug,
  }));
}

/**
 * Get a single councillor's data with their rank for a specific metric
 */
export async function getCouncillorWithRank(
  councillorSlug: string,
  metric: "attendance" | "participation" | "yeaRate" | "totalVotes",
  currentOnly: boolean = false,
): Promise<ComparisonItem | null> {
  let comparison: ComparisonItem[];

  switch (metric) {
    case "attendance":
      comparison = await getAttendanceComparison(currentOnly);
      break;
    case "participation":
      comparison = await getParticipationComparison(currentOnly);
      break;
    case "yeaRate":
      comparison = await getYeaRateComparison(currentOnly);
      break;
    case "totalVotes":
      comparison = await getTotalVotesComparison(currentOnly);
      break;
    default:
      return null;
  }

  return comparison.find((item) => item.slug === councillorSlug) || null;
}

/**
 * Get comparison data for multiple metrics at once
 */
export async function getAllComparisons(currentOnly: boolean = false): Promise<{
  attendance: ComparisonItem[];
  participation: ComparisonItem[];
  yeaRate: ComparisonItem[];
  totalVotes: ComparisonItem[];
}> {
  const stats = await loadCouncillorStats();
  if (!stats) {
    return {
      attendance: [],
      participation: [],
      yeaRate: [],
      totalVotes: [],
    };
  }

  const councillors = filterCouncillors(stats.councillorStats, currentOnly);

  return {
    attendance: sortAndRank(councillors, (c) => c.attendance.attendanceRate),
    participation: sortAndRank(councillors, (c) => c.voting.participationRate),
    yeaRate: sortAndRank(councillors, (c) => c.voting.yeaRate),
    totalVotes: sortAndRank(councillors, (c) => c.voting.totalVotes),
  };
}

/**
 * Check if a councillor is a current council member
 */
export function isCurrentCouncillor(slug: string): boolean {
  return CURRENT_COUNCIL.has(slug);
}

/**
 * Get the generated timestamp of the stats data
 */
export async function getStatsGeneratedAt(): Promise<string | null> {
  const stats = await loadCouncillorStats();
  return stats?.generatedAt || null;
}
