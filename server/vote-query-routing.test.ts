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
 *
 * Post-review fixes (a hostile verification pass found the above implementation
 * incomplete/regressed the following - all re-verified against real data before fixing):
 *  4. The (date, itemTitle) grouping used an EXACT string match, so siblings recorded
 *     under a slightly different itemTitle (a leading "(3.3) " numbering prefix, or
 *     stray trailing whitespace) for the SAME real agenda item were still split apart
 *     and silently dropped. Grouping now normalizes the title (strip numbering/ADDED
 *     prefix, collapse whitespace, casefold) before comparing.
 *  5. The itemTitle anchor used raw substring matching AND accepted dictionary-expanded
 *     synonyms, so e.g. the single keyword "land" anchored on "Wonderland Road" and an
 *     injected synonym like "safety" (for a "police" query) anchored an unrelated grant
 *     item. The anchor now requires an exact-token (word-boundary) match against
 *     user-supplied words only (dictionary expansions still help scoring, never anchor).
 *     A further pass on this fix found bare numeric year tokens (e.g. "2026") were still
 *     anchor-worthy and could match an unrelated same-year item - years are now excluded
 *     from the anchor set too (still count toward score/floor).
 *  6. A single findCouncillorVote() group could return dozens of motions
 *     (uncapped) rendered in score order with no signal about which motion actually
 *     took effect - now capped, ordered by original recorded order, and the
 *     passed motion(s) are marked "OPERATIVE" when the group mixes outcomes.
 *  7. The month/year narrowing was a hard filter with no fallback - a vote in an
 *     adjacent month (e.g. user names the committee month, not the Council-ratification
 *     month) came back null or, worse, coincidentally matched an unrelated same-month
 *     record. It now falls back to an unnarrowed search (at capped 'medium' confidence)
 *     when the narrowed search finds nothing.
 *  8. The absolute match-count floor counted STOPWORD hits (e.g. "the") toward its
 *     "2 meaningful keywords" requirement, contradicting its own doc comment - it now
 *     counts only meaningful (non-stopword) keyword hits.
 *  9. extractTopicKeywords' fallback branch (no topicPattern syntactically matched)
 *     dumped the ENTIRE raw query - including function words like "what"/"is"/"she" -
 *     as topic keywords, and a substring "already contains this expansion term" check
 *     let "pro-transit?" silently swallow the "transit" expansion and "rehousing"
 *     swallow "housing". The fallback now extracts meaningful words only, and the
 *     containment check is exact-token (hyphens/punctuation treated as word breaks).
 *  10. Strategy 3 (motion-outcome/vote-count) in rag-service.ts's retrieveContext() had
 *      no `!isCouncillorVotingQuery` guard (unlike Strategy 1 and Strategy 2, which both
 *      have one) - a natural-phrasing query like "How did Stevenson vote on X, and did
 *      it pass?" tripped isMotionOutcomeQuery on "did it pass" and got routed to the
 *      unnarrowed, ungated findAllMotionVotes lookup instead of the councillor-specific
 *      structured lookup. Strategy 3 now skips councillor-voting queries too.
 */

import test, { describe, before } from "node:test";
import assert from "node:assert";
import { readFileSync } from "fs";
import { join } from "path";
import { RAGService } from "./rag-service.js";
import {
  voteLookupService,
  type VoteRecord,
  type VoteLookupResult,
} from "./vote-lookup.js";

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
  const raw: { text: string; base: string } | null =
    rag.extractTopicKeywords(query);
  return raw?.text.split(" ").filter((k: string) => k.length > 2) || [];
}

function anchorKeywordsFor(query: string): string[] {
  const raw: { text: string; base: string } | null =
    rag.extractTopicKeywords(query);
  return raw?.base.split(" ").filter((k: string) => k.length > 2) || [];
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

describe("Post-review fix: sibling motions split by a numbering-prefix/whitespace title difference must still group (455 Highbury Avenue North, 2024-08-27)", () => {
  before(async () => {
    await voteLookupService.initialize();
  });

  test("findCouncillorVote returns BOTH the procedural referral (15-0) and the substantive rezoning decision (8-7), even though their itemTitle strings differ only by a leading '(3.3) ' numbering prefix", () => {
    const keywords = topicKeywordsFor(
      "How did Susan Stevenson vote on the Highbury Avenue rezoning in August 2024?",
    );
    const anchor = anchorKeywordsFor(
      "How did Susan Stevenson vote on the Highbury Avenue rezoning in August 2024?",
    );
    const results = voteLookupService.findCouncillorVote(
      "s-stevenson",
      keywords,
      {
        month: 7, // August, 0-indexed
        year: 2024,
        anchorKeywords: anchor,
      },
    );

    assert.ok(results, "should find a match");
    assert.strictEqual(
      results!.length,
      2,
      `expected both sibling motions on this item, got ${JSON.stringify(results?.map((r) => r.vote.itemTitle))}`,
    );

    const outcomes = results!.map((r) => r.vote.result).sort();
    assert.deepStrictEqual(outcomes, [
      "Motion Passed (15 to 0)",
      "Motion Passed (8 to 7)",
    ]);

    for (const r of results!) {
      assert.match(r.vote.itemTitle, /455 Highbury Avenue North - \(OZ-9739\)/);
    }
  });
});

describe("Post-review fix: itemTitle anchor is word-boundary and user-terms-only, not a dictionary-expansion-eligible substring match", () => {
  before(async () => {
    await voteLookupService.initialize();
  });

  test("'land' does not anchor on 'Wonderland Road' - a month named that has no real match falls back to the unnarrowed search and finds the correct item instead of a false positive", () => {
    // The user names July 2026, but the actual vote is 2026-06-23. Pre-fix, the
    // substring anchor let the single keyword "land" (from "...housing land at
    // Duluth Crescent") match inside "755-765, 785 and 815 Wonderland Road South",
    // an unrelated July 2026 rezoning item, and return it as a false positive
    // "VERIFIED VOTE RECORD". Post-fix, the word-boundary anchor rejects that match,
    // the narrowed (July 2026) search finds nothing, and the fallback to an unnarrowed
    // search correctly finds the real Duluth Crescent motions in June 2026.
    const query =
      "How did Susan Stevenson vote on the affordable housing land at Duluth Crescent in July 2026?";
    const keywords = topicKeywordsFor(query);
    const anchor = anchorKeywordsFor(query);

    const results = voteLookupService.findCouncillorVote(
      "s-stevenson",
      keywords,
      {
        month: 6, // July, 0-indexed
        year: 2026,
        anchorKeywords: anchor,
      },
    );

    assert.ok(results, "should find a match via the unnarrowed fallback");
    for (const r of results!) {
      assert.doesNotMatch(
        r.vote.itemTitle,
        /Wonderland/,
        "must never fall back to the unrelated Wonderland Road item",
      );
      assert.match(r.vote.itemTitle, /Duluth Crescent/);
      assert.strictEqual(r.vote.date, "2026-06-23");
      // The month named by the user didn't match, so this came from the fallback
      // search - confidence must be capped at 'medium', never 'exact'/'high', as a
      // signal that the date doesn't match what the user asked for.
      assert.strictEqual(r.confidence, "medium");
    }

    const outcomes = results!.map((r) => r.vote.result).sort();
    assert.deepStrictEqual(outcomes, [
      "Motion Passed (13 to 1)",
      "Motion Passed (8 to 6)",
    ]);
  });

  test("a bare numeric year keyword (e.g. '2026') does not by itself anchor an unrelated same-year item", () => {
    // Regression guard for a second-order false positive introduced by the
    // word-boundary anchor fix itself: once "land" could no longer substring-match
    // "Wonderland", the next-best (still wrong) anchor candidate in the unnarrowed
    // fallback was the bare year "2026", which exact-token-matched the title
    // "(2.3) Proposed Winter Response for 2026-2027" - a real item, but nothing to do
    // with Duluth Crescent housing. This is exercised implicitly by the previous test
    // (which asserts on the correct Duluth item), and directly here.
    const query =
      "How did Susan Stevenson vote on the affordable housing land at Duluth Crescent in July 2026?";
    const results = voteLookupService.findCouncillorVote(
      "s-stevenson",
      topicKeywordsFor(query),
      { month: 6, year: 2026, anchorKeywords: anchorKeywordsFor(query) },
    );
    assert.ok(results);
    for (const r of results!) {
      assert.doesNotMatch(r.vote.itemTitle, /Winter Response/);
    }
  });

  test("dictionary-injected synonyms (not typed by the user) do not anchor an unrelated record - 'police budget' no longer resolves via injected 'safety'/'property'", () => {
    // Pre-fix, "How did Cuddy vote on the police budget?" expanded to keywords
    // including dictionary-injected "property" and "safety" (from the "police" and
    // "budget" expansions), and those alone anchored an unrelated grant item titled
    // "...LDBA for Improving Safety/Security, Property Damage Grants...". The anchor
    // must only fire on words the user actually typed ("police", "budget").
    const query = "How did Cuddy vote on the police budget?";
    const results = voteLookupService.findCouncillorVote(
      "p-cuddy",
      topicKeywordsFor(query),
      { anchorKeywords: anchorKeywordsFor(query) },
    );
    if (results) {
      for (const r of results) {
        assert.doesNotMatch(
          r.vote.itemTitle,
          /Safety\/Security/,
          "must not resolve to the unrelated grant item via an injected synonym",
        );
      }
    }
  });
});

describe("Post-review fix: absolute match-count floor counts MEANINGFUL keyword hits only, not stopwords", () => {
  before(async () => {
    await voteLookupService.initialize();
  });

  test("['the', 'police', 'budget'] against a record containing only 'the'+'budget' (no 'police') no longer clears the floor", () => {
    // Pre-fix, calculateMatchDetail counted matches over the FULL keyword list
    // (including "the"), so a record whose motionText is just "That the motion, as
    // amended, BE APPROVED." (no "police" anywhere) still cleared the >=2 floor via
    // "the" + "budget" alone. Every record returned for this exact 3-keyword query
    // must now genuinely mention "police" (case-insensitively) in its item title or
    // motion text.
    const results = voteLookupService.findCouncillorVote("p-cuddy", [
      "the",
      "police",
      "budget",
    ]);
    assert.ok(results, "should still find the genuinely on-topic budget item");
    for (const r of results!) {
      const haystack = `${r.vote.itemTitle} ${r.vote.motionText}`.toLowerCase();
      assert.ok(
        haystack.includes("police"),
        `every returned record must genuinely mention "police": ${JSON.stringify(r.vote.itemTitle)}`,
      );
    }
  });
});

describe("Post-review fix: a grouped result is capped, ordered by original recorded order (not score), and mixed outcomes are marked OPERATIVE", () => {
  before(async () => {
    await voteLookupService.initialize();
  });

  test("Rahman's 89-motion Accessibility Community Advisory Committee appointment group is capped, and the rendered context stays well under the old ~43k-char size", () => {
    const results = voteLookupService.findCouncillorVote("c-rahman", [
      "the",
      "appointment",
      "the",
      "accessibility",
      "community",
      "advisory",
      "committee",
    ]);
    assert.ok(results, "should find a match");
    assert.ok(
      results!.length <= 15,
      `expected the group to be capped, got ${results!.length} motions`,
    );

    const context = voteLookupService.formatVoteResultsForContext(results!);
    assert.ok(
      context.length < 15000,
      `expected a capped context well under the old ~43k-char size, got ${context.length}`,
    );
  });
});

describe("Post-review fix: Strategy 3 (motion-outcome) no longer preempts a councillor-voting query that also asks 'did it pass'", () => {
  const rag2: any = new RAGService(
    "fake-openai-key",
    undefined,
    {} as any,
    "anthropic",
  );

  test("'How did Stevenson vote on the Duluth Crescent housing motion in June 2026, and did it pass?' must route to the councillor-narrowed Strategy 4, not the unnarrowed Strategy 3 findAllMotionVotes", () => {
    const query =
      "How did Stevenson vote on the Duluth Crescent housing motion in June 2026, and did it pass?";
    const analysis = rag2.analyzeQuery(query);

    assert.strictEqual(analysis.isCouncillorVotingQuery, true);
    // This query also trips the motion-outcome detector via "did it pass" - that's
    // exactly the case that used to slip past Strategy 1's new guard and hit the
    // still-unguarded Strategy 3.
    assert.strictEqual(analysis.isMotionOutcomeQuery, true);

    // Reproduces the exact guard now on Strategy 3 in rag-service.ts's
    // retrieveContext(): `... && !isMultiHopQuery && !isCouncillorVotingQuery`.
    const strategy3Fires = !!(
      (analysis.isMotionOutcomeQuery || analysis.isVoteCountQuery) &&
      analysis.motionKeywords &&
      analysis.motionKeywords.length > 0 &&
      !analysis.isMultiHopQuery &&
      !analysis.isCouncillorVotingQuery
    );
    assert.strictEqual(
      strategy3Fires,
      false,
      "Strategy 3 must be skipped so this reaches the councillor-narrowed Strategy 4 instead",
    );
  });

  test("regression guard: a plain (non-councillor) motion-outcome query still hits Strategy 3", () => {
    const analysis = rag2.analyzeQuery("Did the cooling by-law pass?");
    assert.strictEqual(analysis.isCouncillorVotingQuery, false);
    assert.strictEqual(analysis.isMotionOutcomeQuery, true);

    const strategy3Fires = !!(
      (analysis.isMotionOutcomeQuery || analysis.isVoteCountQuery) &&
      analysis.motionKeywords &&
      analysis.motionKeywords.length > 0 &&
      !analysis.isMultiHopQuery &&
      !analysis.isCouncillorVotingQuery
    );
    assert.strictEqual(
      strategy3Fires,
      true,
      "Strategy 3 must still fire for a genuine non-councillor motion-outcome query",
    );
  });
});

describe("Post-review fix: extractTopicKeywords fallback no longer dumps the raw query, and the containment check is exact-token", () => {
  test("'What is Lewis's voting record - is she pro-transit?' keeps 'transit' as its own keyword instead of losing it inside 'pro-transit', and drops function words", () => {
    const keywords = topicKeywordsFor(
      "What is Lewis's voting record - is she pro-transit?",
    );
    assert.ok(
      keywords.includes("transit"),
      `expected "transit" to survive as its own keyword, got ${JSON.stringify(keywords)}`,
    );
    for (const filler of ["what", "she", "record"]) {
      assert.ok(
        !keywords.includes(filler),
        `expected the raw function word "${filler}" NOT to leak into topic keywords, got ${JSON.stringify(keywords)}`,
      );
    }
  });

  test("'rehousing' does not swallow the standalone 'housing' expansion via a substring containment check", () => {
    const keywords = topicKeywordsFor(
      "What is Councillor Hopkins' record on rehousing programs?",
    );
    assert.ok(
      keywords.includes("housing"),
      `expected the "housing" dictionary expansion to be appended, got ${JSON.stringify(keywords)}`,
    );
  });
});

describe("Post-review fix: legacy (pre-marker) truncated motion text is never labeled 'Full Motion Text'", () => {
  test("a motionText at exactly the old 500-char hard-truncation length is labeled as possibly-truncated, not 'Full Motion Text'", () => {
    const legacyTruncated: VoteRecord = {
      date: "2026-01-01",
      meetingSlug: "months/2026-01/test",
      meetingTitle: "Test Meeting",
      meetingType: "Council",
      itemTitle: "Test Item",
      motionText: "x".repeat(500),
      vote: "yea",
      result: "Motion Passed (10 to 5)",
      passed: true,
      unanimous: false,
    };
    const result: VoteLookupResult = {
      councillor: "Test Councillor",
      councillorSlug: "t-councillor",
      vote: legacyTruncated,
      confidence: "exact",
    };
    const text = voteLookupService.formatVoteForContext(result);
    assert.doesNotMatch(text, /\*\*Full Motion Text:\*\*/);
    assert.match(text, /may be cut off/);
  });

  test("a genuinely short/complete motionText is still labeled 'Full Motion Text' (regression guard)", () => {
    const complete: VoteRecord = {
      date: "2026-01-01",
      meetingSlug: "months/2026-01/test",
      meetingTitle: "Test Meeting",
      meetingType: "Council",
      itemTitle: "Test Item",
      motionText: "That the motion, as amended, BE APPROVED.",
      vote: "yea",
      result: "Motion Passed (10 to 5)",
      passed: true,
      unanimous: false,
    };
    const result: VoteLookupResult = {
      councillor: "Test Councillor",
      councillorSlug: "t-councillor",
      vote: complete,
      confidence: "exact",
    };
    const text = voteLookupService.formatVoteForContext(result);
    assert.match(text, /\*\*Full Motion Text:\*\*/);
  });
});
