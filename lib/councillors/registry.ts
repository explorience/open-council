/**
 * Councillor registry - loads and queries councillor data from JSON
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { CouncillorRegistry, CouncillorInfo, CouncillorTerm, NameVariationsMap } from "./types.js"

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Cache for loaded data
let registryCache: CouncillorRegistry | null = null
let nameMapCache: NameVariationsMap | null = null

/**
 * Get the path to the data directory
 */
function getDataPath(): string {
  // Works from both project root and nested directories
  const possiblePaths = [
    path.join(process.cwd(), "data", "councillors"),
    path.join(__dirname, "..", "..", "data", "councillors"),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(path.join(p, "registry.json"))) {
      return p
    }
  }

  // Default to cwd-based path
  return path.join(process.cwd(), "data", "councillors")
}

/**
 * Load the councillor registry from JSON
 */
export function loadRegistry(): CouncillorRegistry {
  if (registryCache) return registryCache

  const dataPath = getDataPath()
  const registryPath = path.join(dataPath, "registry.json")

  const data = fs.readFileSync(registryPath, "utf-8")
  registryCache = JSON.parse(data) as CouncillorRegistry

  return registryCache
}

/**
 * Load the name variations map from JSON
 */
export function loadNameMap(): NameVariationsMap {
  if (nameMapCache) return nameMapCache

  const dataPath = getDataPath()
  const nameMapPath = path.join(dataPath, "name-map.json")

  const data = fs.readFileSync(nameMapPath, "utf-8")
  nameMapCache = JSON.parse(data) as NameVariationsMap

  return nameMapCache
}

/**
 * Clear cached data (useful for testing)
 */
export function clearCache(): void {
  registryCache = null
  nameMapCache = null
}

/**
 * Get councillor info by canonical name
 */
export function getCouncillor(canonicalName: string): CouncillorInfo | null {
  const registry = loadRegistry()
  return registry[canonicalName] || null
}

/**
 * Get councillor info by slug
 */
export function getCouncillorBySlug(slug: string): { canonicalName: string; info: CouncillorInfo } | null {
  const registry = loadRegistry()

  for (const [canonicalName, info] of Object.entries(registry)) {
    if (info.slug === slug) {
      return { canonicalName, info }
    }
  }

  return null
}

/**
 * Get all councillors
 */
export function getAllCouncillors(): Array<{ canonicalName: string; info: CouncillorInfo }> {
  const registry = loadRegistry()

  return Object.entries(registry).map(([canonicalName, info]) => ({
    canonicalName,
    info,
  }))
}

/**
 * Get term information for a councillor
 */
export function getCouncillorTerms(canonicalName: string): CouncillorTerm[] {
  const councillor = getCouncillor(canonicalName)
  return councillor?.terms || []
}

/**
 * Check if councillor is currently serving (2022-2026 term)
 */
export function isCurrentCouncillor(canonicalName: string): boolean {
  const terms = getCouncillorTerms(canonicalName)
  return terms.some(t => t.end >= 2026)
}

/**
 * Get all current councillors (2022-2026 term)
 */
export function getCurrentCouncillors(): Array<{ canonicalName: string; info: CouncillorInfo }> {
  return getAllCouncillors().filter(({ canonicalName }) => isCurrentCouncillor(canonicalName))
}

/**
 * Get all former councillors (not in 2022-2026 term)
 */
export function getFormerCouncillors(): Array<{ canonicalName: string; info: CouncillorInfo }> {
  return getAllCouncillors().filter(({ canonicalName }) => !isCurrentCouncillor(canonicalName))
}

/**
 * Get councillor's display name
 */
export function getDisplayName(canonicalName: string): string {
  const councillor = getCouncillor(canonicalName)
  return councillor?.displayName || canonicalName
}

/**
 * Get councillor's slug
 */
export function getSlug(canonicalName: string): string {
  const councillor = getCouncillor(canonicalName)
  return councillor?.slug || canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

/**
 * Get all canonical names (useful for validation)
 */
export function getAllCanonicalNames(): string[] {
  const registry = loadRegistry()
  return Object.keys(registry)
}

/**
 * Get all slugs (useful for routing)
 */
export function getAllSlugs(): string[] {
  const registry = loadRegistry()
  return Object.values(registry).map(info => info.slug)
}
