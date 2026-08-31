/**
 * Matching/retrieval-layer tests for the councillor-vote-query routing and matching
 * fixes (fix/vote-query-routing).
 *
 * These exercise the REAL modules (RAGService's query analysis + topic-keyword
 * extraction, and VoteLookupService's structured lookup) against the REAL
 * data/votes/*.json files - no synthetic fixtures, no network/OpenAI/LanceDB calls.
 * `npm run test` (tsx --test) discovers this alongside the rest of the suite.
 *
 * Ground truth for every case below was verified directly against
 * data/votes/s-stevenson.json and data/votes/e-peloza.json before writing the
 * assertions (see the PR description for the exact `python3` spot-checks).
 *
 * Root causes under test (see PR description for the full diagnosis):
 *  1. Strategy 1 (month/year) used to preempt councillor-voting queries before the
 *     structured vote lookup ever ran - it now has the same guard Strategy 2 already
 *     had, and a month/year now NARROWS the structured lookup instead of bypassing it.
 *  2. extractTopicKeywords used to REPLACE specific query terms (e.g. "Duluth
 *     Crescent") with a generic dictionary phrase - it now APPENDS.
 *  3. findCouncillorVote used to pick a single best-scoring argmax with only a 0.3
 *     ratio floor, which let an unrelated record win on a diluted/generic keyword set.
 *     It now requires the agenda item's own TITLE to be keyword-anchored, an absolute
 *     match-count floor, and returns every motion recorded on the winning (date,
 *     itemTitle) pair instead of only the single top-scoring row.
 */

import test, { describe, before } from "node:test";
import assert from "node:assert";
import { readFileSync } from "fs";
import { join } from "path";
import { RAGService } from "./rag-service.js";
import { voteLookupService } from "./vote-lookup.js";

// RAGService's constructor only stores its constructor args and kicks off a local
// (network-free) initializeServices() call - it does not touch OpenAI/Anthropic/LanceDB
// until a method that actually needs them is called (generateQueryEmbedding,
// retrieveContext's hybrid search, etc). We never call those here, so a fake API key
// and a stub vector store are sufficient to exercise the pure query-analysis methods.
// Cast to `any` throughout because analyzeQuery/extractTopicKeywords/
// councillorNameToSlug are private - this is the same pattern the codebase already
// uses to unit-test private analysis logic in isolation.
const rag: any = new RAGService(
  "fake-openai-key",
  undefined,
  {} as any,
  "anthropic",
);

function topicKeywordsFor(query: string): string[] {
  const raw: string | null = rag.extractTopicKeywords(query);
  return raw?.split(" ").filter((k: string) => k.length > 2) || [];
}

describe("Flagship case: natural-phrasing Duluth Crescent councillor-vote query", () => {
  const flagshipQuery =
    "How did Susan Stevenson vote on the affordable housing land at Duluth Crescent in June 2026?";

  before(async () => {
    await voteLookupService.initialize();
  });

  test("routing: a month/year on a councillor-voting query does NOT trip Strategy 1's bypass", () => {
    const analysis = rag.analyzeQuery(flagshipQuery);
    assert.strictEqual(
      analysis.isCouncillorVotingQuery,
      true,
      "should be detected as a councillor-voting query",
    );
    assert.deepStrictEqual(
      analysis.specificMonth,
      { month: 5, year: 2026 },
      "should extract June 2026",
    );

    // This is the exact guard now on Strategy 1 in rag-service.ts's retrieveContext():
    // `if (specificMonth && !isCouncillorVotingQuery && !isMultiHopQuery)`. For this
    // query the guard must evaluate false, so Strategy 1 is skipped and the structured
    // vote lookup (Strategy 4) runs instead of an all-zero-vector date-range dump.
    const strategy1Fires = !!(
      analysis.specificMonth &&
      !analysis.isCouncillorVotingQuery &&
      !analysis.isMultiHopQuery
    );
    assert.strictEqual(
      strategy1Fires,
      false,
      "Strategy 1 must be skipped for a councillor-voting query",
    );
  });

  test("regression guard: a plain (non-councillor) month/year query still hits Strategy 1", () => {
    const analysis = rag.analyzeQuery(
      "What meetings happened in November 2025?",
    );
    assert.strictEqual(analysis.isCouncillorVotingQuery, false);
    assert.ok(analysis.specificMonth, "should still extract a specific month");

    const strategy1Fires = !!(
      analysis.specificMonth &&
      !analysis.isCouncillorVotingQuery &&
      !analysis.isMultiHopQuery
    );
    assert.strictEqual(
      strategy1Fires,
      true,
      "Strategy 1 must still fire for a genuine date-range query",
    );
  });

  test("extractTopicKeywords APPENDS dictionary expansions, never discarding 'Duluth Crescent'", () => {
    const keywords = topicKeywordsFor(flagshipQuery);
    assert.ok(
      keywords.includes("duluth"),
      `expected "duluth" in ${JSON.stringify(keywords)}`,
    );
    assert.ok(
      keywords.includes("crescent"),
      `expected "crescent" in ${JSON.stringify(keywords)}`,
    );
    // The dictionary expansion should still be present (appended, not instead-of)
    assert.ok(
      keywords.includes("housing"),
      "dictionary expansion should still be appended",
    );
  });

  test("end-to-end: findCouncillorVote returns BOTH Duluth motions (8-6 and 13-1), narrowed to June 2026, excluding the unrelated same-meeting 7-6 item", () => {
    const keywords = topicKeywordsFor(flagshipQuery);
    const specificMonth = rag.analyzeQuery(flagshipQuery).specificMonth;
    const results = voteLookupService.findCouncillorVote(
      "s-stevenson",
      keywords,
      {
        month: specificMonth.month,
        year: specificMonth.year,
      },
    );

    assert.ok(results, "should find a match");
    assert.strictEqual(
      results!.length,
      2,
      "the Duluth agenda item has two recorded motions - both must be returned",
    );

    for (const r of results!) {
      assert.strictEqual(r.vote.date, "2026-06-23");
      assert.match(
        r.vote.itemTitle,
        /Duluth Crescent/,
        "every returned motion must be the Duluth Crescent item",
      );
    }

    const outcomes = results!.map((r) => r.vote.result).sort();
    assert.deepStrictEqual(outcomes, [
      "Motion Passed (13 to 1)",
      "Motion Passed (8 to 6)",
    ]);

    // GROUND TRUTH (vote-lookup.ts:234-279 root cause #3 / ground truth case 1):
    // Stevenson voted NAY on both.
    for (const r of results!) {
      assert.strictEqual(r.vote.vote, "nay");
    }

    // GROUND TRUTH (ground truth case 2): the same meeting's item 8.5.12
    // "Third-Party Appeal Mechanism" (Motion Passed 7 to 6) must NEVER be returned for
    // a Duluth query, even though it's a close same-day tally that could get blended in.
    for (const r of results!) {
      assert.doesNotMatch(r.vote.itemTitle, /Third-Party Appeal/);
      assert.notStrictEqual(r.vote.result, "Motion Passed (7 to 6)");
    }
  });
});

describe("Ground truth case: Peloza YMCA recusal (2026-05-12)", () => {
  before(async () => {
    await voteLookupService.initialize();
  });

  test("findCouncillorVote finds the YMCA Centre Branch recusal, not an absence", () => {
    const keywords = topicKeywordsFor(
      "How did Councillor Peloza vote on the YMCA Centre Branch agreement?",
    );
    const results = voteLookupService.findCouncillorVote("e-peloza", keywords, {
      month: 4,
      year: 2026,
    });

    assert.ok(results, "should find a match");
    assert.strictEqual(results!.length, 1);
    const v = results![0].vote;
    assert.strictEqual(v.date, "2026-05-12");
    assert.match(v.itemTitle, /YMCA Centre Branch/);
    assert.strictEqual(
      v.vote,
      "recuse",
      "must be classified as recuse, not absent",
    );
    assert.strictEqual(v.result, "Motion Passed (13 to 0)");
  });
});

describe("Ground truth case: By-law Enforcement Administrative Fees (2026-07-21)", () => {
  before(async () => {
    await voteLookupService.initialize();
  });

  test("findCouncillorVote finds Stevenson's nay on the failed 7-8 motion, narrowed to July 2026", () => {
    const keywords = topicKeywordsFor(
      "How did Stevenson vote on By-law Enforcement Administrative Fees in July 2026?",
    );
    const results = voteLookupService.findCouncillorVote(
      "s-stevenson",
      keywords,
      { month: 6, year: 2026 },
    );

    assert.ok(results, "should find a match");
    assert.strictEqual(results!.length, 1);
    const v = results![0].vote;
    assert.strictEqual(v.date, "2026-07-21");
    assert.match(v.itemTitle, /By-law Enforcement Administrative Fees/);
    assert.strictEqual(v.vote, "nay");
    assert.strictEqual(v.result, "Motion Failed (7 to 8)");
    assert.strictEqual(v.passed, false);
  });
});

describe("Ground truth case: diluted/generic keyword floor - must never resolve to the unrelated 2025-02-11 'Communications and Petitions' record", () => {
  before(async () => {
    await voteLookupService.initialize();
  });

  test("a pure generic dictionary-only 'housing' keyword set (no identifying term) never matches the procedural Communications and Petitions item", () => {
    // This is exactly the pre-fix extractTopicKeywords output for any query containing
    // "housing" with no other identifying term - the generic dictionary phrase with no
    // proper noun to anchor it. Before the itemTitle-anchor + absolute-floor fix, this
    // set scored 0.889 (8/9) against the 2025-02-11 record purely because its
    // (truncated) motion text happens to mention "Affordable Housing", "Social [and
    // Health]", "Homelessness", and "Unsheltered" (which contains "shelter" as a raw
    // substring) - none of which describe what that record actually is (a routine
    // "communications received" item).
    const genericHousingKeywords =
      "housing affordable housing social housing homelessness shelter supportive housing"
        .split(" ")
        .filter((k) => k.length > 2);

    const results = voteLookupService.findCouncillorVote(
      "s-stevenson",
      genericHousingKeywords,
    );

    if (results) {
      for (const r of results) {
        assert.notStrictEqual(
          r.vote.date,
          "2025-02-11",
          "must not match the unrelated 2025-02-11 record",
        );
        assert.notStrictEqual(
          r.vote.itemTitle,
          "Communications and Petitions",
          "must not match the procedural Communications and Petitions item",
        );
      }
    }
    // No match at all is also an acceptable outcome for a fully generic keyword set -
    // the requirement is only that the WRONG unrelated record is never returned; the
    // assertions above already guarantee that when a result IS returned.
  });

  test("sanity: the false-positive record genuinely exists and genuinely scores high under the OLD (pre-fix) scoring - confirms the fixture, not just the fix", () => {
    // Reproduces the pre-fix calculateMatchScore behaviour inline (ratio-only, no
    // itemTitle anchor, no absolute floor) to prove this test would have failed before
    // the fix - i.e. it's a real regression guard, not a tautology.
    function normalizeForMatch(text: string): string {
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function oldCalculateMatchScore(text: string, keywords: string[]): number {
      const normalized = normalizeForMatch(text);
      let matches = 0;
      for (const kw of keywords) {
        if (normalized.includes(normalizeForMatch(kw))) matches++;
      }
      return matches / keywords.length;
    }

    const genericHousingKeywords =
      "housing affordable housing social housing homelessness shelter supportive housing"
        .split(" ")
        .filter((k) => k.length > 2);

    // Access the real fixture data the same way vote-lookup.ts does, via a fresh read
    // (not exported internals) - keeps this test honest about what's actually on disk.
    const votesPath = join(process.cwd(), "data", "votes", "s-stevenson.json");
    const data = JSON.parse(readFileSync(votesPath, "utf-8"));
    const target = data.votes.find(
      (v: any) =>
        v.date === "2025-02-11" &&
        v.itemTitle === "Communications and Petitions",
    );
    assert.ok(
      target,
      "fixture sanity: the 2025-02-11 Communications and Petitions record must exist in the data",
    );

    const oldScore = oldCalculateMatchScore(
      `${target.itemTitle} ${target.motionText}`,
      genericHousingKeywords,
    );
    assert.ok(
      oldScore >= 0.8,
      `expected the old scoring to rate this a strong (>=0.8) match, got ${oldScore}`,
    );
  });
});
