/**
 * Councillor data module
 *
 * Provides access to councillor information, name normalization,
 * and registry queries. Uses JSON data files as the source of truth.
 *
 * @example
 * ```typescript
 * import {
 *   getCouncillor,
 *   normalizeCouncillorName,
 *   isCurrentCouncillor
 * } from '../lib/councillors'
 *
 * // Get councillor info
 * const info = getCouncillor('J. Morgan')
 * console.log(info?.displayName) // "Josh Morgan"
 *
 * // Normalize a name variation
 * const canonical = normalizeCouncillorName('Josh Morgan')
 * console.log(canonical) // "J. Morgan"
 *
 * // Check if currently serving
 * const current = isCurrentCouncillor('J. Morgan')
 * console.log(current) // true
 * ```
 */

// Types
export type {
  CouncillorTerm,
  CouncillorInfo,
  CouncillorRegistry,
  NameVariationsMap,
  CouncillorData,
  Meeting,
} from "./types.js"

// Registry functions
export {
  loadRegistry,
  loadNameMap,
  clearCache,
  getCouncillor,
  getCouncillorBySlug,
  getAllCouncillors,
  getCouncillorTerms,
  isCurrentCouncillor,
  getCurrentCouncillors,
  getFormerCouncillors,
  getDisplayName,
  getSlug,
  getAllCanonicalNames,
  getAllSlugs,
} from "./registry.js"

// Normalization functions
export {
  normalizeCouncillorName,
  extractCouncillors,
  looksLikeCouncillorName,
  getNameVariations,
} from "./normalize.js"

// Roster generation (for the chatbot's anti-hallucination allow-list)
export {
  buildCouncillorRosterSection,
  partitionRoster,
  getTermCoveringYear,
  type RosterEntry,
} from "./roster.js"
