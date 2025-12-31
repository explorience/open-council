/**
 * Topics module
 *
 * Provides topic definitions and utilities for categorizing
 * council meeting content by policy area.
 *
 * @example
 * ```typescript
 * import {
 *   getAllTopics,
 *   getTopicBySlug,
 *   detectTopicsInQuery
 * } from '../lib/topics'
 *
 * // Get all topics
 * const topics = getAllTopics()
 *
 * // Get a specific topic
 * const housing = getTopicBySlug('housing')
 *
 * // Detect topics in a user query
 * const query = "What has council done about bike lanes?"
 * const detected = detectTopicsInQuery(query) // [transportation topic]
 * ```
 */

// Types
export type { Topic, TopicActivity } from "./types.js"

// Data and functions
export {
  topics,
  getAllTopics,
  getTopicBySlug,
  getTopicByKeyword,
  detectTopicsInQuery,
} from "./data.js"
