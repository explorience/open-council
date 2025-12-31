/**
 * Councillor Voting Pattern Test Suite
 *
 * This test suite evaluates the chatbot's ability to answer questions about
 * individual councillor voting records based on London, Ontario city council
 * meeting data.
 *
 * Test Categories:
 * - individual-vote: Questions about how a specific councillor voted on a specific motion
 * - voting-record: Questions about a councillor's voting pattern on topics
 * - opposition-votes: Questions about who voted against specific motions
 * - close-votes: Questions about contentious votes that passed or failed narrowly
 *
 * VERIFIED DATA SOURCES:
 * All test cases are based on verified voting records from:
 * - 2025-10-14 16th Council Meeting
 * - 2025-04-22 7th Council Meeting
 * - 2025-11-04 17th Council Meeting
 *
 * Current Council Members (2022-2026 Term):
 * Mayor: J. Morgan (Josh Morgan)
 * Councillors: H. McAlister, S. Lewis (Deputy Mayor), P. Cuddy, S. Stevenson,
 *              J. Pribil, S. Trosow, C. Rahman, S. Lehman, A. Hopkins,
 *              P. Van Meerbergen, S. Franke, E. Peloza, D. Ferreira, S. Hillier
 *
 * Usage:
 *   npm run test -- server/tests/councillor-votes.test.ts
 *
 * Note: These tests require the chatbot server to be running and
 * the vector store to be populated with embeddings.
 */

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';

// =============================================================================
// Test Case Interface
// =============================================================================

interface CouncillorVoteTestCase {
  /** Unique identifier for the test case */
  id: string;

  /** The question to ask the chatbot */
  question: string;

  /** Category of the test case */
  category: 'individual-vote' | 'voting-record' | 'opposition-votes' | 'close-votes';

  /** Description of what this test is checking */
  description: string;

  /** The verified correct answer based on actual meeting data */
  verifiedAnswer: string;

  /** Expected content that SHOULD appear in the response (any of these) */
  expectedContent?: string[];

  /** Content that MUST appear in the response (all of these) */
  requiredContent?: string[];

  /** Content that should NOT appear in the response */
  unexpectedContent?: string[];

  /** Source meeting date for verification */
  sourceMeeting: string;

  /** The specific motion/item this pertains to */
  motionDescription: string;

  /** The vote result (e.g., "Motion Passed (13 to 2)") */
  voteResult: string;

  /** Tags for filtering tests */
  tags?: string[];
}

// =============================================================================
// Test Cases - Verified from Actual Meeting Data
// =============================================================================

const testCases: CouncillorVoteTestCase[] = [
  // ---------------------------------------------------------------------------
  // INDIVIDUAL VOTE QUESTIONS - How did X vote on Y?
  // ---------------------------------------------------------------------------
  {
    id: 'individual-vote-001',
    question: 'How did Councillor Stevenson vote on the Adequate and Suitable Cooling By-law?',
    category: 'individual-vote',
    description: 'Should identify that Councillor Stevenson voted against the Cooling By-law',
    verifiedAnswer: 'Councillor S. Stevenson voted NAY (against) the Adequate and Suitable Cooling By-law. The motion failed 7 to 8 at the October 14, 2025 Council meeting.',
    expectedContent: ['Stevenson', 'against', 'no', 'nay', 'voted against', 'opposed'],
    requiredContent: ['Stevenson'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Adequate and Suitable Cooling By-law and Maximum Temperature Amendments to the AMPs By-law (A-54)',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['cooling-bylaw', 'housing', 'rental'],
  },
  {
    id: 'individual-vote-002',
    question: 'How did Councillor Trosow vote on the Cooling By-law at the October 2025 council meeting?',
    category: 'individual-vote',
    description: 'Should identify that Councillor Trosow voted in favor of the Cooling By-law',
    verifiedAnswer: 'Councillor S. Trosow voted YEA (in favor of) the Adequate and Suitable Cooling By-law. However, the motion failed 7 to 8.',
    expectedContent: ['Trosow', 'in favor', 'yes', 'yea', 'voted for', 'supported'],
    requiredContent: ['Trosow'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Adequate and Suitable Cooling By-law and Maximum Temperature Amendments to the AMPs By-law (A-54)',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['cooling-bylaw', 'housing', 'rental'],
  },
  {
    id: 'individual-vote-003',
    question: 'How did Mayor Morgan vote on the Cooling By-law?',
    category: 'individual-vote',
    description: 'Should identify that Mayor Morgan voted against the Cooling By-law',
    verifiedAnswer: 'Mayor J. Morgan voted NAY (against) the Adequate and Suitable Cooling By-law. The motion failed 7 to 8.',
    expectedContent: ['Morgan', 'against', 'no', 'nay', 'voted against', 'opposed'],
    requiredContent: ['Morgan'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Adequate and Suitable Cooling By-law and Maximum Temperature Amendments to the AMPs By-law (A-54)',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['cooling-bylaw', 'housing', 'rental', 'mayor'],
  },
  {
    id: 'individual-vote-004',
    question: 'How did Councillor Van Meerbergen vote on the Bike Parking Implementation Plan?',
    category: 'individual-vote',
    description: 'Should identify that Councillor Van Meerbergen voted against the Bike Parking Plan',
    verifiedAnswer: 'Councillor P. Van Meerbergen voted NAY (against) the Bike Parking Implementation Plan 2025-2029. The motion passed 13 to 2.',
    expectedContent: ['Van Meerbergen', 'against', 'no', 'nay', 'voted against', 'opposed'],
    requiredContent: ['Van Meerbergen'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Bike Parking Implementation Plan 2025-2029',
    voteResult: 'Motion Passed (13 to 2)',
    tags: ['bike-parking', 'transportation', 'active-mobility'],
  },
  {
    id: 'individual-vote-005',
    question: 'How did Councillor Stevenson vote on the Temporary Warming Centre Framework?',
    category: 'individual-vote',
    description: 'Should identify that Councillor Stevenson voted against the Warming Centre Framework',
    verifiedAnswer: 'Councillor S. Stevenson voted NAY (against) the Proposed Temporary Warming Centre Framework. The motion passed 14 to 1.',
    expectedContent: ['Stevenson', 'against', 'no', 'nay', 'voted against', 'opposed', 'sole'],
    requiredContent: ['Stevenson'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Proposed Temporary Warming Centre Framework',
    voteResult: 'Motion Passed (14 to 1)',
    tags: ['warming-centre', 'homelessness', 'social-services'],
  },
  {
    id: 'individual-vote-006',
    question: 'How did Councillor Franke vote on the Urban Growth Boundary Review motion?',
    category: 'individual-vote',
    description: 'Should identify that Councillor Franke voted in favor (she sponsored the motion)',
    verifiedAnswer: 'Councillor S. Franke voted YEA (in favor) on the motion to revisit the Urban Growth Boundary Review. The motion failed 7 to 8.',
    expectedContent: ['Franke', 'in favor', 'yes', 'yea', 'voted for', 'supported', 'sponsored'],
    requiredContent: ['Franke'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Revisiting the Urban Growth Boundary Review Using Updated Population Projections',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['urban-growth-boundary', 'planning', 'development'],
  },
  {
    id: 'individual-vote-007',
    question: 'How did Councillor Rahman vote on scheduling a PA Day for Election Day 2026?',
    category: 'individual-vote',
    description: 'Should identify that Councillor Rahman voted against the PA Day motion',
    verifiedAnswer: 'Councillor C. Rahman voted NAY (against) the motion to request school boards schedule a PA Day on Voting Day October 26, 2026. The motion passed 8 to 7.',
    expectedContent: ['Rahman', 'against', 'no', 'nay', 'voted against', 'opposed'],
    requiredContent: ['Rahman'],
    sourceMeeting: '2025-04-22 7th Council Meeting',
    motionDescription: 'Request local school boards to schedule PA Day on Voting Day October 26, 2026',
    voteResult: 'Motion Passed (8 to 7)',
    tags: ['election', 'voting', 'schools'],
  },

  // ---------------------------------------------------------------------------
  // OPPOSITION VOTES - Who voted against X?
  // ---------------------------------------------------------------------------
  {
    id: 'opposition-vote-001',
    question: 'Which councillors voted against the Adequate and Suitable Cooling By-law?',
    category: 'opposition-votes',
    description: 'Should list all 8 councillors who voted against the Cooling By-law',
    verifiedAnswer: 'The following voted NAY on the Cooling By-law (8 votes): Mayor J. Morgan, S. Lewis, S. Hillier, P. Van Meerbergen, S. Lehman, P. Cuddy, S. Stevenson, and J. Pribil. The motion failed 7 to 8.',
    expectedContent: ['Morgan', 'Lewis', 'Hillier', 'Van Meerbergen', 'Lehman', 'Cuddy', 'Stevenson', 'Pribil'],
    requiredContent: ['Morgan', 'Stevenson'],
    unexpectedContent: ['Trosow', 'Franke', 'Ferreira', 'Hopkins', 'McAlister', 'Peloza', 'Rahman'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Adequate and Suitable Cooling By-law',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['cooling-bylaw', 'housing', 'rental'],
  },
  {
    id: 'opposition-vote-002',
    question: 'Who voted in favor of the Cooling By-law?',
    category: 'opposition-votes',
    description: 'Should list all 7 councillors who voted for the Cooling By-law',
    verifiedAnswer: 'The following voted YEA on the Cooling By-law (7 votes): A. Hopkins, E. Peloza, H. McAlister, S. Trosow, S. Franke, D. Ferreira, and C. Rahman.',
    expectedContent: ['Hopkins', 'Peloza', 'McAlister', 'Trosow', 'Franke', 'Ferreira', 'Rahman'],
    requiredContent: ['Trosow', 'Franke'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Adequate and Suitable Cooling By-law',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['cooling-bylaw', 'housing', 'rental'],
  },
  {
    id: 'opposition-vote-003',
    question: 'Which councillors voted against the Bike Parking Implementation Plan?',
    category: 'opposition-votes',
    description: 'Should identify the two councillors who voted against bike parking',
    verifiedAnswer: 'Two councillors voted NAY on the Bike Parking Implementation Plan 2025-2029: P. Van Meerbergen and S. Stevenson. The motion passed 13 to 2.',
    expectedContent: ['Van Meerbergen', 'Stevenson'],
    requiredContent: ['Van Meerbergen', 'Stevenson'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Bike Parking Implementation Plan 2025-2029',
    voteResult: 'Motion Passed (13 to 2)',
    tags: ['bike-parking', 'transportation'],
  },
  {
    id: 'opposition-vote-004',
    question: 'Who voted against the Urban Growth Boundary Review motion?',
    category: 'opposition-votes',
    description: 'Should list the 8 councillors who voted against revisiting the UGB',
    verifiedAnswer: 'The following voted NAY on revisiting the Urban Growth Boundary (8 votes): S. Lewis, S. Hillier, P. Van Meerbergen, S. Lehman, P. Cuddy, S. Stevenson, J. Pribil, and C. Rahman. The motion failed 7 to 8.',
    expectedContent: ['Lewis', 'Hillier', 'Van Meerbergen', 'Lehman', 'Cuddy', 'Stevenson', 'Pribil', 'Rahman'],
    requiredContent: ['Lewis', 'Rahman'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Revisiting the Urban Growth Boundary Review',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['urban-growth-boundary', 'planning'],
  },
  {
    id: 'opposition-vote-005',
    question: 'Who voted against weekly summer garbage collection?',
    category: 'opposition-votes',
    description: 'Should identify councillors who voted against the summer garbage collection amendment',
    verifiedAnswer: 'The following voted NAY on the motion to evaluate weekly garbage collection during July and August (11 votes): Mayor J. Morgan, A. Hopkins, S. Lewis, S. Hillier, E. Peloza, S. Lehman, H. McAlister, P. Cuddy, S. Trosow, S. Franke, and D. Ferreira. The motion failed 4 to 11.',
    expectedContent: ['Morgan', 'Hopkins', 'Lewis', 'Hillier', 'Peloza', 'Lehman', 'McAlister', 'Cuddy', 'Trosow', 'Franke', 'Ferreira'],
    requiredContent: ['Morgan', 'Trosow'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Amendment for weekly garbage collection during July and August',
    voteResult: 'Motion Failed (4 to 11)',
    tags: ['garbage', 'green-bin', 'waste-management'],
  },

  // ---------------------------------------------------------------------------
  // CLOSE VOTES - Contentious decisions that passed or failed narrowly
  // ---------------------------------------------------------------------------
  {
    id: 'close-vote-001',
    question: 'What happened with the vote on the Cooling By-law in October 2025?',
    category: 'close-votes',
    description: 'Should explain the close vote that defeated the Cooling By-law',
    verifiedAnswer: 'The Adequate and Suitable Cooling By-law was defeated 7 to 8 at the October 14, 2025 Council meeting. Those in favor: A. Hopkins, E. Peloza, H. McAlister, S. Trosow, S. Franke, D. Ferreira, C. Rahman. Those against: Mayor J. Morgan, S. Lewis, S. Hillier, P. Van Meerbergen, S. Lehman, P. Cuddy, S. Stevenson, J. Pribil.',
    expectedContent: ['7 to 8', 'failed', 'defeated', 'Cooling'],
    requiredContent: ['Cooling'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Adequate and Suitable Cooling By-law',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['cooling-bylaw', 'close-vote'],
  },
  {
    id: 'close-vote-002',
    question: 'Did the Urban Growth Boundary Review motion pass?',
    category: 'close-votes',
    description: 'Should explain that the UGB review motion failed 7-8',
    verifiedAnswer: 'No, the motion to revisit the Urban Growth Boundary Review using updated population projections failed 7 to 8 at the October 14, 2025 Council meeting. Councillor S. Franke sponsored the motion.',
    expectedContent: ['7 to 8', 'failed', 'defeated', 'Urban Growth Boundary', 'Franke'],
    requiredContent: ['failed', 'Urban Growth'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Revisiting the Urban Growth Boundary Review',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['urban-growth-boundary', 'close-vote'],
  },
  {
    id: 'close-vote-003',
    question: 'How did the PA Day motion for Election Day 2026 vote go?',
    category: 'close-votes',
    description: 'Should explain the close 8-7 vote on the PA Day motion',
    verifiedAnswer: 'The motion to request school boards schedule a PA Day on Voting Day October 26, 2026 passed 8 to 7 at the April 22, 2025 Council meeting. In favor: A. Hopkins, E. Peloza, S. Lehman, H. McAlister, J. Pribil, S. Trosow, S. Franke, D. Ferreira. Against: Mayor J. Morgan, S. Lewis, S. Hillier, P. Van Meerbergen, P. Cuddy, S. Stevenson, C. Rahman.',
    expectedContent: ['8 to 7', 'passed', 'PA Day', 'Election'],
    requiredContent: ['passed'],
    sourceMeeting: '2025-04-22 7th Council Meeting',
    motionDescription: 'Request PA Day on Voting Day October 26, 2026',
    voteResult: 'Motion Passed (8 to 7)',
    tags: ['election', 'close-vote'],
  },
  {
    id: 'close-vote-004',
    question: 'What was the vote on the diaper waste in Green Bin motion?',
    category: 'close-votes',
    description: 'Should explain the failed diaper waste motion',
    verifiedAnswer: 'The motion to report on the feasibility of including diaper and menstrual product waste in the Green Bin Program failed 3 to 12 at the October 14, 2025 Council meeting. Only P. Van Meerbergen, S. Lehman, and S. Stevenson voted in favor.',
    expectedContent: ['3 to 12', 'failed', 'diaper', 'Green Bin'],
    requiredContent: ['failed', 'diaper'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Diaper and menstrual product waste in Green Bin Program',
    voteResult: 'Motion Failed (3 to 12)',
    tags: ['green-bin', 'waste-management'],
  },

  // ---------------------------------------------------------------------------
  // VOTING RECORD QUESTIONS - Pattern-based questions
  // ---------------------------------------------------------------------------
  {
    id: 'voting-record-001',
    question: "What is Councillor Stevenson's voting record on homelessness initiatives?",
    category: 'voting-record',
    description: 'Should show that Stevenson often votes against homelessness spending',
    verifiedAnswer: 'Councillor S. Stevenson has voted against several homelessness-related initiatives including the Temporary Warming Centre Framework (14-1) and the Health and Homelessness Research Report. Stevenson often requests additional metrics and cost analysis for homelessness programs.',
    expectedContent: ['Stevenson', 'against', 'warming centre', 'homelessness'],
    requiredContent: ['Stevenson'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Various homelessness-related motions',
    voteResult: 'Various',
    tags: ['homelessness', 'voting-pattern'],
  },
  {
    id: 'voting-record-002',
    question: 'Does Councillor Van Meerbergen support bike infrastructure?',
    category: 'voting-record',
    description: 'Should show Van Meerbergen votes against bike infrastructure',
    verifiedAnswer: 'Councillor P. Van Meerbergen voted against the Bike Parking Implementation Plan 2025-2029. He was one of only two councillors (along with S. Stevenson) to oppose the plan, which passed 13 to 2.',
    expectedContent: ['Van Meerbergen', 'against', 'bike', 'opposed'],
    requiredContent: ['Van Meerbergen'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Bike Parking Implementation Plan 2025-2029',
    voteResult: 'Motion Passed (13 to 2)',
    tags: ['bike-parking', 'transportation', 'voting-pattern'],
  },
  {
    id: 'voting-record-003',
    question: 'How does Councillor Trosow typically vote on tenant protection measures?',
    category: 'voting-record',
    description: 'Should show Trosow supports tenant protection measures',
    verifiedAnswer: 'Councillor S. Trosow voted in favor of the Adequate and Suitable Cooling By-law, which would have required landlords to provide adequate cooling in rental units. The by-law failed 7 to 8.',
    expectedContent: ['Trosow', 'in favor', 'support', 'Cooling'],
    requiredContent: ['Trosow'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Adequate and Suitable Cooling By-law',
    voteResult: 'Motion Failed (7 to 8)',
    tags: ['cooling-bylaw', 'tenant-protection', 'voting-pattern'],
  },
  {
    id: 'voting-record-004',
    question: 'How did the Deputy Mayor vote on the 2025 Mid-Year Operating Budget?',
    category: 'voting-record',
    description: 'Should show Deputy Mayor Lewis voted in favor of the budget report',
    verifiedAnswer: 'Deputy Mayor S. Lewis voted YEA (in favor) on the 2025 Mid-Year Operating Budget Monitoring Report. The motion passed 14 to 1, with only Councillor S. Stevenson voting against.',
    expectedContent: ['Lewis', 'in favor', 'yes', 'yea', 'budget'],
    requiredContent: ['Lewis'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: '2025 Mid-Year Operating Budget Monitoring Report',
    voteResult: 'Motion Passed (14 to 1)',
    tags: ['budget', 'finance'],
  },

  // ---------------------------------------------------------------------------
  // PECUNIARY INTEREST / RECUSAL QUESTIONS
  // ---------------------------------------------------------------------------
  {
    id: 'recusal-001',
    question: 'Did any councillor recuse themselves from the Child Care Agreement vote?',
    category: 'individual-vote',
    description: 'Should identify that Van Meerbergen recused due to conflict of interest',
    verifiedAnswer: 'Yes, Councillor P. Van Meerbergen recused himself from the vote on the Child Care Services Cost Apportionment Agreement because his wife owns and operates a day care. The motion passed 14 to 0 (excluding Van Meerbergen).',
    expectedContent: ['Van Meerbergen', 'recuse', 'conflict', 'day care', 'wife'],
    requiredContent: ['Van Meerbergen'],
    sourceMeeting: '2025-10-14 16th Council Meeting',
    motionDescription: 'Child Care Services Cost Apportionment Agreement',
    voteResult: 'Motion Passed (14 to 0)',
    tags: ['conflict-of-interest', 'child-care'],
  },
  {
    id: 'recusal-002',
    question: 'Did Councillor Rahman have any conflicts of interest in November 2025?',
    category: 'individual-vote',
    description: 'Should identify Rahman disclosed conflict on Wellington Road property acquisition',
    verifiedAnswer: 'Yes, Councillor C. Rahman disclosed a pecuniary interest in the property acquisition at 580 Wellington Road for the Wellington Gateway Project at the November 4, 2025 Council meeting because her spouse has an employment relationship with St. Joseph\'s Health Care London.',
    expectedContent: ['Rahman', 'pecuniary interest', 'conflict', 'Wellington', 'spouse', "St. Joseph's"],
    requiredContent: ['Rahman'],
    sourceMeeting: '2025-11-04 17th Council Meeting',
    motionDescription: 'Property Acquisition 580 Wellington Road',
    voteResult: 'N/A - Recused',
    tags: ['conflict-of-interest', 'property-acquisition'],
  },
];

// =============================================================================
// Test Configuration
// =============================================================================

const CHATBOT_URL = process.env.CHATBOT_URL || 'http://localhost:5000/api/chat';
const TEST_TIMEOUT = 30000; // 30 seconds per test

// =============================================================================
// Helper Functions
// =============================================================================

async function queryChat(question: string): Promise<string> {
  const response = await fetch(CHATBOT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: question }),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.response || data.message || '';
}

function checkExpectedContent(response: string, expectedContent: string[]): boolean {
  const lowerResponse = response.toLowerCase();
  return expectedContent.some((content) => lowerResponse.includes(content.toLowerCase()));
}

function checkRequiredContent(response: string, requiredContent: string[]): string[] {
  const lowerResponse = response.toLowerCase();
  return requiredContent.filter((content) => !lowerResponse.includes(content.toLowerCase()));
}

function checkUnexpectedContent(response: string, unexpectedContent: string[]): string[] {
  const lowerResponse = response.toLowerCase();
  return unexpectedContent.filter((content) => lowerResponse.includes(content.toLowerCase()));
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Councillor Voting Pattern Tests', async () => {
  // Health check before running tests
  before(async () => {
    try {
      const response = await fetch(CHATBOT_URL.replace('/api/chat', '/health'));
      if (!response.ok) {
        console.warn('Warning: Chatbot server may not be running. Tests may fail.');
      }
    } catch (error) {
      console.warn('Warning: Could not connect to chatbot server. Tests may fail.');
    }
  });

  // Group tests by category
  const categories = ['individual-vote', 'opposition-votes', 'close-votes', 'voting-record'] as const;

  for (const category of categories) {
    const categoryTests = testCases.filter((tc) => tc.category === category);

    describe(`${category.charAt(0).toUpperCase() + category.slice(1).replace('-', ' ')} Tests`, () => {
      for (const testCase of categoryTests) {
        test(
          `[${testCase.id}] ${testCase.description}`,
          { timeout: TEST_TIMEOUT },
          async () => {
            const response = await queryChat(testCase.question);

            // Log the response for debugging
            console.log(`\n--- Test: ${testCase.id} ---`);
            console.log(`Question: ${testCase.question}`);
            console.log(`Response: ${response.substring(0, 500)}...`);
            console.log(`Expected (verified): ${testCase.verifiedAnswer}`);

            // Check response is not empty
            assert.ok(response.length > 0, 'Response should not be empty');

            // Check expected content (at least one should match)
            if (testCase.expectedContent) {
              const hasExpected = checkExpectedContent(response, testCase.expectedContent);
              assert.ok(
                hasExpected,
                `Response should contain at least one of: ${testCase.expectedContent.join(', ')}`
              );
            }

            // Check required content (all must match)
            if (testCase.requiredContent) {
              const missing = checkRequiredContent(response, testCase.requiredContent);
              assert.ok(
                missing.length === 0,
                `Response is missing required content: ${missing.join(', ')}`
              );
            }

            // Check unexpected content (none should match)
            if (testCase.unexpectedContent) {
              const found = checkUnexpectedContent(response, testCase.unexpectedContent);
              assert.ok(
                found.length === 0,
                `Response should NOT contain: ${found.join(', ')}`
              );
            }
          }
        );
      }
    });
  }
});

// =============================================================================
// Export test cases for external use
// =============================================================================

export { testCases, CouncillorVoteTestCase };
