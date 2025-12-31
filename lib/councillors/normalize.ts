/**
 * Name normalization functions for councillor names
 *
 * Handles variations in how councillor names appear in meeting minutes
 * (e.g., "Josh Morgan", "J Morgan", "J. Morgan" -> "J. Morgan")
 */

import { loadNameMap, loadRegistry } from "./registry.js"

/**
 * Normalize a councillor name to its canonical form
 *
 * @param name - The name as it appears in meeting minutes
 * @returns The canonical name (e.g., "J. Morgan") or null if not a verified councillor
 */
export function normalizeCouncillorName(name: string): string | null {
  const nameMap = loadNameMap()
  const registry = loadRegistry()

  // Clean up the name
  let cleaned = name
    .trim()
    .replace(/^>\s*/, "")
    .replace(/[;,]$/, "")
    .replace(/^\s*and\s+/i, "")
    .replace(/\s*\(.*?\)\s*/g, "") // Remove parentheticals like "(Acting Chair)"
    .replace(/^\s*(Mayor|Deputy|Acting|Councillor|Chair)\s+/i, "")
    .trim()

  // Skip obvious non-names
  if (!cleaned || cleaned.length < 3) return null
  if (
    /^(the|meeting|was|called|to|order|at|with|all|members|present|except|it|being|noted|that|following|were|in|remote|attendance|staff)/i.test(
      cleaned
    )
  )
    return null
  if (/^\d/.test(cleaned)) return null // Starts with number
  if (/^#/.test(cleaned)) return null // Starts with #
  if (cleaned.length > 30) return null // Too long to be a name

  // Check if it's in the name map
  if (nameMap[cleaned]) {
    return nameMap[cleaned]
  }

  // Check if it's already a canonical name in registry
  if (registry[cleaned]) {
    return cleaned
  }

  // Try to match pattern like "X. LastName" or "X.Y. LastName"
  const nameMatch = cleaned.match(/^([A-Z]\.?\s*[A-Z]?\.?\s+[A-Za-z\s-]+)$/)
  if (nameMatch) {
    const potentialName = nameMatch[1].trim()
    // Check if this matches any verified councillor
    for (const canonicalName of Object.keys(registry)) {
      // Compare case-insensitively
      if (canonicalName.toLowerCase() === potentialName.toLowerCase()) {
        return canonicalName
      }
      // Check if last names match
      const canonicalLast = canonicalName.split(/\s+/).pop()?.toLowerCase()
      const potentialLast = potentialName.split(/\s+/).pop()?.toLowerCase()
      if (canonicalLast && potentialLast && canonicalLast === potentialLast) {
        // Check if initials are compatible
        const canonicalFirst = canonicalName.split(/\s+/)[0]
        const potentialFirst = potentialName.split(/\s+/)[0]
        if (canonicalFirst[0].toLowerCase() === potentialFirst[0].toLowerCase()) {
          return canonicalName
        }
      }
    }
  }

  return null
}

/**
 * Extract councillor names from markdown content
 *
 * Parses "Present:" and "Remote Attendance:" sections from meeting markdown
 *
 * @param content - The full markdown content of a meeting file
 * @returns Array of canonical councillor names found
 */
export function extractCouncillors(content: string): string[] {
  const councillors: Set<string> = new Set()

  // Match "Present:" section - try multiple patterns
  const presentPatterns = [
    />\s*\[!abstract\]-?\s*Present:?\s*\n>\s*(.+)/i,
    /\*\*Present\*\*:?\s*(.+)/i,
    /Present:?\s*\n?\s*(.+)/i,
  ]

  for (const pattern of presentPatterns) {
    const match = content.match(pattern)
    if (match) {
      const names = match[1].split(/[,;]\s*/)
      names.forEach(name => {
        const normalized = normalizeCouncillorName(name)
        if (normalized) {
          councillors.add(normalized)
        }
      })
      break
    }
  }

  // Also check Remote Attendance
  const remotePatterns = [
    />\s*\[!abstract\]-?\s*Remote Attendance:?\s*\n>\s*(.+)/i,
    /\*\*Remote Attendance\*\*:?\s*(.+)/i,
    /Remote Attendance:?\s*\n?\s*(.+)/i,
  ]

  for (const pattern of remotePatterns) {
    const match = content.match(pattern)
    if (match) {
      const names = match[1].split(/[,;]\s*/)
      names.forEach(name => {
        const normalized = normalizeCouncillorName(name)
        if (normalized) {
          councillors.add(normalized)
        }
      })
      break
    }
  }

  return Array.from(councillors)
}

/**
 * Check if a string looks like a councillor name
 * (useful for filtering before normalization)
 */
export function looksLikeCouncillorName(text: string): boolean {
  const cleaned = text.trim()
  if (cleaned.length < 3 || cleaned.length > 30) return false
  if (/^\d/.test(cleaned)) return false
  if (/^#/.test(cleaned)) return false
  // Must have at least one letter
  if (!/[a-zA-Z]/.test(cleaned)) return false
  return true
}

/**
 * Get all known name variations for a councillor
 *
 * @param canonicalName - The canonical name (e.g., "J. Morgan")
 * @returns Array of name variations that map to this canonical name
 */
export function getNameVariations(canonicalName: string): string[] {
  const nameMap = loadNameMap()
  const variations: string[] = []

  for (const [variation, canonical] of Object.entries(nameMap)) {
    if (canonical === canonicalName) {
      variations.push(variation)
    }
  }

  return variations
}
