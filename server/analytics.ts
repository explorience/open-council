/**
 * Analytics service for tracking query patterns and trending topics
 *
 * Stores query logs in a JSON file for simple persistence.
 * Tracks detected topics for each query to surface trending topics.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { detectTopicsInQuery } from '../lib/topics/index.js';

export interface QueryLog {
  timestamp: string;
  query: string;
  topics: string[];
}

export interface TopicCount {
  topic: string;
  count: number;
}

export interface TrendingData {
  popularTopics: TopicCount[];
  recentQueries: number;
  timeframeHours: number;
}

const LOG_FILE = resolve(process.cwd(), 'lancedb', 'query-analytics.json');
const MAX_LOG_SIZE = 10000; // Keep last 10k queries

/**
 * Load existing query logs from file
 */
function loadLogs(): QueryLog[] {
  try {
    if (existsSync(LOG_FILE)) {
      const data = readFileSync(LOG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load analytics logs:', error);
  }
  return [];
}

/**
 * Save query logs to file
 */
function saveLogs(logs: QueryLog[]): void {
  try {
    // Ensure directory exists
    const dir = dirname(LOG_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (error) {
    console.error('Failed to save analytics logs:', error);
  }
}

/**
 * Log a query with its detected topics
 */
export function logQuery(query: string): void {
  const detectedTopics = detectTopicsInQuery(query);
  const topicNames = detectedTopics.map(t => t.name);

  const logEntry: QueryLog = {
    timestamp: new Date().toISOString(),
    query: query.substring(0, 500), // Limit query length
    topics: topicNames,
  };

  const logs = loadLogs();
  logs.push(logEntry);

  // Trim to max size (keep most recent)
  if (logs.length > MAX_LOG_SIZE) {
    logs.splice(0, logs.length - MAX_LOG_SIZE);
  }

  saveLogs(logs);
}

/**
 * Get trending topics based on recent query patterns
 *
 * @param hours - Time window in hours (default: 168 = 7 days)
 * @returns Trending data with popular topics
 */
export function getTrendingTopics(hours: number = 168): TrendingData {
  const logs = loadLogs();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Filter to recent queries
  const recentLogs = logs.filter(log => new Date(log.timestamp) >= cutoff);

  // Count topic occurrences
  const topicCounts = new Map<string, number>();
  for (const log of recentLogs) {
    for (const topic of log.topics) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    }
  }

  // Sort by count
  const popularTopics: TopicCount[] = Array.from(topicCounts.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);

  return {
    popularTopics,
    recentQueries: recentLogs.length,
    timeframeHours: hours,
  };
}

/**
 * Get topics from recent meeting content
 * This is a placeholder - actual implementation would analyze meeting data
 *
 * @returns Array of topic names from recent meetings
 */
export function getRecentMeetingTopics(): string[] {
  // This would scan recent meeting JSON files for mentioned topics
  // For now, return static popular topics based on typical council activity
  return [
    'Housing',
    'Budget & Taxes',
    'Transportation',
    'Climate & Environment',
    'Planning & Development',
  ];
}

/**
 * Combined trending data from both queries and meeting activity
 */
export function getCombinedTrending(): {
  queryTrending: TopicCount[];
  meetingTopics: string[];
  combined: string[];
} {
  const trending = getTrendingTopics(168); // 7 days
  const meetingTopics = getRecentMeetingTopics();

  // Combine query-based trending with meeting topics
  const queryTopics = trending.popularTopics.map(t => t.topic);

  // Merge and deduplicate, prioritizing query-based trends
  const combinedSet = new Set([...queryTopics, ...meetingTopics]);

  return {
    queryTrending: trending.popularTopics,
    meetingTopics,
    combined: Array.from(combinedSet).slice(0, 8), // Top 8 topics
  };
}
