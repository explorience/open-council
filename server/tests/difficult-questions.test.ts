/**
 * Difficult Questions Test Suite
 *
 * 50 challenging questions designed to test:
 * - Factual accuracy from meeting records
 * - Vote counts and outcomes
 * - Councillor voting patterns
 * - Multi-hop reasoning (X voted Y on A and Z on B)
 * - Edge cases and nuanced questions
 *
 * Each question allows flexible phrasing in responses.
 * User will select the 20 best questions for the final test suite.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert';

const CHATBOT_URL = 'https://open-council-production.up.railway.app/api/chat';

interface DifficultTestCase {
  id: string;
  category: string;
  question: string;
  expectedContent: string[];  // ANY of these should appear (flexible matching)
  requiredContent?: string[]; // ALL of these must appear
  unexpectedContent?: string[]; // NONE of these should appear
  verifiedAnswer: string;
  rationale: string;  // Why this question is difficult/interesting
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
// 50 DIFFICULT QUESTIONS
// =============================================================================

const testCases: DifficultTestCase[] = [
  // ---------------------------------------------------------------------------
  // CATEGORY: Close Vote Outcomes (7-8 and 8-7 votes)
  // ---------------------------------------------------------------------------
  {
    id: 'diff-003',
    category: 'close-vote',
    question: 'How many votes did the Urban Growth Boundary Review motion lose by?',
    expectedContent: ['one', '1', 'single vote', '7-8', '7 to 8', 'failed by one'],
    verifiedAnswer: 'Lost by one vote (7-8).',
    rationale: 'Tests margin calculation on failed motion.',
  },
  {
    id: 'diff-005',
    category: 'close-vote',
    question: 'What free parking motion failed 7-8 in November 2025?',
    expectedContent: ['honk', 'free parking', 'two-hour', 'two hour', 'core area', 'downtown', 'budget'],
    verifiedAnswer: 'The free two-hour parking through Honk App failed 7-8.',
    rationale: 'Tests recall of specific failed budget amendment.',
  },

  // ---------------------------------------------------------------------------
  // CATEGORY: Councillor Vote Positions
  // ---------------------------------------------------------------------------
  
  {
    id: 'diff-007',
    category: 'councillor-position',
    question: 'Did Trosow and Hopkins vote the same way on the Cooling By-law?',
    expectedContent: ['yes', 'both', 'same', 'yea', 'favor', 'supported', 'together'],
    requiredContent: ['Trosow', 'Hopkins'],
    verifiedAnswer: 'Yes, both voted YEA (in favor).',
    rationale: 'Tests comparison of two councillor votes on same motion.',
  },
  {
    id: 'diff-008',
    category: 'councillor-position',
    question: 'Who was the sole NAY vote on the Warming Centre Framework?',
    expectedContent: ['Stevenson', 'one', 'sole', 'only', 'lone'],
    verifiedAnswer: 'Councillor Stevenson was the sole NAY (14-1).',
    rationale: 'Tests identification of lone dissenter.',
  },
  

  // ---------------------------------------------------------------------------
  // CATEGORY: Multi-Hop Queries (Councillors with specific vote combinations)
  // ---------------------------------------------------------------------------
  {
    id: 'diff-011',
    category: 'multi-hop',
    question: 'Who voted against both the Cooling By-law and Urban Growth Boundary?',
    expectedContent: ['Morgan', 'Lewis', 'Hillier', 'Cuddy', 'Pribil', 'Lehman', 'Van Meerbergen', 'Stevenson'],
    verifiedAnswer: 'Morgan, Lewis, Hillier, Cuddy, Pribil, Lehman (and others) voted NAY on both.',
    rationale: 'Multi-hop: finds councillors with NAY on both motions.',
  },
  {
    id: 'diff-012',
    category: 'multi-hop',
    question: 'Which councillors voted for the Cooling By-law but against the diaper waste motion?',
    expectedContent: ['Trosow', 'Hopkins', 'McAlister', 'Ferreira', 'Rahman', 'Franke', 'Peloza'],
    verifiedAnswer: 'Most YEA voters on Cooling (Trosow, Hopkins, etc.) also opposed diaper waste.',
    rationale: 'Multi-hop: cross-references two contentious motions.',
  },
  {
    id: 'diff-013',
    category: 'multi-hop',
    question: 'Did anyone vote YEA on both the Warming Centre and the diaper waste motion?',
    expectedContent: ['no', 'none', 'unlikely', 'Franke', 'Hopkins', 'Trosow'],
    verifiedAnswer: 'Very few if any - Warming Centre was near-unanimous (14-1), diaper waste only had 3 YEAs.',
    rationale: 'Tests cross-referencing votes with very different outcomes.',
  },
  {
    id: 'diff-014',
    category: 'multi-hop',
    question: 'Which councillors supported PA Day but opposed the Cooling By-law?',
    expectedContent: ['Lewis', 'Hillier', 'Cuddy', 'Van Meerbergen'],
    verifiedAnswer: 'Several councillors (Lewis, Hillier, etc.) voted YEA on PA Day but NAY on Cooling.',
    rationale: 'Multi-hop with different outcomes (PA Day passed, Cooling failed).',
  },
  {
    id: 'diff-015',
    category: 'multi-hop',
    question: 'Has Morgan ever been in the minority on an 8-7 vote?',
    expectedContent: ['yes', 'PA Day', 'lost', 'minority', 'against'],
    verifiedAnswer: 'Yes, on PA Day motion (passed 8-7 against Mayor).',
    rationale: 'Tests finding Mayor minority position.',
  },

  // ---------------------------------------------------------------------------
  // CATEGORY: Vote Count and Margin Analysis
  // ---------------------------------------------------------------------------
  {
    id: 'diff-016',
    category: 'vote-analysis',
    question: 'How many councillors voted against the diaper waste motion?',
    expectedContent: ['12', 'twelve', 'majority', 'most', '3-12', '3 to 12'],
    verifiedAnswer: '12 councillors voted against (motion failed 3-12).',
    rationale: 'Tests vote count on heavily defeated motion.',
  },
  {
    id: 'diff-017',
    category: 'vote-analysis',
    question: 'What was the vote count on the Bike Parking Implementation Plan?',
    expectedContent: ['13-2', '13 to 2', 'passed', 'approved', 'thirteen', 'two against'],
    verifiedAnswer: 'Passed 13-2.',
    rationale: 'Tests vote count on clear majority motion.',
  },
  {
    id: 'diff-018',
    category: 'vote-analysis',
    question: 'Did the Warming Centre Framework have any opposition?',
    expectedContent: ['one', '1', 'Stevenson', '14-1', '14 to 1', 'minimal', 'sole'],
    verifiedAnswer: 'Yes, one NAY vote (Stevenson). Passed 14-1.',
    rationale: 'Tests identification of minimal opposition.',
  },
  {
    id: 'diff-019',
    category: 'vote-analysis',
    question: 'How many unanimous votes were there at the October 14, 2025 meeting?',
    expectedContent: ['several', 'many', 'multiple', 'most', 'procedural', 'routine'],
    verifiedAnswer: 'Multiple unanimous votes on procedural/routine matters.',
    rationale: 'Tests awareness that most votes are actually unanimous.',
  },
  {
    id: 'diff-020',
    category: 'vote-analysis',
    question: 'What percentage of the Cooling By-law vote was in favor?',
    expectedContent: ['7', 'seven', '46%', '47%', 'less than half', 'minority'],
    verifiedAnswer: '7 out of 15 (approximately 47%) voted in favor.',
    rationale: 'Tests vote percentage calculation.',
  },

  // ---------------------------------------------------------------------------
  // CATEGORY: Meeting and Date Lookups
  // ---------------------------------------------------------------------------
  {
    id: 'diff-021',
    category: 'meeting-lookup',
    question: 'When was the Cooling By-law voted on?',
    expectedContent: ['October 14', 'October 2025', '2025-10-14', '16th Council', 'October'],
    verifiedAnswer: 'October 14, 2025 at the 16th Council Meeting.',
    rationale: 'Tests date recall for specific vote.',
  },
  {
    id: 'diff-024',
    category: 'meeting-lookup',
    question: 'What was the PA Day motion related to?',
    expectedContent: ['election', 'voting day', 'school', 'October 26', '2026', 'professional activity'],
    verifiedAnswer: 'Requesting schools schedule a PA Day on Voting Day (October 26, 2026).',
    rationale: 'Tests content understanding of specific motion.',
  },
  {
    id: 'diff-025',
    category: 'meeting-lookup',
    question: 'What committee discussed the Homelessness Response in October 2025?',
    expectedContent: ['Council', 'Strategic Priorities', 'Policy Committee', 'SPPC'],
    verifiedAnswer: 'Discussed at Council and committee meetings in October 2025.',
    rationale: 'Tests committee identification for topic.',
  },

  // ---------------------------------------------------------------------------
  // CATEGORY: Councillor Patterns and Tendencies
  // ---------------------------------------------------------------------------
  
  {
    id: 'diff-028',
    category: 'pattern-analysis',
    question: 'Who tends to vote against homelessness or social spending initiatives?',
    expectedContent: ['Stevenson', 'Van Meerbergen', 'conservative', 'opposed'],
    verifiedAnswer: 'Councillors like Stevenson and Van Meerbergen often vote against social spending.',
    rationale: 'Tests identification of fiscal conservative pattern.',
  },
  {
    id: 'diff-029',
    category: 'pattern-analysis',
    question: 'Is Councillor Peloza generally supportive of environmental initiatives?',
    expectedContent: ['yes', 'support', 'favor', 'generally', 'environmental', 'green'],
    requiredContent: ['Peloza'],
    verifiedAnswer: 'Generally yes, Peloza tends to support environmental measures.',
    rationale: 'Tests councillor environmental stance.',
  },
  {
    id: 'diff-030',
    category: 'pattern-analysis',
    question: 'How does Hillier typically vote relative to the Mayor?',
    expectedContent: ['aligns', 'similar', 'with', 'together', 'supports', 'same'],
    requiredContent: ['Hillier'],
    verifiedAnswer: 'Hillier often votes with Mayor Morgan.',
    rationale: 'Tests councillor-Mayor alignment pattern.',
  },

  // ---------------------------------------------------------------------------
  // CATEGORY: Edge Cases and Nuanced Questions
  // ---------------------------------------------------------------------------
  
  {
    id: 'diff-032',
    category: 'edge-case',
    question: 'What happens in a tie vote at Council?',
    expectedContent: ['mayor', 'tie-break', 'casting', 'fails', 'does not pass'],
    verifiedAnswer: 'Tie votes fail (motion does not pass without majority).',
    rationale: 'Tests understanding of procedural rules.',
  },
  
  {
    id: 'diff-034',
    category: 'edge-case',
    question: 'Has a councillor ever changed their vote after initially voting?',
    expectedContent: ['Trosow', 'Rahman', 'Stevenson', 'reconsider', 'correct', 'reconsidered', 'yes'],
    unexpectedContent: ['Layman', 'Stevens'],  // Prevent hallucinated names
    verifiedAnswer: 'Yes - Trosow, Rahman, and Stevenson have all corrected votes via reconsideration motions.',
    rationale: 'Tests knowledge of vote correction procedure. Watch for hallucinated councillor names.',
  },
  {
    id: 'diff-035',
    category: 'edge-case',
    question: 'Are most Council votes contentious or unanimous?',
    expectedContent: ['unanimous', 'most', 'majority', 'routine', 'procedural', 'few contentious'],
    verifiedAnswer: 'Most votes are unanimous; contentious votes are a minority.',
    rationale: 'Tests awareness of overall voting patterns.',
  },

  // ---------------------------------------------------------------------------
  // CATEGORY: Policy and Topic Questions
  // ---------------------------------------------------------------------------
  {
    id: 'diff-036',
    category: 'policy',
    question: 'What is the Cooling By-law about?',
    expectedContent: ['temperature', 'maximum', 'tenant', 'rental', 'housing', 'heat', 'cooling'],
    verifiedAnswer: 'Establishes maximum temperature requirements for rental housing.',
    rationale: 'Tests understanding of policy content.',
  },
  {
    id: 'diff-037',
    category: 'policy',
    question: 'What does the Urban Growth Boundary Review involve?',
    expectedContent: ['boundary', 'growth', 'population', 'projection', 'land', 'development', 'expansion'],
    verifiedAnswer: 'Reviews city boundaries using updated population projections.',
    rationale: 'Tests understanding of planning policy.',
  },
  {
    id: 'diff-038',
    category: 'policy',
    question: 'What was the diaper waste motion about?',
    expectedContent: ['green bin', 'diaper', 'waste', 'collection', 'compost', 'expand'],
    verifiedAnswer: 'Motion to expand Green Bin program to include diapers.',
    rationale: 'Tests understanding of environmental policy.',
  },
  
  {
    id: 'diff-040',
    category: 'policy',
    question: 'What was the free parking motion at Budget Committee about?',
    expectedContent: ['Honk', 'app', 'free', 'parking', 'downtown', 'core area', 'two hour', 'one hour'],
    verifiedAnswer: 'Free parking through Honk App in downtown/core area.',
    rationale: 'Tests understanding of budget amendment.',
  },

  // ---------------------------------------------------------------------------
  // CATEGORY: Comparison and Reasoning
  // ---------------------------------------------------------------------------

  {
    id: 'diff-042',
    category: 'comparison',
    question: 'Did the same councillors who opposed Cooling By-law also oppose Warming Centre?',
    expectedContent: ['no', 'different', 'only Stevenson', 'nearly all', 'most supported', 'warming'],
    verifiedAnswer: 'No, only Stevenson opposed Warming Centre; many NAY on Cooling voted YEA on Warming.',
    rationale: 'Tests cross-motion vote comparison.',
  },
  

  // ---------------------------------------------------------------------------
  // CATEGORY: Recent/Historical Context
  // ---------------------------------------------------------------------------
  {
    id: 'diff-046',
    category: 'historical',
    question: 'How has voting on housing issues changed from 2024 to 2025?',
    expectedContent: ['similar', 'consistent', 'pattern', 'contentious', 'divided', 'ongoing'],
    verifiedAnswer: 'Housing remains contentious with similar voting patterns.',
    rationale: 'Tests temporal awareness.',
  },
  {
    id: 'diff-047',
    category: 'historical',
    question: 'What was the most contentious vote in late 2025?',
    expectedContent: ['Cooling', 'Urban Growth', 'free parking', '7-8', 'close', 'divided'],
    verifiedAnswer: 'Cooling By-law and Urban Growth Boundary were both highly contentious (7-8).',
    rationale: 'Tests identification of contentious issues.',
  },
  {
    id: 'diff-048',
    category: 'historical',
    question: 'Has Morgan lost many votes since becoming Mayor?',
    expectedContent: ['some', 'few', 'PA Day', '8-7', 'minority', 'occasionally', 'not many'],
    verifiedAnswer: 'Occasionally - PA Day motion passed against his vote (8-7).',
    rationale: 'Tests Mayor win/loss record awareness.',
  },
  {
    id: 'diff-049',
    category: 'historical',
    question: 'What budget amendments failed in November 2025?',
    expectedContent: ['parking', 'health unit', 'housing stability', '7-8', 'failed'],
    verifiedAnswer: 'Free parking amendments and Health Unit funding request failed 7-8.',
    rationale: 'Tests recent budget meeting recall.',
  },
  {
    id: 'diff-050',
    category: 'historical',
    question: 'Were there any successful 8-7 votes in 2025?',
    expectedContent: ['yes', 'PA Day', 'passed', 'some', 'budget', 'narrow'],
    verifiedAnswer: 'Yes, including PA Day motion and some Budget Committee items.',
    rationale: 'Tests awareness of narrow passing votes.',
  },
];

// =============================================================================
// TEST RUNNER
// =============================================================================

describe('Difficult Questions Test Suite (50 questions)', { concurrency: false }, async () => {
  // Run tests sequentially with delay to avoid rate limiting
  for (const testCase of testCases) {
    test(`[${testCase.id}] ${testCase.question} (${testCase.category})`, async () => {
      // Add delay between tests
      await new Promise(resolve => setTimeout(resolve, 1500));

      const response = await queryChat(testCase.question);
      const lowerResponse = response.toLowerCase();

      // Check if ANY expected content appears
      const hasExpected = testCase.expectedContent.some(term =>
        lowerResponse.includes(term.toLowerCase())
      );

      // Check if ALL required content appears (if specified)
      const hasAllRequired = !testCase.requiredContent ||
        testCase.requiredContent.every(term =>
          lowerResponse.includes(term.toLowerCase())
        );

      // Check that NO unexpected content appears (if specified)
      const hasNoUnexpected = !testCase.unexpectedContent ||
        !testCase.unexpectedContent.some(term =>
          lowerResponse.includes(term.toLowerCase())
        );

      // Log details for analysis
      console.log(`\n[${testCase.id}] ${testCase.category}`);
      console.log(`Q: ${testCase.question}`);
      console.log(`A: ${response.substring(0, 300)}${response.length > 300 ? '...' : ''}`);
      console.log(`Expected any of: ${testCase.expectedContent.slice(0, 5).join(', ')}${testCase.expectedContent.length > 5 ? '...' : ''}`);
      console.log(`Verified: ${testCase.verifiedAnswer}`);
      console.log(`Match: expected=${hasExpected}, required=${hasAllRequired}, noUnexpected=${hasNoUnexpected}`);
      console.log(`Rationale: ${testCase.rationale}`);

      if (!hasExpected) {
        console.log(`FAIL: None of expected content found`);
      }
      if (!hasAllRequired) {
        console.log(`FAIL: Missing required content: ${testCase.requiredContent}`);
      }
      if (!hasNoUnexpected) {
        console.log(`FAIL: Unexpected content found`);
      }

      assert.ok(
        hasExpected && hasAllRequired && hasNoUnexpected,
        `Response did not match expectations.
Question: ${testCase.question}
Expected (any): ${testCase.expectedContent.join(', ')}
Required (all): ${testCase.requiredContent?.join(', ') || 'none'}
Response snippet: ${response.substring(0, 200)}...`
      );
    });
  }
});

// Summary helper
describe('Test Summary', () => {
  test('Print category breakdown', () => {
    const categories = new Map<string, number>();
    for (const tc of testCases) {
      categories.set(tc.category, (categories.get(tc.category) || 0) + 1);
    }

    console.log('\n=== Category Breakdown ===');
    for (const [cat, count] of [...categories.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`${cat}: ${count} questions`);
    }
    console.log(`Total: ${testCases.length} questions`);
  });
});
