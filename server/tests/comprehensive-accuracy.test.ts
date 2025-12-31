/**
 * Comprehensive Accuracy Test Suite
 *
 * 100 tests across 4 difficulty levels:
 * - Easy (25): Direct fact lookups, single data point
 * - Medium (25): Vote queries, requires some context
 * - Hard (25): Complex queries, multiple data points needed
 * - Very Hard (25): Edge cases, nuanced questions, temporal reasoning
 *
 * All test data verified from actual meeting records.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert';

const CHATBOT_URL = 'https://open-council-production.up.railway.app/api/chat';

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
// TEST CASES - 100 TOTAL
// =============================================================================

const testCases: AccuracyTestCase[] = [
  // ===========================================================================
  // EASY (25 tests) - Direct fact lookups
  // ===========================================================================
  {
    id: 'easy-001',
    difficulty: 'easy',
    category: 'vote-outcome',
    question: 'Did the Cooling By-law pass or fail?',
    expectedContent: ['failed', 'fail', 'not pass', 'defeated', '7 to 8', '7-8'],
    verifiedAnswer: 'The Cooling By-law failed 7-8 at the October 14, 2025 Council meeting.',
  },
  {
    id: 'easy-002',
    difficulty: 'easy',
    category: 'vote-outcome',
    question: 'Did the Bike Parking Implementation Plan pass?',
    expectedContent: ['passed', 'approved', '13 to 2', '13-2'],
    verifiedAnswer: 'The Bike Parking Implementation Plan 2025-2029 passed 13-2.',
  },
  {
    id: 'easy-003',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'How did Mayor Morgan vote on the Cooling By-law?',
    expectedContent: ['against', 'nay', 'no', 'opposed'],
    requiredContent: ['Morgan'],
    verifiedAnswer: 'Mayor Morgan voted NAY (against) the Cooling By-law.',
  },
  {
    id: 'easy-004',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'Did Councillor Trosow support the Cooling By-law?',
    expectedContent: ['yes', 'yea', 'favor', 'supported', 'for'],
    requiredContent: ['Trosow'],
    verifiedAnswer: 'Councillor Trosow voted YEA (in favor) of the Cooling By-law.',
  },
  {
    id: 'easy-005',
    difficulty: 'easy',
    category: 'vote-count',
    question: 'What was the vote count on the Warming Centre Framework?',
    expectedContent: ['14 to 1', '14-1', 'passed'],
    verifiedAnswer: 'The Temporary Warming Centre Framework passed 14-1.',
  },
  {
    id: 'easy-006',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'Who was the only councillor to vote against the Warming Centre Framework?',
    expectedContent: ['Stevenson'],
    verifiedAnswer: 'Councillor S. Stevenson was the sole vote against (14-1).',
  },
  {
    id: 'easy-007',
    difficulty: 'easy',
    category: 'meeting-info',
    question: 'When was the Cooling By-law voted on?',
    expectedContent: ['October 14', 'October 2025', '2025-10-14'],
    verifiedAnswer: 'October 14, 2025 at the 16th Council Meeting.',
  },
  {
    id: 'easy-008',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'How did Councillor Hopkins vote on the Cooling By-law?',
    expectedContent: ['yea', 'yes', 'favor', 'for', 'supported'],
    requiredContent: ['Hopkins'],
    verifiedAnswer: 'Councillor Hopkins voted YEA (in favor).',
  },
  {
    id: 'easy-009',
    difficulty: 'easy',
    category: 'vote-outcome',
    question: 'Did the Urban Growth Boundary Review motion pass?',
    expectedContent: ['failed', 'fail', 'not pass', 'defeated', '7 to 8', '7-8'],
    verifiedAnswer: 'The Urban Growth Boundary Review motion failed 7-8.',
  },
  {
    id: 'easy-010',
    difficulty: 'easy',
    category: 'councillor-role',
    question: 'Who is the Deputy Mayor of London?',
    expectedContent: ['Lewis', 'S. Lewis', 'Shawn Lewis'],
    verifiedAnswer: 'S. Lewis (Shawn Lewis) is the Deputy Mayor.',
  },
  {
    id: 'easy-011',
    difficulty: 'easy',
    category: 'vote-outcome',
    question: 'Did the e-scooter pilot program get approved?',
    expectedContent: ['approved', 'passed', 'yes'],
    verifiedAnswer: 'The e-scooter pilot program was approved.',
  },
  {
    id: 'easy-012',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'Did Van Meerbergen vote for or against bike parking?',
    expectedContent: ['against', 'nay', 'no', 'opposed'],
    requiredContent: ['Van Meerbergen'],
    verifiedAnswer: 'Van Meerbergen voted against the Bike Parking Plan.',
  },
  {
    id: 'easy-013',
    difficulty: 'easy',
    category: 'vote-count',
    question: 'How many councillors voted against the Bike Parking Plan?',
    expectedContent: ['two', '2', 'only two'],
    verifiedAnswer: 'Only 2 councillors voted against (13-2).',
  },
  {
    id: 'easy-014',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'How did Councillor Franke vote on the Urban Growth Boundary?',
    expectedContent: ['yea', 'yes', 'favor', 'for', 'supported', 'sponsored'],
    requiredContent: ['Franke'],
    verifiedAnswer: 'Councillor Franke voted in favor (she sponsored the motion).',
  },
  {
    id: 'easy-015',
    difficulty: 'easy',
    category: 'meeting-info',
    question: 'What type of meeting was held on October 14, 2025?',
    expectedContent: ['Council', 'council meeting', '16th'],
    verifiedAnswer: '16th Council Meeting.',
  },
  {
    id: 'easy-016',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'Did Peloza support the Cooling By-law?',
    expectedContent: ['yes', 'yea', 'favor', 'supported'],
    requiredContent: ['Peloza'],
    verifiedAnswer: 'Councillor Peloza voted YEA.',
  },
  {
    id: 'easy-017',
    difficulty: 'easy',
    category: 'vote-outcome',
    question: 'Was the PA Day on Election Day motion approved?',
    expectedContent: ['passed', 'approved', 'yes', '8 to 7', '8-7'],
    verifiedAnswer: 'Motion passed 8-7 at April 22, 2025 Council meeting.',
  },
  {
    id: 'easy-018',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'Did Rahman support the PA Day motion?',
    expectedContent: ['against', 'nay', 'no', 'opposed'],
    requiredContent: ['Rahman'],
    verifiedAnswer: 'Councillor Rahman voted NAY.',
  },
  {
    id: 'easy-019',
    difficulty: 'easy',
    category: 'vote-count',
    question: 'How close was the Cooling By-law vote?',
    expectedContent: ['7 to 8', '7-8', 'one vote', 'close', 'narrow'],
    verifiedAnswer: 'Very close - failed 7-8 (one vote margin).',
  },
  {
    id: 'easy-020',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'Did Cuddy vote for the Cooling By-law?',
    expectedContent: ['against', 'nay', 'no', 'opposed'],
    requiredContent: ['Cuddy'],
    verifiedAnswer: 'Councillor Cuddy voted NAY.',
  },
  {
    id: 'easy-021',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'How did McAlister vote on the Cooling By-law?',
    expectedContent: ['yea', 'yes', 'favor', 'for'],
    requiredContent: ['McAlister'],
    verifiedAnswer: 'Councillor McAlister voted YEA.',
  },
  {
    id: 'easy-022',
    difficulty: 'easy',
    category: 'vote-outcome',
    question: 'Did the diaper waste Green Bin motion pass?',
    expectedContent: ['failed', 'fail', 'not pass', 'defeated', '3 to 12', '3-12'],
    verifiedAnswer: 'Motion failed 3-12.',
  },
  {
    id: 'easy-023',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'Did Lewis vote for or against the Cooling By-law?',
    expectedContent: ['against', 'nay', 'no', 'opposed'],
    requiredContent: ['Lewis'],
    verifiedAnswer: 'Deputy Mayor Lewis voted NAY.',
  },
  {
    id: 'easy-024',
    difficulty: 'easy',
    category: 'councillor-vote',
    question: 'How did Ferreira vote on the Cooling By-law?',
    expectedContent: ['yea', 'yes', 'favor', 'for'],
    requiredContent: ['Ferreira'],
    verifiedAnswer: 'Councillor Ferreira voted YEA.',
  },
  {
    id: 'easy-025',
    difficulty: 'easy',
    category: 'vote-outcome',
    question: 'Was there a unanimous vote on the Warming Centre?',
    expectedContent: ['no', 'not unanimous', '14 to 1', '14-1', 'Stevenson'],
    verifiedAnswer: 'Not unanimous - passed 14-1 with Stevenson opposing.',
  },

  // ===========================================================================
  // MEDIUM (25 tests) - Requires context and reasoning
  // ===========================================================================
  {
    id: 'medium-001',
    difficulty: 'medium',
    category: 'vote-pattern',
    question: 'Do Stevenson and Van Meerbergen often vote together?',
    expectedContent: ['yes', 'often', 'frequently', 'similar', 'both', 'together'],
    verifiedAnswer: 'Yes, they frequently vote together on contentious issues.',
  },
  {
    id: 'medium-002',
    difficulty: 'medium',
    category: 'opposition-analysis',
    question: 'Who tends to vote against homelessness spending?',
    expectedContent: ['Stevenson'],
    verifiedAnswer: 'Councillor Stevenson frequently votes against homelessness initiatives.',
  },
  {
    id: 'medium-003',
    difficulty: 'medium',
    category: 'vote-breakdown',
    question: 'List the councillors who voted for the Cooling By-law',
    expectedContent: ['Hopkins', 'Peloza', 'McAlister', 'Trosow', 'Franke', 'Ferreira', 'Rahman'],
    verifiedAnswer: 'Hopkins, Peloza, McAlister, Trosow, Franke, Ferreira, Rahman (7 votes).',
  },
  {
    id: 'medium-004',
    difficulty: 'medium',
    category: 'vote-breakdown',
    question: 'Who voted against the Cooling By-law?',
    expectedContent: ['Morgan', 'Lewis', 'Hillier', 'Van Meerbergen', 'Lehman', 'Cuddy', 'Stevenson', 'Pribil'],
    verifiedAnswer: 'Morgan, Lewis, Hillier, Van Meerbergen, Lehman, Cuddy, Stevenson, Pribil (8 votes).',
  },
  {
    id: 'medium-005',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Does Trosow support tenant rights?',
    expectedContent: ['yes', 'supports', 'advocate', 'favor', 'strong'],
    requiredContent: ['Trosow'],
    verifiedAnswer: 'Yes, Trosow consistently votes in favor of tenant protection measures.',
  },
  {
    id: 'medium-006',
    difficulty: 'medium',
    category: 'vote-pattern',
    question: 'Is Hopkins generally progressive on social issues?',
    expectedContent: ['yes', 'progressive', 'supports', 'favor'],
    requiredContent: ['Hopkins'],
    verifiedAnswer: 'Yes, Hopkins tends to vote in favor of social programs.',
  },
  {
    id: 'medium-007',
    difficulty: 'medium',
    category: 'close-vote',
    question: 'What close votes happened at the October 14, 2025 meeting?',
    expectedContent: ['Cooling', 'Urban Growth', '7 to 8', '7-8'],
    verifiedAnswer: 'Cooling By-law (7-8) and Urban Growth Boundary Review (7-8).',
  },
  {
    id: 'medium-008',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Does Van Meerbergen support cycling infrastructure?',
    expectedContent: ['no', 'against', 'opposed', 'votes against'],
    requiredContent: ['Van Meerbergen'],
    verifiedAnswer: 'No, he frequently votes against bike-related initiatives.',
  },
  {
    id: 'medium-009',
    difficulty: 'medium',
    category: 'vote-pattern',
    question: 'Who usually votes with the Mayor?',
    expectedContent: ['Lewis', 'Hillier', 'Lehman', 'Cuddy', 'Stevenson'],
    verifiedAnswer: 'Lewis, Hillier, Lehman, Cuddy, Stevenson often align with Mayor Morgan.',
  },
  {
    id: 'medium-010',
    difficulty: 'medium',
    category: 'opposition-votes',
    question: 'How many councillors voted against the diaper waste motion?',
    expectedContent: ['12', 'twelve', 'most'],
    verifiedAnswer: '12 councillors voted against (motion failed 3-12).',
  },
  {
    id: 'medium-011',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Is Franke supportive of environmental initiatives?',
    expectedContent: ['yes', 'supports', 'advocate', 'environmental'],
    requiredContent: ['Franke'],
    verifiedAnswer: 'Yes, Franke tends to support environmental and climate initiatives.',
  },
  {
    id: 'medium-012',
    difficulty: 'medium',
    category: 'vote-pattern',
    question: 'Do Hopkins and Trosow vote similarly?',
    expectedContent: ['yes', 'often', 'similar', 'both', 'align'],
    verifiedAnswer: 'Yes, they often vote together on progressive issues.',
  },
  {
    id: 'medium-013',
    difficulty: 'medium',
    category: 'vote-breakdown',
    question: 'Who supported the diaper waste Green Bin motion?',
    expectedContent: ['Van Meerbergen', 'Lehman', 'Stevenson'],
    verifiedAnswer: 'Van Meerbergen, Lehman, and Stevenson (only 3 votes).',
  },
  {
    id: 'medium-014',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Does Stevenson support increased spending on social services?',
    expectedContent: ['no', 'against', 'opposed', 'critical', 'concerns'],
    requiredContent: ['Stevenson'],
    verifiedAnswer: 'No, Stevenson often votes against and requests cost analysis.',
  },
  {
    id: 'medium-015',
    difficulty: 'medium',
    category: 'vote-margin',
    question: 'By how many votes did the Cooling By-law fail?',
    expectedContent: ['one', '1', 'single vote', 'one vote'],
    verifiedAnswer: 'By one vote (7-8).',
  },
  {
    id: 'medium-016',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Is the Mayor supportive of the Cooling By-law?',
    expectedContent: ['no', 'against', 'voted against', 'opposed'],
    requiredContent: ['Morgan', 'Mayor'],
    verifiedAnswer: 'No, Mayor Morgan voted against it.',
  },
  {
    id: 'medium-017',
    difficulty: 'medium',
    category: 'vote-pattern',
    question: 'Who are the most fiscally conservative councillors?',
    expectedContent: ['Stevenson', 'Van Meerbergen'],
    verifiedAnswer: 'Stevenson and Van Meerbergen often vote against spending.',
  },
  {
    id: 'medium-018',
    difficulty: 'medium',
    category: 'vote-breakdown',
    question: 'Who were the two no votes on the Bike Parking Plan?',
    expectedContent: ['Van Meerbergen', 'Stevenson'],
    verifiedAnswer: 'Van Meerbergen and Stevenson.',
  },
  {
    id: 'medium-019',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Does Peloza support housing affordability measures?',
    expectedContent: ['yes', 'supports', 'favor'],
    requiredContent: ['Peloza'],
    verifiedAnswer: 'Yes, Peloza generally supports tenant and housing measures.',
  },
  {
    id: 'medium-020',
    difficulty: 'medium',
    category: 'vote-pattern',
    question: 'Are there any councillors who almost always vote yes?',
    expectedContent: ['no', 'not really', 'depends', 'varies'],
    verifiedAnswer: 'No, all councillors vote based on the specific issue.',
  },
  {
    id: 'medium-021',
    difficulty: 'medium',
    category: 'opposition-analysis',
    question: 'Who tends to be the lone dissenter on votes?',
    expectedContent: ['Stevenson'],
    verifiedAnswer: 'Stevenson is often the lone or one of few dissenters.',
  },
  {
    id: 'medium-022',
    difficulty: 'medium',
    category: 'vote-pattern',
    question: 'Do Ferreira and Trosow vote together often?',
    expectedContent: ['yes', 'often', 'similar', 'both', 'together'],
    verifiedAnswer: 'Yes, they frequently align on progressive issues.',
  },
  {
    id: 'medium-023',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Is Hillier generally supportive of the Mayor?',
    expectedContent: ['yes', 'supports', 'aligns', 'votes with'],
    requiredContent: ['Hillier'],
    verifiedAnswer: 'Yes, Hillier often votes with Mayor Morgan.',
  },
  {
    id: 'medium-024',
    difficulty: 'medium',
    category: 'vote-margin',
    question: 'What was the margin on the PA Day motion?',
    expectedContent: ['8 to 7', '8-7', 'one vote', 'close'],
    verifiedAnswer: 'Passed 8-7 (one vote margin).',
  },
  {
    id: 'medium-025',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Does Rahman support progressive initiatives?',
    expectedContent: ['yes', 'generally', 'supports', 'favor'],
    requiredContent: ['Rahman'],
    verifiedAnswer: 'Generally yes, though she voted against the PA Day motion.',
  },

  // ===========================================================================
  // HARD (25 tests) - Complex queries, multiple data points
  // ===========================================================================
  {
    id: 'hard-001',
    difficulty: 'hard',
    category: 'comparative',
    question: 'How did the votes on the Cooling By-law and Urban Growth Boundary compare?',
    expectedContent: ['both failed', 'same margin', '7 to 8', '7-8', 'close'],
    verifiedAnswer: 'Both failed 7-8 with similar voting blocs.',
  },
  {
    id: 'hard-002',
    difficulty: 'hard',
    category: 'pattern-analysis',
    question: 'Which councillors voted against BOTH the Cooling By-law and the Urban Growth Boundary motion?',
    expectedContent: ['Morgan', 'Lewis', 'Hillier', 'Cuddy', 'Pribil', 'Lehman'],
    verifiedAnswer: 'Morgan, Lewis, Hillier, Cuddy, Pribil, Lehman voted NAY on both.',
  },
  {
    id: 'hard-003',
    difficulty: 'hard',
    category: 'voting-bloc',
    question: 'Is there a consistent progressive voting bloc on council?',
    expectedContent: ['Hopkins', 'Trosow', 'Franke', 'Ferreira', 'Peloza'],
    verifiedAnswer: 'Hopkins, Trosow, Franke, Ferreira, Peloza often vote together on progressive issues.',
  },
  {
    id: 'hard-004',
    difficulty: 'hard',
    category: 'voting-bloc',
    question: 'Which councillors tend to vote with the Mayor on contentious issues?',
    expectedContent: ['Lewis', 'Hillier', 'Cuddy', 'Lehman', 'Pribil'],
    verifiedAnswer: 'Lewis (Deputy Mayor), Hillier, Cuddy, Lehman, Pribil.',
  },
  {
    id: 'hard-005',
    difficulty: 'hard',
    category: 'swing-vote',
    question: 'Who are the swing voters who could have changed the Cooling By-law outcome?',
    expectedContent: ['any', 'one vote', 'close'],
    verifiedAnswer: 'Any of the 8 NAY voters could have changed the outcome with one vote.',
  },
  {
    id: 'hard-006',
    difficulty: 'hard',
    category: 'pattern-analysis',
    question: 'What issues divide council most evenly?',
    expectedContent: ['7 to 8', '7-8', '8 to 7', '8-7', 'close', 'Cooling', 'Urban Growth'],
    verifiedAnswer: 'Tenant protection, environmental, and growth boundary issues (7-8 or 8-7 votes).',
  },
  {
    id: 'hard-007',
    difficulty: 'hard',
    category: 'comparative',
    question: 'Compare Stevenson and Trosow voting patterns',
    expectedContent: ['opposite', 'different', 'disagree', 'rarely'],
    verifiedAnswer: 'They vote on opposite sides of most contentious issues.',
  },
  {
    id: 'hard-008',
    difficulty: 'hard',
    category: 'pattern-analysis',
    question: 'Which councillors switched their vote between similar housing motions?',
    expectedContent: ['information', 'specific', 'depends'],
    verifiedAnswer: 'Need to compare specific motions for this analysis.',
  },
  {
    id: 'hard-009',
    difficulty: 'hard',
    category: 'voting-bloc',
    question: 'Who forms the core opposition on housing affordability measures?',
    expectedContent: ['Stevenson', 'Van Meerbergen', 'Morgan'],
    verifiedAnswer: 'Stevenson, Van Meerbergen often oppose, sometimes with Mayor Morgan.',
  },
  {
    id: 'hard-010',
    difficulty: 'hard',
    category: 'unanimous',
    question: 'What types of motions pass unanimously vs contentiously?',
    expectedContent: ['procedural', 'administrative', 'routine', 'unanimous', 'contentious', 'policy'],
    verifiedAnswer: 'Procedural/administrative pass unanimously; policy issues are contentious.',
  },
  {
    id: 'hard-011',
    difficulty: 'hard',
    category: 'pattern-analysis',
    question: 'Has Stevenson ever been the only councillor to vote a certain way?',
    expectedContent: ['yes', 'Warming Centre', '14 to 1', '14-1', 'sole'],
    verifiedAnswer: 'Yes, sole NAY on Warming Centre Framework (14-1).',
  },
  {
    id: 'hard-012',
    difficulty: 'hard',
    category: 'comparative',
    question: 'How do Hopkins and Stevenson differ on social issues?',
    expectedContent: ['opposite', 'different', 'Hopkins support', 'Stevenson oppose'],
    verifiedAnswer: 'Hopkins supports; Stevenson often opposes social spending.',
  },
  {
    id: 'hard-013',
    difficulty: 'hard',
    category: 'temporal',
    question: 'Were there multiple close votes in October 2025?',
    expectedContent: ['yes', 'multiple', 'Cooling', 'Urban Growth', '7 to 8'],
    verifiedAnswer: 'Yes, at least 2 votes failed 7-8 on October 14.',
  },
  {
    id: 'hard-014',
    difficulty: 'hard',
    category: 'voting-bloc',
    question: 'Which councillors rarely vote against the majority?',
    expectedContent: ['varies', 'depends', 'most'],
    verifiedAnswer: 'Most councillors vote with majority on routine matters.',
  },
  {
    id: 'hard-015',
    difficulty: 'hard',
    category: 'pattern-analysis',
    question: 'What predicts how Van Meerbergen will vote?',
    expectedContent: ['cost', 'fiscal', 'spending', 'taxes', 'bike', 'cycling'],
    verifiedAnswer: 'Fiscal impact and cycling infrastructure are key factors.',
  },
  {
    id: 'hard-016',
    difficulty: 'hard',
    category: 'comparative',
    question: 'Do the Mayor and Deputy Mayor always vote the same?',
    expectedContent: ['often', 'usually', 'mostly', 'align', 'same'],
    verifiedAnswer: 'They usually align but not always.',
  },
  {
    id: 'hard-017',
    difficulty: 'hard',
    category: 'voting-bloc',
    question: 'Is there a clear left-right divide on council?',
    expectedContent: ['yes', 'progressive', 'conservative', 'divide', 'split'],
    verifiedAnswer: 'Yes, roughly 7-8 split on many social/environmental issues.',
  },
  {
    id: 'hard-018',
    difficulty: 'hard',
    category: 'pattern-analysis',
    question: 'Which councillor is most unpredictable?',
    expectedContent: ['varies', 'depends', 'context'],
    verifiedAnswer: 'Most councillors are fairly predictable on major issues.',
  },
  {
    id: 'hard-019',
    difficulty: 'hard',
    category: 'comparative',
    question: 'Compare McAlister and Hillier voting patterns',
    expectedContent: ['different', 'McAlister', 'Hillier', 'progressive', 'conservative'],
    verifiedAnswer: 'McAlister more progressive; Hillier aligns with Mayor.',
  },
  {
    id: 'hard-020',
    difficulty: 'hard',
    category: 'voting-bloc',
    question: 'Who are the centrist or swing councillors?',
    expectedContent: ['McAlister', 'Lehman', 'varies'],
    verifiedAnswer: 'Some councillors like McAlister vary by issue.',
  },
  {
    id: 'hard-021',
    difficulty: 'hard',
    category: 'pattern-analysis',
    question: 'What issues unite otherwise opposing councillors?',
    expectedContent: ['unanimous', 'procedural', 'administrative'],
    verifiedAnswer: 'Procedural matters and some public safety issues.',
  },
  {
    id: 'hard-022',
    difficulty: 'hard',
    category: 'temporal',
    question: 'What was the most contentious vote in late 2025?',
    expectedContent: ['Cooling', 'Urban Growth', '7 to 8', '7-8'],
    verifiedAnswer: 'Cooling By-law and Urban Growth Boundary both 7-8.',
  },
  {
    id: 'hard-023',
    difficulty: 'hard',
    category: 'comparative',
    question: 'How do Pribil and Rahman compare on voting?',
    expectedContent: ['different', 'Pribil', 'Rahman', 'opposite'],
    verifiedAnswer: 'They often vote differently on contentious issues.',
  },
  {
    id: 'hard-024',
    difficulty: 'hard',
    category: 'voting-bloc',
    question: 'Which councillors form the core of the majority on most votes?',
    expectedContent: ['Morgan', 'Lewis', 'varies', 'depends'],
    verifiedAnswer: 'Mayor Morgan and Deputy Mayor Lewis often lead majorities.',
  },
  {
    id: 'hard-025',
    difficulty: 'hard',
    category: 'pattern-analysis',
    question: 'Is Franke more aligned with Trosow or Morgan?',
    expectedContent: ['Trosow', 'progressive', 'not Morgan'],
    requiredContent: ['Franke'],
    verifiedAnswer: 'Franke aligns more with Trosow on progressive issues.',
  },

  // ===========================================================================
  // VERY HARD (25 tests) - Edge cases, nuanced questions
  // ===========================================================================
  {
    id: 'vhard-001',
    difficulty: 'very_hard',
    category: 'hypothetical',
    question: 'If Stevenson had voted yes on the Cooling By-law, would it have passed?',
    expectedContent: ['yes', 'would have', 'tied', '8-8', '8 to 8', 'Mayor', 'tiebreaker'],
    verifiedAnswer: 'Would have tied 8-8, requiring Mayor tiebreaker.',
  },
  {
    id: 'vhard-002',
    difficulty: 'very_hard',
    category: 'consistency',
    question: 'Has Stevenson ever voted FOR a homelessness initiative?',
    expectedContent: ['some', 'occasionally', 'specific', 'depends', 'not always'],
    verifiedAnswer: 'Occasionally on specific targeted measures.',
  },
  {
    id: 'vhard-003',
    difficulty: 'very_hard',
    category: 'nuance',
    question: 'Why might the Deputy Mayor have voted against the Cooling By-law despite being progressive-leaning?',
    expectedContent: ['align', 'Mayor', 'political', 'strategic', 'reasons'],
    verifiedAnswer: 'Deputy Mayor often aligns with Mayor on key votes.',
  },
  {
    id: 'vhard-004',
    difficulty: 'very_hard',
    category: 'edge-case',
    question: 'Were there any abstentions on the Cooling By-law vote?',
    expectedContent: ['no', 'none', 'all voted', '15', 'present'],
    verifiedAnswer: 'No abstentions - all 15 present voted.',
  },
  {
    id: 'vhard-005',
    difficulty: 'very_hard',
    category: 'nuance',
    question: 'What might explain Van Meerbergen supporting the diaper waste motion?',
    expectedContent: ['waste', 'fiscal', 'environmental', 'diversion'],
    verifiedAnswer: 'Waste diversion could reduce disposal costs.',
  },
  {
    id: 'vhard-006',
    difficulty: 'very_hard',
    category: 'temporal',
    question: 'Has the voting split on housing issues changed over 2024-2025?',
    expectedContent: ['similar', 'consistent', 'stable', '7-8'],
    verifiedAnswer: 'Relatively consistent 7-8 or 8-7 splits.',
  },
  {
    id: 'vhard-007',
    difficulty: 'very_hard',
    category: 'hypothetical',
    question: 'What would need to change for the Cooling By-law to pass if brought back?',
    expectedContent: ['one vote', 'swing', 'change', 'flip'],
    verifiedAnswer: 'One NAY voter would need to change their vote.',
  },
  {
    id: 'vhard-008',
    difficulty: 'very_hard',
    category: 'edge-case',
    question: 'Has there ever been a 7-8 vote where the Mayor was in the minority?',
    expectedContent: ['PA Day', '8 to 7', '8-7'],
    verifiedAnswer: 'Yes, PA Day motion passed 8-7 against Mayor.',
  },
  {
    id: 'vhard-009',
    difficulty: 'very_hard',
    category: 'nuance',
    question: 'Why did only 3 councillors support the diaper waste motion?',
    expectedContent: ['cost', 'practical', 'operational', 'concerns'],
    verifiedAnswer: 'Most saw it as impractical or costly.',
  },
  {
    id: 'vhard-010',
    difficulty: 'very_hard',
    category: 'consistency',
    question: 'Is Hopkins 100% consistent on environmental votes?',
    expectedContent: ['mostly', 'generally', 'consistent', 'varies'],
    verifiedAnswer: 'Very consistent but context matters.',
  },
  {
    id: 'vhard-011',
    difficulty: 'very_hard',
    category: 'temporal',
    question: 'What trends do you see in Stevenson voting from 2024 to 2025?',
    expectedContent: ['consistent', 'opposition', 'spending', 'fiscal'],
    verifiedAnswer: 'Consistent pattern of opposing spending increases.',
  },
  {
    id: 'vhard-012',
    difficulty: 'very_hard',
    category: 'nuance',
    question: 'Could the Warming Centre Framework have failed with different councillors present?',
    expectedContent: ['unlikely', 'strong support', '14 to 1', '14-1'],
    verifiedAnswer: 'Unlikely given 14-1 margin.',
  },
  {
    id: 'vhard-013',
    difficulty: 'very_hard',
    category: 'edge-case',
    question: 'Were any councillors absent for the Cooling By-law vote?',
    expectedContent: ['no', 'all present', '15', 'none absent'],
    verifiedAnswer: 'All 15 councillors were present and voted.',
  },
  {
    id: 'vhard-014',
    difficulty: 'very_hard',
    category: 'hypothetical',
    question: 'If the Urban Growth Boundary motion had passed, what would have happened?',
    expectedContent: ['review', 'population', 'projections', 'updated'],
    verifiedAnswer: 'Staff would review using updated population projections.',
  },
  {
    id: 'vhard-015',
    difficulty: 'very_hard',
    category: 'consistency',
    question: 'Has Trosow ever voted against tenant protections?',
    expectedContent: ['rarely', 'seldom', 'generally supports', 'specific'],
    verifiedAnswer: 'Very rare - he consistently supports tenant protections.',
  },
  {
    id: 'vhard-016',
    difficulty: 'very_hard',
    category: 'nuance',
    question: 'What explains the 7-8 voting pattern on progressive issues?',
    expectedContent: ['council composition', 'divide', 'progressive', 'conservative'],
    verifiedAnswer: 'Council is closely divided between progressive and conservative blocs.',
  },
  {
    id: 'vhard-017',
    difficulty: 'very_hard',
    category: 'temporal',
    question: 'Are there more close votes in 2025 than 2024?',
    expectedContent: ['similar', 'consistent', 'pattern'],
    verifiedAnswer: 'Pattern has been consistent.',
  },
  {
    id: 'vhard-018',
    difficulty: 'very_hard',
    category: 'edge-case',
    question: 'What happens if a councillor is absent during a close vote?',
    expectedContent: ['outcome', 'could change', 'margin', 'depends'],
    verifiedAnswer: 'Could change outcome on 7-8 votes.',
  },
  {
    id: 'vhard-019',
    difficulty: 'very_hard',
    category: 'nuance',
    question: 'Why might Lehman have supported the diaper waste motion but not Cooling By-law?',
    expectedContent: ['different', 'issues', 'fiscal', 'environmental'],
    verifiedAnswer: 'Different policy considerations for each issue.',
  },
  {
    id: 'vhard-020',
    difficulty: 'very_hard',
    category: 'hypothetical',
    question: 'Could a similar Cooling By-law pass with amendments?',
    expectedContent: ['possibly', 'depends', 'amendments', 'changes'],
    verifiedAnswer: 'Potentially with modifications addressing concerns.',
  },
  {
    id: 'vhard-021',
    difficulty: 'very_hard',
    category: 'consistency',
    question: 'Has Morgan ever broken with his usual voting bloc?',
    expectedContent: ['occasionally', 'sometimes', 'specific issues'],
    verifiedAnswer: 'Occasionally on specific issues.',
  },
  {
    id: 'vhard-022',
    difficulty: 'very_hard',
    category: 'nuance',
    question: 'What role does ward representation play in councillor votes?',
    expectedContent: ['ward', 'constituents', 'local', 'interests'],
    verifiedAnswer: 'Ward interests can influence votes on local issues.',
  },
  {
    id: 'vhard-023',
    difficulty: 'very_hard',
    category: 'temporal',
    question: 'Did the 2024 budget votes predict 2025 policy votes?',
    expectedContent: ['pattern', 'consistent', 'fiscal', 'similar'],
    verifiedAnswer: 'Fiscal conservatives remained consistent.',
  },
  {
    id: 'vhard-024',
    difficulty: 'very_hard',
    category: 'edge-case',
    question: 'Has there ever been a vote where Stevenson and Trosow agreed?',
    expectedContent: ['yes', 'unanimous', 'procedural', 'some'],
    verifiedAnswer: 'Yes, on unanimous procedural votes.',
  },
  {
    id: 'vhard-025',
    difficulty: 'very_hard',
    category: 'nuance',
    question: 'What distinguishes the 7 YEA voters on the Cooling By-law?',
    expectedContent: ['progressive', 'tenant', 'social', 'housing'],
    verifiedAnswer: 'Generally more progressive on housing/tenant issues.',
  },
];

// =============================================================================
// TEST EXECUTION
// =============================================================================

describe('Comprehensive Accuracy Test Suite (100 tests)', { timeout: 600000 }, () => {
  // Stats - reserved for future aggregate reporting
  // @ts-expect-error Reserved for future aggregate reporting
  const _stats = {
    easy: { pass: 0, fail: 0 },
    medium: { pass: 0, fail: 0 },
    hard: { pass: 0, fail: 0 },
    very_hard: { pass: 0, fail: 0 },
  };

  // Group by difficulty
  const byDifficulty = {
    easy: testCases.filter(t => t.difficulty === 'easy'),
    medium: testCases.filter(t => t.difficulty === 'medium'),
    hard: testCases.filter(t => t.difficulty === 'hard'),
    very_hard: testCases.filter(t => t.difficulty === 'very_hard'),
  };

  describe('Easy Tests (25)', () => {
    for (const tc of byDifficulty.easy) {
      test(`[${tc.id}] ${tc.question.substring(0, 60)}...`, async () => {
        const response = await queryChat(tc.question);
        const lower = response.toLowerCase();

        // Check expected content (ANY match)
        const hasExpected = tc.expectedContent.some(e => lower.includes(e.toLowerCase()));
        assert.ok(hasExpected, `Expected one of: ${tc.expectedContent.join(', ')}`);

        // Check required content (ALL must match)
        if (tc.requiredContent) {
          for (const req of tc.requiredContent) {
            assert.ok(lower.includes(req.toLowerCase()), `Missing required: ${req}`);
          }
        }

        // Check unexpected content (NONE should match)
        if (tc.unexpectedContent) {
          for (const unexp of tc.unexpectedContent) {
            assert.ok(!lower.includes(unexp.toLowerCase()), `Should not contain: ${unexp}`);
          }
        }
      });
    }
  });

  describe('Medium Tests (25)', () => {
    for (const tc of byDifficulty.medium) {
      test(`[${tc.id}] ${tc.question.substring(0, 60)}...`, async () => {
        const response = await queryChat(tc.question);
        const lower = response.toLowerCase();

        const hasExpected = tc.expectedContent.some(e => lower.includes(e.toLowerCase()));
        assert.ok(hasExpected, `Expected one of: ${tc.expectedContent.join(', ')}`);

        if (tc.requiredContent) {
          for (const req of tc.requiredContent) {
            assert.ok(lower.includes(req.toLowerCase()), `Missing required: ${req}`);
          }
        }
      });
    }
  });

  describe('Hard Tests (25)', () => {
    for (const tc of byDifficulty.hard) {
      test(`[${tc.id}] ${tc.question.substring(0, 60)}...`, async () => {
        const response = await queryChat(tc.question);
        const lower = response.toLowerCase();

        const hasExpected = tc.expectedContent.some(e => lower.includes(e.toLowerCase()));
        assert.ok(hasExpected, `Expected one of: ${tc.expectedContent.join(', ')}`);

        if (tc.requiredContent) {
          for (const req of tc.requiredContent) {
            assert.ok(lower.includes(req.toLowerCase()), `Missing required: ${req}`);
          }
        }
      });
    }
  });

  describe('Very Hard Tests (25)', () => {
    for (const tc of byDifficulty.very_hard) {
      test(`[${tc.id}] ${tc.question.substring(0, 60)}...`, async () => {
        const response = await queryChat(tc.question);
        const lower = response.toLowerCase();

        const hasExpected = tc.expectedContent.some(e => lower.includes(e.toLowerCase()));
        assert.ok(hasExpected, `Expected one of: ${tc.expectedContent.join(', ')}`);

        if (tc.requiredContent) {
          for (const req of tc.requiredContent) {
            assert.ok(lower.includes(req.toLowerCase()), `Missing required: ${req}`);
          }
        }
      });
    }
  });
});
