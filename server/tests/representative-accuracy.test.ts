/**
 * Representative Accuracy Test Suite
 *
 * 15 tests for rapid iteration during TOP_K and model testing.
 * Selected to cover key query types:
 * - Easy (4): Simple vote lookups - test structured vote data
 * - Medium (5): Councillor stances - test councillor stats
 * - Hard (4): Comparisons, alignment - test alignment stats
 * - Very Hard (2): Nuanced questions - stress test
 *
 * Run with: npm run test -- server/tests/representative-accuracy.test.ts
 */

import test, { describe } from 'node:test';
import assert from 'node:assert';

const CHATBOT_URL = process.env.CHATBOT_URL || 'https://open-council-production.up.railway.app/api/chat';

interface AccuracyTestCase {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'very_hard';
  category: string;
  question: string;
  expectedContent: string[];  // ANY of these should appear
  requiredContent?: string[]; // ALL of these must appear
  unexpectedContent?: string[]; // NONE of these should appear
  verifiedAnswer: string;
}

// Helper to query the chatbot
async function queryChat(question: string): Promise<string> {
  const response = await fetch(CHATBOT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: question }),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  const text = await response.text();
  let fullContent = '';

  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.content) fullContent += data.content;
        if (data.error) throw new Error(data.error);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  return fullContent;
}

// =============================================================================
// REPRESENTATIVE TEST CASES - 15 TOTAL
// =============================================================================

const testCases: AccuracyTestCase[] = [
  // ===========================================================================
  // EASY (4 tests) - Direct vote lookups (test structured vote data)
  // ===========================================================================
  {
    id: 'rep-easy-001',
    difficulty: 'easy',
    category: 'vote-outcome',
    question: 'Did the Cooling By-law pass or fail?',
    expectedContent: ['failed', 'fail', 'not pass', 'defeated', '7 to 8', '7-8'],
    verifiedAnswer: 'The Cooling By-law failed 7-8 at the October 14, 2025 Council meeting.',
  },
  {
    id: 'rep-easy-002',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'How did Mayor Morgan vote on the Cooling By-law?',
    expectedContent: ['against', 'nay', 'no', 'opposed'],
    requiredContent: ['Morgan'],
    verifiedAnswer: 'Mayor Morgan voted NAY (against) the Cooling By-law.',
  },
  {
    id: 'rep-easy-003',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'Did Councillor Trosow support the Cooling By-law?',
    expectedContent: ['yes', 'yea', 'favor', 'supported', 'for'],
    requiredContent: ['Trosow'],
    verifiedAnswer: 'Councillor Trosow voted YEA (in favor) of the Cooling By-law.',
  },
  {
    id: 'rep-easy-004',
    difficulty: 'easy',
    category: 'vote-count',
    question: 'Who voted against the Bike Parking Implementation Plan?',
    expectedContent: ['Stevenson', 'Van Meerbergen'],
    verifiedAnswer: 'Van Meerbergen and Stevenson voted against (13-2 passed).',
  },

  // ===========================================================================
  // MEDIUM (5 tests) - Councillor stances (test councillor stats)
  // ===========================================================================
  {
    id: 'rep-medium-001',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Does Councillor Stevenson tend to support or oppose transit spending?',
    expectedContent: ['oppose', 'against', 'no', 'dissent', 'nay', 'fiscal', 'conservative'],
    requiredContent: ['Stevenson'],
    verifiedAnswer: 'Stevenson typically opposes transit/cycling spending, voting against BRT and bike infrastructure.',
  },
  {
    id: 'rep-medium-002',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Is Shawn Lewis generally aligned with the Mayor?',
    expectedContent: ['yes', 'aligned', 'votes with', 'supports', 'ally', 'together'],
    requiredContent: ['Lewis'],
    verifiedAnswer: 'Yes, Lewis is one of the councillors most aligned with Mayor Morgan.',
  },
  {
    id: 'rep-medium-003',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Who tends to vote with Councillor Trosow?',
    expectedContent: ['Lehman', 'Peloza', 'Franke', 'progressive'],
    requiredContent: ['Trosow'],
    verifiedAnswer: 'Trosow tends to vote with Lehman, Peloza, and Franke on progressive issues.',
  },
  {
    id: 'rep-medium-004',
    difficulty: 'medium',
    category: 'alignment',
    question: 'Who usually votes with the Mayor?',
    expectedContent: ['Lewis', 'Hillier', 'Lehman', 'Cuddy'],
    verifiedAnswer: 'Lewis, Hillier, Lehman, and Cuddy frequently vote with Mayor Morgan.',
  },
  {
    id: 'rep-medium-005',
    difficulty: 'medium',
    category: 'alignment',
    question: 'Who tends to be the lone dissenter on council votes?',
    expectedContent: ['Stevenson', 'lone', 'dissent', 'against'],
    verifiedAnswer: 'Stevenson is often the lone dissenter, especially on spending measures.',
  },

  // ===========================================================================
  // HARD (4 tests) - Comparisons and patterns (test alignment analysis)
  // ===========================================================================
  {
    id: 'rep-hard-001',
    difficulty: 'hard',
    category: 'comparison',
    question: 'Compare the voting patterns of Stevenson and Trosow. Do they usually agree or disagree?',
    expectedContent: ['disagree', 'opposite', 'different', 'rarely', 'opposed', 'diverge'],
    requiredContent: ['Stevenson', 'Trosow'],
    verifiedAnswer: 'Stevenson and Trosow often vote opposite - Stevenson is fiscally conservative, Trosow is progressive.',
  },
  {
    id: 'rep-hard-002',
    difficulty: 'hard',
    category: 'voting-bloc',
    question: 'Is there a progressive bloc on council? Who are its members?',
    expectedContent: ['Trosow', 'Lehman', 'Peloza', 'progressive', 'bloc', 'group'],
    verifiedAnswer: 'Yes, Trosow, Lehman, and Peloza often form a progressive voting bloc.',
  },
  {
    id: 'rep-hard-003',
    difficulty: 'hard',
    category: 'close-vote',
    question: 'What issues divide council most evenly?',
    expectedContent: ['Cooling', 'Urban Growth', '7-8', '8-7', 'close', 'split', 'divided'],
    verifiedAnswer: 'The Cooling By-law (7-8) and Urban Growth Boundary (7-8) were deeply divided.',
  },
  {
    id: 'rep-hard-004',
    difficulty: 'hard',
    category: 'pattern',
    question: 'What predicts how Van Meerbergen will vote on an issue?',
    expectedContent: ['cost', 'fiscal', 'spending', 'taxes', 'budget', 'bike', 'cycling', 'conservative'],
    requiredContent: ['Van Meerbergen'],
    verifiedAnswer: 'Van Meerbergen votes based on fiscal impact - opposes tax increases and cycling spending.',
  },

  // ===========================================================================
  // VERY HARD (2 tests) - Nuanced questions (stress test)
  // ===========================================================================
  {
    id: 'rep-vhard-001',
    difficulty: 'very_hard',
    category: 'hypothetical',
    question: 'If Stevenson had voted yes on the Cooling By-law, would it have passed?',
    expectedContent: ['yes', 'would have passed', 'tie', '8-7', 'would pass', 'enough'],
    requiredContent: ['Stevenson'],
    verifiedAnswer: 'Yes - the vote was 7-8. With Stevenson switching, it would be 8-7 in favor.',
  },
  {
    id: 'rep-vhard-002',
    difficulty: 'very_hard',
    category: 'swing-voters',
    question: 'Who are the swing voters or centrists that could go either way on close votes?',
    expectedContent: ['McAlister', 'Lehman', 'swing', 'centrist', 'varies', 'depends'],
    verifiedAnswer: 'McAlister and Lehman are often swing voters on close council decisions.',
  },
];

// =============================================================================
// TEST RUNNER
// =============================================================================

describe('Representative Accuracy Tests (15 questions)', { timeout: 300000 }, () => {
  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    test(`[${tc.id}] ${tc.question}`, async () => {
      const response = await queryChat(tc.question);
      const lowerResponse = response.toLowerCase();

      // Check required content (ALL must appear)
      if (tc.requiredContent) {
        for (const required of tc.requiredContent) {
          assert.ok(
            lowerResponse.includes(required.toLowerCase()),
            `Missing required content: "${required}"\nResponse: ${response.substring(0, 500)}...`
          );
        }
      }

      // Check expected content (ANY should appear)
      const hasExpected = tc.expectedContent.some(
        expected => lowerResponse.includes(expected.toLowerCase())
      );
      assert.ok(
        hasExpected,
        `None of expected content found: ${tc.expectedContent.join(', ')}\nResponse: ${response.substring(0, 500)}...`
      );

      // Check unexpected content (NONE should appear)
      if (tc.unexpectedContent) {
        for (const unexpected of tc.unexpectedContent) {
          assert.ok(
            !lowerResponse.includes(unexpected.toLowerCase()),
            `Found unexpected content: "${unexpected}"\nResponse: ${response.substring(0, 500)}...`
          );
        }
      }

      passed++;
      console.log(`  ✅ ${tc.id}: PASSED`);
    });
  }

  test.after(() => {
    console.log(`\n📊 Representative Test Results: ${passed}/${testCases.length} passed (${Math.round(passed/testCases.length*100)}%)`);
  });
});
