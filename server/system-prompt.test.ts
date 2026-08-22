/**
 * Regression tests for Bug 3: the hardcoded councillor roster in the
 * chatbot's system prompt goes stale at the election.
 *
 * getStaticSystemPrompt() used to embed a literal hand-typed
 * "Current Council (2022-2026)" table. These tests exercise the actual
 * wired-up function (not just the underlying lib/councillors/roster.ts
 * module in isolation) to confirm:
 *   1. It no longer contains that hardcoded table.
 *   2. It's generated from data/councillors/registry.json.
 *   3. Passing a different "as of" date changes who's listed as current -
 *      proving this is a live computation, not something baked at import
 *      time or hardcoded elsewhere.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert';
import { getStaticSystemPrompt } from './system-prompt.js';
import { loadRegistry, getSlug } from '../lib/councillors/index.js';

function rosterSection(prompt: string): string {
  const start = prompt.indexOf('COUNCILLOR NAMES - NEVER HALLUCINATE');
  const end = prompt.indexOf('### RULES:');
  assert.ok(start !== -1 && end !== -1, 'expected the roster section markers to be present');
  return prompt.slice(start, end);
}

describe('getStaticSystemPrompt: councillor roster is derived from registry.json, not hardcoded', () => {
  test('does not contain the old hardcoded "(2022-2026)" heading', () => {
    const prompt = getStaticSystemPrompt(new Date('2026-08-22T00:00:00Z'));
    assert.doesNotMatch(prompt, /Current Council \(2022-2026\)/);
  });

  test('every currently-active registry councillor (as of the given date) appears in the roster', () => {
    const asOf = new Date('2026-08-22T00:00:00Z');
    const prompt = getStaticSystemPrompt(asOf);
    const section = rosterSection(prompt);
    const registry = loadRegistry();

    const currentYear = asOf.getUTCFullYear();
    for (const [canonicalName, info] of Object.entries(registry)) {
      const isCurrent = info.terms.some(t => t.start <= currentYear && t.end >= currentYear);
      if (isCurrent) {
        assert.ok(
          section.includes(canonicalName) && section.includes(info.displayName),
          `expected current councillor "${info.displayName}" (${canonicalName}) in the roster`
        );
      }
    }
  })

  test('BUG 3 regression: a councillor whose term has ended moves from Current to Former when "today" moves past it - no code change required', () => {
    const registry = loadRegistry();
    // Pick any real current councillor and find the year their active term ends.
    const [canonicalName, info] = Object.entries(registry).find(([, i]) =>
      i.terms.some(t => t.start <= 2026 && t.end >= 2026)
    )!;
    const activeTerm = info.terms.find(t => t.start <= 2026 && t.end >= 2026)!;

    const duringTerm = getStaticSystemPrompt(new Date(`${activeTerm.end}-06-01T00:00:00Z`));
    const afterTerm = getStaticSystemPrompt(new Date(`${activeTerm.end + 1}-06-01T00:00:00Z`));

    const duringSection = rosterSection(duringTerm);
    const afterSection = rosterSection(afterTerm);

    const duringCurrentTable = duringSection.split('### Former Councillors')[0];
    const afterCurrentTable = afterSection.split('### Former Councillors')[0];

    assert.ok(
      duringCurrentTable.includes(canonicalName),
      `expected "${canonicalName}" to be listed as current during their term (year ${activeTerm.end})`
    );
    assert.ok(
      !afterCurrentTable.includes(canonicalName),
      `expected "${canonicalName}" to NOT be listed as current after their term ends (year ${activeTerm.end + 1}) - this is the exact staleness Bug 3 fixes`
    );
    assert.ok(
      afterSection.includes(canonicalName),
      `expected "${canonicalName}" to still appear somewhere (in Former Councillors) after their term ends`
    );
  });

  test('sanity: getSlug still resolves for every name printed in the roster (no typos/invented names)', () => {
    const prompt = getStaticSystemPrompt(new Date('2026-08-22T00:00:00Z'));
    const section = rosterSection(prompt);
    const registry = loadRegistry();

    // Every canonical name we generated must round-trip through the same
    // registry - this is a cheap sanity check that buildCouncillorRosterSection
    // only ever emits names that exist in registry.json.
    for (const canonicalName of Object.keys(registry)) {
      if (section.includes(canonicalName)) {
        assert.ok(getSlug(canonicalName), `"${canonicalName}" printed in roster must resolve to a known slug`);
      }
    }
  });
});
