/**
 * Chatbot Accuracy Test Suite
 *
 * This test suite evaluates the accuracy of the RAG chatbot's responses
 * against London, Ontario city council meeting data.
 *
 * Test Categories:
 * - factual: Simple factual questions with expected specific answers
 * - topical: Questions about specific topics that should return relevant content
 * - negative: Questions that should return "I don't know" or similar
 * - councillor: Questions about specific councillor voting records
 * - temporal: Questions with time-based constraints
 *
 * Usage:
 *   npm run test -- server/tests/chatbot-accuracy.test.ts
 *
 * Note: These tests require the chatbot server to be running and
 * the vector store to be populated with embeddings.
 */

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';

// =============================================================================
// Test Case Interface
// =============================================================================

interface TestCase {
  /** Unique identifier for the test case */
  id: string;

  /** The question to ask the chatbot */
  question: string;

  /** Category of the test case */
  category: 'factual' | 'topical' | 'negative' | 'councillor' | 'temporal';

  /** Description of what this test is checking */
  description: string;

  /** Expected content that SHOULD appear in the response (any of these) */
  expectedContent?: string[];

  /** Content that MUST appear in the response (all of these) */
  requiredContent?: string[];

  /** Content that should NOT appear in the response */
  unexpectedContent?: string[];

  /** For negative cases: patterns indicating the chatbot doesn't have info */
  expectsNoInfo?: boolean;

  /** Minimum response length (characters) */
  minLength?: number;

  /** Maximum response length (characters) - to check for verbosity */
  maxLength?: number;

  /** Whether the response should include source citations */
  expectsCitations?: boolean;

  /** Specific meeting dates that should be referenced */
  expectedDates?: string[];

  /** Tags for filtering tests */
  tags?: string[];
}

// =============================================================================
// Test Cases
// =============================================================================

const testCases: TestCase[] = [
  // ---------------------------------------------------------------------------
  // FACTUAL QUESTIONS - Simple, direct answers expected
  // ---------------------------------------------------------------------------
  {
    id: 'factual-001',
    question: 'When was the last council meeting?',
    category: 'factual',
    description: 'Should return the most recent council meeting date',
    expectedContent: ['December 2025', '2025-12', 'December 16'],
    expectsCitations: true,
    tags: ['temporal', 'recent'],
  },
  {
    id: 'factual-002',
    question: 'Who is the mayor of London, Ontario?',
    category: 'factual',
    description: 'Should identify the current mayor',
    expectedContent: ['Josh Morgan', 'Morgan', 'Mayor Morgan'],
    tags: ['governance'],
  },
  {
    id: 'factual-003',
    question: 'What committees does London city council have?',
    category: 'factual',
    description: 'Should list the main standing committees',
    expectedContent: [
      'Planning and Environment',
      'Community and Protective Services',
      'Infrastructure and Corporate Services',
      'Strategic Priorities',
    ],
    tags: ['governance', 'committees'],
  },
  {
    id: 'factual-004',
    question: 'What is the overnight parking ban in London?',
    category: 'factual',
    description: 'Should explain the seasonal parking restrictions',
    expectedContent: ['November', 'April', 'overnight', 'snow'],
    tags: ['bylaws', 'parking'],
  },
  {
    id: 'factual-005',
    question: 'How many councillors are there in London?',
    category: 'factual',
    description: 'Should identify the number of ward councillors',
    expectedContent: ['14', 'fourteen', 'ward'],
    tags: ['governance'],
  },

  // ---------------------------------------------------------------------------
  // TOPICAL QUESTIONS - Questions about specific topics
  // ---------------------------------------------------------------------------
  {
    id: 'topical-001',
    question: 'What has council discussed about housing?',
    category: 'topical',
    description: 'Should return housing-related discussions and decisions',
    expectedContent: ['housing', 'affordable', 'development'],
    minLength: 200,
    expectsCitations: true,
    tags: ['housing', 'policy'],
  },
  {
    id: 'topical-002',
    question: 'What is being done about homelessness in London?',
    category: 'topical',
    description: 'Should discuss homelessness initiatives and programs',
    expectedContent: ['homeless', 'shelter', 'hub', 'supportive'],
    minLength: 200,
    expectsCitations: true,
    tags: ['homelessness', 'social-services'],
  },
  {
    id: 'topical-003',
    question: 'What is the status of rapid transit or BRT in London?',
    category: 'topical',
    description: 'Should discuss Bus Rapid Transit plans',
    expectedContent: ['transit', 'BRT', 'bus', 'rapid'],
    minLength: 150,
    expectsCitations: true,
    tags: ['transit', 'infrastructure'],
  },
  {
    id: 'topical-004',
    question: "What has council done about climate change or the city's climate plan?",
    category: 'topical',
    description: 'Should discuss Climate Emergency Action Plan (CEAP)',
    expectedContent: ['climate', 'CEAP', 'emissions', 'environment'],
    minLength: 150,
    expectsCitations: true,
    tags: ['climate', 'environment'],
  },
  {
    id: 'topical-005',
    question: 'What has council discussed about cycling infrastructure or bike lanes?',
    category: 'topical',
    description: 'Should discuss cycling network and bike lane projects',
    expectedContent: ['cycling', 'bike', 'lane', 'infrastructure'],
    minLength: 150,
    expectsCitations: true,
    tags: ['cycling', 'transportation'],
  },
  {
    id: 'topical-006',
    question: 'What decisions has council made about the police budget?',
    category: 'topical',
    description: 'Should discuss London Police Service funding',
    expectedContent: ['police', 'LPS', 'budget', 'funding'],
    minLength: 150,
    expectsCitations: true,
    tags: ['police', 'budget'],
  },
  {
    id: 'topical-007',
    question: 'What has council discussed about downtown safety?',
    category: 'topical',
    description: 'Should discuss core area safety initiatives',
    expectedContent: ['downtown', 'safety', 'core'],
    minLength: 100,
    expectsCitations: true,
    tags: ['safety', 'downtown'],
  },
  {
    id: 'topical-008',
    question: 'What major development projects has council approved recently?',
    category: 'topical',
    description: 'Should list recent planning approvals',
    expectedContent: ['development', 'approved', 'zoning'],
    minLength: 150,
    expectsCitations: true,
    tags: ['development', 'planning'],
  },

  // ---------------------------------------------------------------------------
  // COUNCILLOR VOTING QUESTIONS
  // ---------------------------------------------------------------------------
  {
    id: 'councillor-001',
    question: 'How did Shawn Lewis vote on bike lanes?',
    category: 'councillor',
    description: 'Should return Deputy Mayor Lewis voting record on cycling',
    expectedContent: ['Lewis', 'cycling', 'vote'],
    minLength: 100,
    expectsCitations: true,
    tags: ['councillor', 'voting', 'cycling'],
  },
  {
    id: 'councillor-002',
    question: 'How did Susan Stevenson vote on housing projects?',
    category: 'councillor',
    description: 'Should return Councillor Stevenson voting record on housing',
    expectedContent: ['Stevenson', 'housing'],
    minLength: 100,
    expectsCitations: true,
    tags: ['councillor', 'voting', 'housing'],
  },
  {
    id: 'councillor-003',
    question: "What is Councillor Trosow's voting record on climate issues?",
    category: 'councillor',
    description: 'Should discuss Councillor Trosow positions on environment',
    expectedContent: ['Trosow', 'climate'],
    minLength: 100,
    expectsCitations: true,
    tags: ['councillor', 'voting', 'climate'],
  },
  {
    id: 'councillor-004',
    question: 'Who voted against the budget increase?',
    category: 'councillor',
    description: 'Should identify councillors who voted against budget',
    expectedContent: ['vote', 'against', 'budget'],
    minLength: 100,
    expectsCitations: true,
    tags: ['councillor', 'voting', 'budget'],
  },

  // ---------------------------------------------------------------------------
  // TEMPORAL QUESTIONS - Time-specific queries
  // ---------------------------------------------------------------------------
  {
    id: 'temporal-001',
    question: 'What happened at the November 2025 council meeting?',
    category: 'temporal',
    description: 'Should return November 2025 meeting summary',
    expectedContent: ['November', '2025'],
    expectedDates: ['2025-11'],
    minLength: 150,
    expectsCitations: true,
    tags: ['temporal', 'specific-date'],
  },
  {
    id: 'temporal-002',
    question: 'What meetings took place in December 2025?',
    category: 'temporal',
    description: 'Should list December 2025 meetings',
    expectedContent: ['December', '2025'],
    expectedDates: ['2025-12'],
    minLength: 100,
    expectsCitations: true,
    tags: ['temporal', 'specific-date'],
  },
  {
    id: 'temporal-003',
    question: 'What has council done this year about property taxes?',
    category: 'temporal',
    description: 'Should discuss 2025 property tax decisions',
    expectedContent: ['tax', '2025'],
    minLength: 100,
    expectsCitations: true,
    tags: ['temporal', 'budget', 'taxes'],
  },
  {
    id: 'temporal-004',
    question: "What's the most recent planning committee decision?",
    category: 'temporal',
    description: 'Should return recent Planning Committee items',
    expectedContent: ['Planning', 'Committee'],
    minLength: 100,
    expectsCitations: true,
    tags: ['temporal', 'committees', 'planning'],
  },

  // ---------------------------------------------------------------------------
  // NEGATIVE QUESTIONS - Should return "I don't know" or similar
  // ---------------------------------------------------------------------------
  {
    id: 'negative-001',
    question: "What are the Toronto city council's latest decisions?",
    category: 'negative',
    description: 'Should indicate this is about London, not Toronto',
    expectsNoInfo: true,
    unexpectedContent: ['Toronto council decided', 'Toronto approved'],
    tags: ['negative', 'out-of-scope'],
  },
  {
    id: 'negative-002',
    question: 'What will council discuss at the next meeting?',
    category: 'negative',
    description: 'Should indicate it cannot predict future meetings',
    expectsNoInfo: true,
    expectedContent: ['future', 'upcoming', 'schedule', "don't have", 'cannot'],
    tags: ['negative', 'future'],
  },
  {
    id: 'negative-003',
    question: 'When is the next council election?',
    category: 'negative',
    description: 'Should indicate this is not in meeting records',
    expectsNoInfo: true,
    tags: ['negative', 'out-of-scope'],
  },
  {
    id: 'negative-004',
    question: 'What is the phone number for city hall?',
    category: 'negative',
    description: 'Should indicate this is operational info not in meetings',
    expectsNoInfo: true,
    expectedContent: ['london.ca', 'city hall', 'contact'],
    tags: ['negative', 'operational'],
  },
  {
    id: 'negative-005',
    question: 'What did council discuss about space exploration?',
    category: 'negative',
    description: 'Should indicate no relevant discussions found',
    expectsNoInfo: true,
    unexpectedContent: ['council approved space', 'NASA'],
    tags: ['negative', 'irrelevant'],
  },
  {
    id: 'negative-006',
    question: 'Tell me about the 1950 council meetings',
    category: 'negative',
    description: 'Should indicate data starts from 2011',
    expectsNoInfo: true,
    expectedContent: ['2011', 'records', "don't have"],
    tags: ['negative', 'historical-limit'],
  },

  // ---------------------------------------------------------------------------
  // PROCESS QUESTIONS - How to participate
  // ---------------------------------------------------------------------------
  {
    id: 'process-001',
    question: 'How do I speak at a council meeting?',
    category: 'topical',
    description: 'Should explain delegation/deputation process',
    expectedContent: ['delegation', 'speak', 'register', 'public'],
    minLength: 100,
    tags: ['process', 'participation'],
  },
  {
    id: 'process-002',
    question: 'How can I object to a development near my house?',
    category: 'topical',
    description: 'Should explain planning objection process',
    expectedContent: ['planning', 'public', 'participation', 'notice'],
    minLength: 100,
    tags: ['process', 'planning', 'participation'],
  },

  // ---------------------------------------------------------------------------
  // COMPLEX/ANALYTICAL QUESTIONS
  // ---------------------------------------------------------------------------
  {
    id: 'complex-001',
    question:
      'Why did council approve more police funding but there are concerns about community services?',
    category: 'topical',
    description: 'Should explain budget trade-offs and perspectives',
    expectedContent: ['police', 'budget', 'funding'],
    minLength: 200,
    expectsCitations: true,
    tags: ['complex', 'budget', 'analysis'],
  },
  {
    id: 'complex-002',
    question: 'What is the relationship between housing development and transit planning in London?',
    category: 'topical',
    description: 'Should discuss how these policies intersect',
    expectedContent: ['housing', 'transit', 'development'],
    minLength: 150,
    expectsCitations: true,
    tags: ['complex', 'policy', 'analysis'],
  },
  {
    id: 'complex-003',
    question: 'How has council balanced environmental concerns with development approvals?',
    category: 'topical',
    description: 'Should discuss planning and environment considerations',
    expectedContent: ['environment', 'development', 'planning'],
    minLength: 150,
    expectsCitations: true,
    tags: ['complex', 'environment', 'planning'],
  },

  // ---------------------------------------------------------------------------
  // EDGE CASES
  // ---------------------------------------------------------------------------
  {
    id: 'edge-001',
    question: 'scooters e-scooters electric kick scooters',
    category: 'topical',
    description: 'Should handle keyword-only queries about e-scooters',
    expectedContent: ['scooter', 'micro-mobility', 'pilot'],
    tags: ['edge-case', 'keyword-search'],
  },
  {
    id: 'edge-002',
    question: 'CEAP',
    category: 'topical',
    description: 'Should recognize the CEAP acronym (Climate Emergency Action Plan)',
    expectedContent: ['Climate', 'Emergency', 'Action', 'Plan'],
    tags: ['edge-case', 'acronym'],
  },
  {
    id: 'edge-003',
    question: 'LPS budget 2025',
    category: 'topical',
    description: 'Should recognize LPS acronym (London Police Service)',
    expectedContent: ['Police', 'London', 'budget'],
    tags: ['edge-case', 'acronym'],
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if response contains any of the expected content strings (case-insensitive)
 */
function containsAny(response: string, expectedContent: string[]): boolean {
  const lowerResponse = response.toLowerCase();
  return expectedContent.some((content) => lowerResponse.includes(content.toLowerCase()));
}

/**
 * Check if response contains all of the required content strings (case-insensitive)
 */
function containsAll(response: string, requiredContent: string[]): boolean {
  const lowerResponse = response.toLowerCase();
  return requiredContent.every((content) => lowerResponse.includes(content.toLowerCase()));
}

/**
 * Check if response indicates the chatbot doesn't have the information
 */
function indicatesNoInfo(response: string): boolean {
  const noInfoPatterns = [
    "don't have",
    'do not have',
    "don't know",
    'do not know',
    'cannot find',
    "can't find",
    'no information',
    'no records',
    'not in my',
    'not available',
    'outside my',
    'beyond my',
    'unable to',
    'no relevant',
    'not found',
    "isn't something",
    'not something i',
  ];
  const lowerResponse = response.toLowerCase();
  return noInfoPatterns.some((pattern) => lowerResponse.includes(pattern));
}

/**
 * Check if response contains source citations (links to meetings)
 */
function containsCitations(response: string): boolean {
  // Look for markdown links to meeting pages
  const linkPattern = /\[.*?\]\(\/\d{4}-\d{2}\/.*?\)/;
  return linkPattern.test(response);
}

/**
 * Check if response references specific dates
 */
function containsDates(response: string, expectedDates: string[]): boolean {
  return expectedDates.some((date) => response.includes(date));
}

// =============================================================================
// Test Runner Types
// =============================================================================

interface TestResult {
  testCase: TestCase;
  passed: boolean;
  response?: string;
  errors: string[];
  responseTimeMs?: number;
}

/**
 * Evaluate a single test case against a response
 */
function evaluateTestCase(testCase: TestCase, response: string): TestResult {
  const errors: string[] = [];

  // Check expected content (any match)
  if (testCase.expectedContent && testCase.expectedContent.length > 0) {
    if (!containsAny(response, testCase.expectedContent)) {
      errors.push(
        `Expected response to contain one of: ${testCase.expectedContent.join(', ')}`
      );
    }
  }

  // Check required content (all must match)
  if (testCase.requiredContent && testCase.requiredContent.length > 0) {
    if (!containsAll(response, testCase.requiredContent)) {
      const missing = testCase.requiredContent.filter(
        (c) => !response.toLowerCase().includes(c.toLowerCase())
      );
      errors.push(`Missing required content: ${missing.join(', ')}`);
    }
  }

  // Check unexpected content (none should match)
  if (testCase.unexpectedContent && testCase.unexpectedContent.length > 0) {
    const found = testCase.unexpectedContent.filter((c) =>
      response.toLowerCase().includes(c.toLowerCase())
    );
    if (found.length > 0) {
      errors.push(`Response should NOT contain: ${found.join(', ')}`);
    }
  }

  // Check for "no info" indication in negative test cases
  if (testCase.expectsNoInfo) {
    if (!indicatesNoInfo(response)) {
      errors.push(
        'Expected response to indicate lack of information, but it did not'
      );
    }
  }

  // Check minimum length
  if (testCase.minLength && response.length < testCase.minLength) {
    errors.push(
      `Response too short: ${response.length} chars (minimum: ${testCase.minLength})`
    );
  }

  // Check maximum length
  if (testCase.maxLength && response.length > testCase.maxLength) {
    errors.push(
      `Response too long: ${response.length} chars (maximum: ${testCase.maxLength})`
    );
  }

  // Check for citations
  if (testCase.expectsCitations && !containsCitations(response)) {
    errors.push('Expected response to contain source citations (meeting links)');
  }

  // Check for expected dates
  if (testCase.expectedDates && testCase.expectedDates.length > 0) {
    if (!containsDates(response, testCase.expectedDates)) {
      errors.push(
        `Expected response to reference dates: ${testCase.expectedDates.join(', ')}`
      );
    }
  }

  return {
    testCase,
    passed: errors.length === 0,
    response,
    errors,
  };
}

// =============================================================================
// Mock Response Generator (for testing without server)
// =============================================================================

/**
 * Generate a mock response for testing purposes
 * In production, this would call the actual chatbot API
 */
function generateMockResponse(question: string): string {
  // This is a placeholder that returns a generic response
  // In actual testing, replace this with HTTP calls to the chatbot API
  return `This is a mock response for: "${question}".

  The council discussed various topics including housing, transit, and budget matters
  at the [November 2025 Council meeting](/2025-11/2025-11-25-Council).

  For more information, please check london.ca.`;
}

// =============================================================================
// Test Execution
// =============================================================================

/**
 * Get test cases filtered by category or tags
 */
function getTestCasesByCategory(category: TestCase['category']): TestCase[] {
  return testCases.filter((tc) => tc.category === category);
}

function getTestCasesByTag(tag: string): TestCase[] {
  return testCases.filter((tc) => tc.tags?.includes(tag));
}

// Export for external use
export {
  testCases,
  TestCase,
  TestResult,
  evaluateTestCase,
  getTestCasesByCategory,
  getTestCasesByTag,
  containsAny,
  containsAll,
  indicatesNoInfo,
  containsCitations,
  containsDates,
};

// =============================================================================
// Node.js Test Runner Tests
// =============================================================================

describe('Chatbot Accuracy Test Suite', () => {
  describe('Test Case Validation', () => {
    test('all test cases have unique IDs', () => {
      const ids = testCases.map((tc) => tc.id);
      const uniqueIds = new Set(ids);
      assert.strictEqual(ids.length, uniqueIds.size, 'Duplicate test case IDs found');
    });

    test('all test cases have valid categories', () => {
      const validCategories = ['factual', 'topical', 'negative', 'councillor', 'temporal'];
      for (const tc of testCases) {
        assert(
          validCategories.includes(tc.category),
          `Invalid category "${tc.category}" in test case ${tc.id}`
        );
      }
    });

    test('all test cases have questions', () => {
      for (const tc of testCases) {
        assert(tc.question.length > 0, `Empty question in test case ${tc.id}`);
      }
    });

    test('negative test cases have expectsNoInfo or unexpectedContent', () => {
      const negativeCases = getTestCasesByCategory('negative');
      for (const tc of negativeCases) {
        assert(
          tc.expectsNoInfo || (tc.unexpectedContent && tc.unexpectedContent.length > 0),
          `Negative test case ${tc.id} should have expectsNoInfo or unexpectedContent`
        );
      }
    });
  });

  describe('Helper Function Tests', () => {
    test('containsAny returns true when content found', () => {
      const response = 'The council discussed housing and transit.';
      assert(containsAny(response, ['housing', 'budget']));
      assert(containsAny(response, ['HOUSING', 'BUDGET'])); // case-insensitive
    });

    test('containsAny returns false when no content found', () => {
      const response = 'The council discussed housing and transit.';
      assert(!containsAny(response, ['police', 'budget']));
    });

    test('containsAll returns true when all content found', () => {
      const response = 'The council discussed housing and transit.';
      assert(containsAll(response, ['housing', 'transit']));
    });

    test('containsAll returns false when not all content found', () => {
      const response = 'The council discussed housing and transit.';
      assert(!containsAll(response, ['housing', 'budget']));
    });

    test('indicatesNoInfo detects lack of information', () => {
      assert(indicatesNoInfo("I don't have information about that."));
      assert(indicatesNoInfo('That information is not available in my records.'));
      assert(indicatesNoInfo('I cannot find any relevant data.'));
      assert(!indicatesNoInfo('The council approved the budget.'));
    });

    test('containsCitations detects meeting links', () => {
      assert(
        containsCitations('See the [November meeting](/2025-11/2025-11-25-Council).')
      );
      assert(!containsCitations('See the November meeting for more details.'));
    });
  });

  describe('Test Case Coverage Statistics', () => {
    test('reports category distribution', () => {
      const categories = ['factual', 'topical', 'negative', 'councillor', 'temporal'] as const;
      const distribution: Record<string, number> = {};

      for (const category of categories) {
        distribution[category] = getTestCasesByCategory(category).length;
      }

      console.log('\nTest Case Distribution by Category:');
      for (const [category, count] of Object.entries(distribution)) {
        console.log(`  ${category}: ${count}`);
      }
      console.log(`  Total: ${testCases.length}\n`);

      // Ensure we have at least some tests in each category
      assert(distribution.factual >= 3, 'Should have at least 3 factual tests');
      assert(distribution.topical >= 5, 'Should have at least 5 topical tests');
      assert(distribution.negative >= 3, 'Should have at least 3 negative tests');
    });

    test('reports tag distribution', () => {
      const tagCounts: Record<string, number> = {};

      for (const tc of testCases) {
        if (tc.tags) {
          for (const tag of tc.tags) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        }
      }

      console.log('\nTest Case Distribution by Tag (top 10):');
      const sortedTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      for (const [tag, count] of sortedTags) {
        console.log(`  ${tag}: ${count}`);
      }
      console.log('');
    });
  });

  describe('Evaluation Logic Tests', () => {
    test('evaluateTestCase passes when all criteria met', () => {
      const testCase: TestCase = {
        id: 'test-001',
        question: 'Test question',
        category: 'topical',
        description: 'Test',
        expectedContent: ['housing', 'transit'],
        minLength: 10,
        expectsCitations: true,
      };

      const response =
        'The council discussed housing and transit. [See meeting](/2025-11/2025-11-25-Council).';

      const result = evaluateTestCase(testCase, response);
      assert(result.passed, `Test should pass but failed with: ${result.errors.join(', ')}`);
    });

    test('evaluateTestCase fails when expected content missing', () => {
      const testCase: TestCase = {
        id: 'test-002',
        question: 'Test question',
        category: 'topical',
        description: 'Test',
        expectedContent: ['budget', 'taxes'],
      };

      const response = 'The council discussed housing and transit.';

      const result = evaluateTestCase(testCase, response);
      assert(!result.passed);
      assert(result.errors.some((e) => e.includes('Expected response to contain')));
    });

    test('evaluateTestCase fails when response too short', () => {
      const testCase: TestCase = {
        id: 'test-003',
        question: 'Test question',
        category: 'topical',
        description: 'Test',
        minLength: 500,
      };

      const response = 'Short response.';

      const result = evaluateTestCase(testCase, response);
      assert(!result.passed);
      assert(result.errors.some((e) => e.includes('too short')));
    });

    test('evaluateTestCase fails when citations missing', () => {
      const testCase: TestCase = {
        id: 'test-004',
        question: 'Test question',
        category: 'topical',
        description: 'Test',
        expectsCitations: true,
      };

      const response = 'The council discussed housing without any links.';

      const result = evaluateTestCase(testCase, response);
      assert(!result.passed);
      assert(result.errors.some((e) => e.includes('citations')));
    });

    test('evaluateTestCase passes negative case correctly', () => {
      const testCase: TestCase = {
        id: 'test-005',
        question: 'What about Toronto?',
        category: 'negative',
        description: 'Test',
        expectsNoInfo: true,
        unexpectedContent: ['Toronto council decided'],
      };

      const response =
        "I don't have information about Toronto. I only have records for London, Ontario city council.";

      const result = evaluateTestCase(testCase, response);
      assert(result.passed, `Test should pass but failed with: ${result.errors.join(', ')}`);
    });
  });
});

// =============================================================================
// Integration Test Placeholder
// =============================================================================

describe('Integration Tests (production API)', () => {
  // These tests would call the actual chatbot API
  // Skip by default since they require a running server

  const CHATBOT_API_URL = process.env.CHATBOT_URL || 'https://open-council-production.up.railway.app/api/chat';

  async function askChatbot(question: string): Promise<string> {
    // This would make an actual HTTP request to the chatbot
    // For now, return a placeholder
    const response = await fetch(CHATBOT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question }),
    });

    if (!response.ok) {
      throw new Error(`Chatbot request failed: ${response.status}`);
    }

    // Handle SSE response
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    let fullResponse = '';
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              fullResponse += data.content;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    return fullResponse;
  }

  test('factual question: last council meeting', async () => {
    const testCase = testCases.find((tc) => tc.id === 'factual-001');
    if (!testCase) throw new Error('Test case not found');

    const response = await askChatbot(testCase.question);
    const result = evaluateTestCase(testCase, response);

    if (!result.passed) {
      console.log(`Failed: ${testCase.id}`);
      console.log(`Question: ${testCase.question}`);
      console.log(`Response: ${response.substring(0, 500)}...`);
      console.log(`Errors: ${result.errors.join('\n')}`);
    }

    assert(result.passed, result.errors.join(', '));
  });
});

// Export test cases for use in other test runners or reporting tools
export default testCases;
