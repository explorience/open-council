/**
 * Topic type definitions
 */

export interface Topic {
  /** Display name for the topic */
  name: string
  /** URL-friendly slug */
  slug: string
  /** Short description of what this topic covers */
  description: string
  /** Keywords associated with this topic (from synonym groups) */
  keywords: string[]
  /** SVG icon name or path (optional) */
  icon?: string
  /** Suggested questions for this topic */
  prefillQuestions: string[]
}

export interface TopicActivity {
  /** Topic slug */
  slug: string
  /** Number of mentions in recent meetings */
  mentionCount: number
  /** Most recent meeting date with this topic */
  lastMentioned?: string
}
