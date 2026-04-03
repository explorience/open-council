/**
 * Post-response validation pass
 *
 * Validates LLM responses before they reach the user, checking for:
 * A. Hallucinated councillor names
 * B. Vote count arithmetic mismatches
 * C. References to nonexistent meetings
 * D. Broken markdown links
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCouncillorName } from '../lib/councillors/normalize.js';
import { getAllCouncillors } from '../lib/councillors/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths relative to server/ directory
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CONTENT_DIR = path.resolve(__dirname, '..', 'content', 'months');

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  disclaimer: string | null;  // null if no issues, otherwise a disclaimer to append
  blockedResponse?: string;   // if set, replace the entire response with this (e.g., prompt leak blocked)
}

export interface ValidationIssue {
  type: 'hallucinated-name' | 'vote-count-mismatch' | 'nonexistent-meeting' | 'broken-link' | 'unverified-data';
  severity: 'error' | 'warning';
  detail: string;
}

// Cache of all known councillor display names (built once)
let _knownNamesCache: Set<string> | null = null;
// Cache for data directory month-folder listing
let _dataDirMonthsCache: Set<string> | null = null;
// Cache for content directory month-folder listing
let _contentDirMonthsCache: Set<string> | null = null;

/**
 * Build a set of all known councillor names (display names, first/last, variations)
 */
function getKnownNames(): Set<string> {
  if (_knownNamesCache) return _knownNamesCache;

  const names = new Set<string>();
  try {
    const councillors = getAllCouncillors();
    for (const { info } of councillors) {
      const displayName = info.displayName;
      names.add(displayName.toLowerCase());
      // Add last name only
      const parts = displayName.split(/\s+/);
      if (parts.length >= 2) {
        names.add(parts[parts.length - 1].toLowerCase());
      }
      // Add first name only (less useful but helps avoid false positives)
      names.add(parts[0].toLowerCase());
    }
  } catch {
    // If registry can't be loaded, skip name validation
  }
  _knownNamesCache = names;
  return names;
}

/**
 * Get set of data directory month folders (e.g. "2026-03")
 */
function getDataMonths(): Set<string> {
  if (_dataDirMonthsCache) return _dataDirMonthsCache;
  const months = new Set<string>();
  try {
    const entries = fs.readdirSync(DATA_DIR);
    for (const e of entries) {
      if (/^\d{4}-\d{2}$/.test(e)) months.add(e);
    }
  } catch {
    // ignore
  }
  _dataDirMonthsCache = months;
  return months;
}

/**
 * Get set of content directory month folders
 */
function getContentMonths(): Set<string> {
  if (_contentDirMonthsCache) return _contentDirMonthsCache;
  const months = new Set<string>();
  try {
    const entries = fs.readdirSync(CONTENT_DIR);
    for (const e of entries) {
      if (/^\d{4}-\d{2}$/.test(e)) months.add(e);
    }
  } catch {
    // ignore
  }
  _contentDirMonthsCache = months;
  return months;
}

// Month name → zero-based index
const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * A. Councillor name validation
 * Extract names that look like councillor names from the response and validate them.
 */
function validateCouncillorNames(response: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const suspectNames = new Set<string>();

  // Pattern 1: "Councillor Smith" or "Mayor Morgan"
  const councillorPattern = /\b(?:Councillor|Mayor|Deputy Mayor)\s+([A-Z][a-zA-Z\-']+(?:\s+[A-Z][a-zA-Z\-']+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = councillorPattern.exec(response)) !== null) {
    suspectNames.add(m[1].trim());
  }

  // Pattern 2: "J. Smith" or "J.L. Smith"
  const initialLastPattern = /\b([A-Z]\.\s*(?:[A-Z]\.\s*)?[A-Z][a-zA-Z\-']+)\b/g;
  while ((m = initialLastPattern.exec(response)) !== null) {
    // Only consider if surrounded by vote-context words nearby
    const surrounding = response.slice(Math.max(0, m.index - 60), m.index + 80).toLowerCase();
    if (/\b(voted|yea|nay|aye|absent|vote|councillor|ward)\b/.test(surrounding)) {
      suspectNames.add(m[1].trim());
    }
  }

  // Pattern 3: Vote lists "Yeas: Smith, Jones, ..." or "Nays: ..."
  const voteListPattern = /\b(?:Yeas?|Nays?|Ayes?|Against|For|Abstained?):\s*([A-Z][a-zA-Z\-'\s,]+?)(?:\n|$|;|\d)/g;
  while ((m = voteListPattern.exec(response)) !== null) {
    const nameList = m[1];
    // Split on commas
    for (const rawName of nameList.split(/[,;]/)) {
      const name = rawName.trim();
      if (name.length >= 2 && name.length <= 30 && /^[A-Z]/.test(name)) {
        suspectNames.add(name);
      }
    }
  }

  // Pattern 4: Well-known full names (title-case two-word names in vote contexts)
  const fullNamePattern = /\b([A-Z][a-z]+\s+[A-Z][a-zA-Z\-']+)\b/g;
  while ((m = fullNamePattern.exec(response)) !== null) {
    const surrounding = response.slice(Math.max(0, m.index - 80), m.index + 80).toLowerCase();
    if (/\b(voted|yea|nay|aye|absent|vote|councillor|ward|moved|seconded)\b/.test(surrounding)) {
      suspectNames.add(m[1].trim());
    }
  }

  // Validate each suspect name
  for (const name of suspectNames) {
    // Skip very short names or obvious non-names
    if (name.length < 3) continue;
    if (/^(The|This|City|Ward|Vote|Yea|Nay|Aye|Nay|For|Against)$/i.test(name)) continue;

    const canonical = normalizeCouncillorName(name);
    if (canonical === null) {
      // Not in registry — could be hallucinated
      // But don't flag if it looks like a partial word (e.g. capitalised sentence start)
      const knownNames = getKnownNames();
      const lower = name.toLowerCase();
      // If it's a known last name/first name (partial match) skip
      if (knownNames.has(lower)) continue;
      // If it's a short single word that could be anything, skip
      if (!name.includes(' ') && !name.includes('.') && name.length <= 8) continue;

      issues.push({
        type: 'hallucinated-name',
        severity: 'warning',
        detail: `"${name}" could not be verified as a known councillor name`,
      });
    }
  }

  return issues;
}

/**
 * B. Vote count arithmetic validation
 * Check that stated "X-Y" vote totals match any councillor name lists present.
 */
function validateVoteCounts(response: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Find vote count patterns like "11-4", "15-0", "7 to 8"
  const voteCountPattern = /\b(\d{1,2})[–\-](\d{1,2})\b|\b(\d{1,2})\s+to\s+(\d{1,2})\b/g;

  let m: RegExpExecArray | null;
  while ((m = voteCountPattern.exec(response)) !== null) {
    const yeas = parseInt(m[1] || m[3], 10);
    const nays = parseInt(m[2] || m[4], 10);

    // Look for nearby vote lists to validate against
    const contextStart = Math.max(0, m.index - 500);
    const contextEnd = Math.min(response.length, m.index + 500);
    const contextSlice = response.slice(contextStart, contextEnd);

    // Find Yeas/Nays name lists in the nearby context
    const yeaListMatch = contextSlice.match(/\b(?:Yeas?|Ayes?|For):\s*([A-Z][a-zA-Z\-'\s,]+?)(?:\n|;|\d|Nay|Against)/i);
    const nayListMatch = contextSlice.match(/\b(?:Nays?|Against):\s*([A-Z][a-zA-Z\-'\s,]+?)(?:\n|;|\d|Yea|Aye|For)/i);

    if (yeaListMatch || nayListMatch) {
      const countNames = (list: string): number => {
        return list.split(/[,;]/).map(n => n.trim()).filter(n => n.length >= 2 && /^[A-Z]/.test(n)).length;
      };

      if (yeaListMatch) {
        const listedYeas = countNames(yeaListMatch[1]);
        if (listedYeas > 0 && Math.abs(listedYeas - yeas) > 1) {
          issues.push({
            type: 'vote-count-mismatch',
            severity: 'warning',
            detail: `Stated yea count ${yeas} may not match listed names (found ~${listedYeas} names)`,
          });
        }
      }
      if (nayListMatch) {
        const listedNays = countNames(nayListMatch[1]);
        if (listedNays > 0 && Math.abs(listedNays - nays) > 1) {
          issues.push({
            type: 'vote-count-mismatch',
            severity: 'warning',
            detail: `Stated nay count ${nays} may not match listed names (found ~${listedNays} names)`,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Check if a response contains vote count patterns (for pure RAG disclaimer)
 */
function responseContainsVoteCounts(response: string): boolean {
  return /\b\d{1,2}[–\-]\d{1,2}\b|\b\d{1,2}\s+to\s+\d{1,2}\b|\b(?:Yeas?|Nays?|Ayes?):/i.test(response);
}

/**
 * C. Meeting date validation
 * Extract meeting date references and check if data files exist.
 */
function validateMeetingDates(response: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dataMonths = getDataMonths();

  if (dataMonths.size === 0) return issues; // Can't validate if we can't read data dir

  // Pattern: "March 3, 2026 Council meeting" or "the January 12, 2026 meeting"
  const datePattern = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi;

  let m: RegExpExecArray | null;
  while ((m = datePattern.exec(response)) !== null) {
    const monthName = m[1].toLowerCase();
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);

    // Only validate years in our data range
    if (year < 2011 || year > 2030) continue;

    const monthIndex = MONTH_MAP[monthName];
    if (monthIndex === undefined) continue;

    const monthStr = String(monthIndex + 1).padStart(2, '0');
    const yearMonth = `${year}-${monthStr}`;

    // Check if this month folder exists
    if (!dataMonths.has(yearMonth)) {
      issues.push({
        type: 'nonexistent-meeting',
        severity: 'warning',
        detail: `Reference to ${m[1]} ${day}, ${year} — no meeting data found for ${yearMonth}`,
      });
    }
  }

  return issues;
}

/**
 * D. Link validation
 * Extract markdown links pointing to meeting pages and check if content files exist.
 */
function validateLinks(response: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const contentMonths = getContentMonths();

  if (contentMonths.size === 0) return issues;

  // Match markdown links like [text](/2026-03/...) or [text](/months/2026-03/...)
  // or (/YYYY-MM/...) bare path references
  const linkPattern = /\[([^\]]*)\]\(\/(?:months\/)?(\d{4}-\d{2})[^)]*\)/g;

  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(response)) !== null) {
    const yearMonth = m[2];

    if (!contentMonths.has(yearMonth)) {
      issues.push({
        type: 'broken-link',
        severity: 'warning',
        detail: `Link references ${yearMonth} — no content found for that month`,
      });
    }
  }

  return issues;
}

/**
 * Build a disclaimer string from issues
 */
function buildDisclaimer(issues: ValidationIssue[], usedStructuredData: boolean, response: string): string | null {
  const hasHallucinatedName = issues.some(i => i.type === 'hallucinated-name');
  const hasVoteCountMismatch = issues.some(i => i.type === 'vote-count-mismatch');
  const hasBrokenLink = issues.some(i => i.type === 'broken-link');
  const hasNonexistentMeeting = issues.some(i => i.type === 'nonexistent-meeting');

  const disclaimers: string[] = [];

  if (hasHallucinatedName) {
    disclaimers.push('⚠️ Note: Some councillor names in this response could not be verified against official records. Please check the meeting page for exact details.');
  }

  if (hasVoteCountMismatch) {
    disclaimers.push('⚠️ Note: Vote counts in this response may not match the official record exactly. Please verify on the meeting page.');
  }

  if (hasBrokenLink) {
    disclaimers.push('⚠️ Note: One or more links in this response may point to unavailable pages. Check the main meetings index for the latest data.');
  }

  if (hasNonexistentMeeting) {
    disclaimers.push('⚠️ Note: This response references a meeting date that could not be found in our records. Please verify the date on the city website.');
  }

  // Pure RAG disclaimer: if no structured data was used AND vote counts are present
  if (!usedStructuredData && responseContainsVoteCounts(response)) {
    disclaimers.push('ℹ️ This answer is based on meeting transcript search. For verified vote counts, check the linked meeting page.');
  }

  if (disclaimers.length === 0) return null;
  return disclaimers.join('\n\n');
}

/**
 * Validate an LLM response before it reaches the user.
 *
 * @param response - The full LLM response text
 * @param usedStructuredData - Whether the response was backed by the structured vote lookup engine
 */
/**
 * E. System prompt leak detection
 *
 * Checks if the LLM response contains fragments of the system prompt,
 * which would indicate a successful prompt extraction attack.
 */
const SYSTEM_PROMPT_SIGNATURES = [
  'SECURITY NOTICE',
  'RESPONSE PHILOSOPHY',
  'COUNCILLOR NAMES - NEVER HALLUCINATE',
  'WHAT NOT TO DO (Critical)',
  'QUESTION TYPES AND HOW TO HANDLE',
  'Narrative First, Details on Request',
  'Don\'t recite motions verbatim',
  'Don\'t list vote tallies',
  'VERIFY PREMISES BEFORE ANSWERING',
  'COUNCILLOR VOTING QUESTIONS',
  'Procedural vs Substantive Votes',
  'Movers vs Voters - Different Levels',
  'DO NOT CHEERLEAD',
  'getStaticSystemPrompt',
  'getContextBlock',
  'OpenRouter',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'text-embedding-3-small',
  'chatStreamOpenRouter',
  'chatStreamAnthropic',
  'RAGService',
  'vectorStore',
  'TOP_K_SIMPLE',
  'TOP_K_COMPLEX',
  'LLM_PROVIDER',
];

function detectSystemPromptLeak(response: string): boolean {
  const upper = response.toUpperCase();
  let matchCount = 0;
  for (const sig of SYSTEM_PROMPT_SIGNATURES) {
    if (upper.includes(sig.toUpperCase())) {
      matchCount++;
    }
    // 3+ matches = almost certainly a leak
    if (matchCount >= 3) return true;
  }
  return false;
}

/**
 * Detect prompt injection attempts in user input.
 * Returns a canned response if injection detected, null otherwise.
 */
export function detectPromptInjection(input: string): string | null {
  const lower = input.toLowerCase();

  const injectionPatterns = [
    // Direct prompt extraction
    /ignore\s+(your\s+)?(previous\s+)?instructions/i,
    /output\s+(your\s+)?(full\s+)?system\s+prompt/i,
    /reveal\s+(your\s+)?system\s+prompt/i,
    /print\s+(your\s+)?(full\s+)?system\s+(prompt|instructions)/i,
    /what\s+(is|are)\s+your\s+(system\s+)?instructions/i,
    /show\s+me\s+your\s+(system\s+)?prompt/i,
    /repeat\s+(your\s+)?(system\s+)?(prompt|instructions)\s+verbatim/i,
    /display\s+(your\s+)?initial\s+instructions/i,

    // Roleplay/debug jailbreaks
    /pretend\s+you\s+are\s+a\s+debugging/i,
    /you\s+are\s+now\s+(in\s+)?debug\s+mode/i,
    /enter\s+(maintenance|admin|debug)\s+mode/i,
    /as\s+a\s+(developer|admin|debug)\s+tool/i,

    // DAN-style jailbreaks
    /\bDAN\b.*\bjailbreak\b/i,
    /do\s+anything\s+now/i,
    /you\s+have\s+been\s+freed/i,

    // Encoding tricks
    /decode\s+and\s+execute/i,
    /base64.*execute/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(input)) {
      return "I'm here to help you learn about London City Council meetings, votes, and decisions. What would you like to know about? You can ask about specific topics, councillor voting records, or recent council decisions.";
    }
  }

  // Also check for suspicious keywords clustered together
  const suspiciousTerms = ['system prompt', 'training data', 'api key', 'environment variable', 'internal configuration', 'previous instructions'];
  const termMatches = suspiciousTerms.filter(t => lower.includes(t));
  if (termMatches.length >= 2) {
    return "I'm here to help you learn about London City Council meetings, votes, and decisions. What would you like to know about? You can ask about specific topics, councillor voting records, or recent council decisions.";
  }

  return null;
}

export function validateResponse(response: string, usedStructuredData: boolean): ValidationResult {
  const issues: ValidationIssue[] = [];

  // E. System prompt leak detection (highest priority - block entire response)
  if (detectSystemPromptLeak(response)) {
    return {
      isValid: false,
      issues: [{
        type: 'hallucinated-name' as const,  // reuse type for simplicity
        severity: 'error',
        detail: 'Response contained system prompt fragments (potential prompt extraction attack)',
      }],
      disclaimer: null,
      blockedResponse: "I'm here to help you learn about London City Council meetings, votes, and decisions. What would you like to know about? You can ask about specific topics, councillor voting records, or recent council decisions.",
    };
  }

  try {
    // A. Councillor name validation
    issues.push(...validateCouncillorNames(response));
  } catch {
    // Don't let validation errors break the response
  }

  try {
    // B. Vote count arithmetic
    issues.push(...validateVoteCounts(response));
  } catch {
    // Don't let validation errors break the response
  }

  try {
    // C. Meeting date validation
    issues.push(...validateMeetingDates(response));
  } catch {
    // Don't let validation errors break the response
  }

  try {
    // D. Link validation
    issues.push(...validateLinks(response));
  } catch {
    // Don't let validation errors break the response
  }

  const disclaimer = buildDisclaimer(issues, usedStructuredData, response);

  return {
    isValid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    disclaimer,
  };
}
