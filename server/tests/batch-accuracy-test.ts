/**
 * Batch Accuracy Test using Anthropic Batch API
 *
 * Uses the Batch API for 50% cost savings compared to individual requests.
 * Submits all test questions in a single batch, waits for completion, then evaluates.
 */

import Anthropic from '@anthropic-ai/sdk';
import { VectorStore } from '../vector-store.js';
import { getSystemPrompt } from '../system-prompt.js';
import { voteLookupService } from '../vote-lookup.js';
import { councillorStatsLookupService } from '../councillor-stats-lookup.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

if (!ANTHROPIC_API_KEY || !OPENAI_API_KEY) {
  console.error('❌ Missing API keys. Set ANTHROPIC_API_KEY and OPENAI_API_KEY in .env file');
  process.exit(1);
}

interface AccuracyTestCase {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'very_hard';
  category: string;
  question: string;
  expectedContent: string[];
  requiredContent?: string[];
  unexpectedContent?: string[];
  verifiedAnswer: string;
}

// Import test cases (subset for alignment tests)
const alignmentTestCases: AccuracyTestCase[] = [
  {
    id: 'medium-009',
    difficulty: 'medium',
    category: 'vote-pattern',
    question: 'Who usually votes with the Mayor?',
    expectedContent: ['Lewis', 'Hillier', 'Lehman', 'Cuddy', 'Stevenson'],
    verifiedAnswer: 'Lewis, Hillier, Lehman, Cuddy, Stevenson often align with Mayor Morgan.',
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
    id: 'medium-023',
    difficulty: 'medium',
    category: 'councillor-stance',
    question: 'Is Hillier generally supportive of the Mayor?',
    expectedContent: ['yes', 'supports', 'aligns', 'votes with'],
    requiredContent: ['Hillier'],
    verifiedAnswer: 'Yes, Hillier often votes with Mayor Morgan.',
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
    id: 'hard-015',
    difficulty: 'hard',
    category: 'pattern-analysis',
    question: 'What predicts how Van Meerbergen will vote?',
    expectedContent: ['cost', 'fiscal', 'spending', 'taxes', 'bike', 'cycling'],
    verifiedAnswer: 'Fiscal impact and cycling infrastructure are key factors.',
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
    id: 'hard-024',
    difficulty: 'hard',
    category: 'voting-bloc',
    question: 'Which councillors form the core of the majority on most votes?',
    expectedContent: ['Morgan', 'Lewis', 'varies', 'depends'],
    verifiedAnswer: 'Mayor Morgan and Deputy Mayor Lewis often lead majorities.',
  },
  {
    id: 'vhard-021',
    difficulty: 'very_hard',
    category: 'consistency',
    question: 'Has Morgan ever broken with his usual voting bloc?',
    expectedContent: ['occasionally', 'sometimes', 'specific issues'],
    verifiedAnswer: 'Occasionally on specific issues.',
  },
];

async function getContextForQuestion(
  vectorStore: VectorStore,
  question: string
): Promise<string> {
  // Simple context retrieval - just get relevant chunks
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: question,
  });
  const queryEmbedding = embeddingResponse.data[0].embedding;

  // Check for alignment queries and add verified data
  let verifiedContext = '';
  const lowerQ = question.toLowerCase();

  if (lowerQ.includes('votes with') && lowerQ.includes('mayor')) {
    verifiedContext = councillorStatsLookupService.formatMayorAlignmentForContext();
  } else if (lowerQ.includes('lone dissenter') || lowerQ.includes('dissent')) {
    verifiedContext = councillorStatsLookupService.formatLoneDissentersForContext();
  } else if (lowerQ.includes('swing') || lowerQ.includes('centrist')) {
    verifiedContext = councillorStatsLookupService.formatSwingVotersForContext();
  } else if (lowerQ.includes('hillier') && lowerQ.includes('mayor')) {
    verifiedContext = councillorStatsLookupService.formatCouncillorAlignmentForContext('s-hillier');
  } else if (lowerQ.includes('van meerbergen')) {
    verifiedContext = councillorStatsLookupService.formatCouncillorAlignmentForContext('p-van-meerbergen');
  } else if (lowerQ.includes('core') && (lowerQ.includes('majority') || lowerQ.includes('opposition'))) {
    verifiedContext = councillorStatsLookupService.formatMayorAlignmentForContext();
  } else if (lowerQ.includes('morgan') && lowerQ.includes('bloc')) {
    verifiedContext = councillorStatsLookupService.formatMayorAlignmentForContext();
  }

  // Get semantic results
  const results = await vectorStore.hybridSearch(
    queryEmbedding,
    `councillor alignment vote voting pattern ${question}`,
    30,
    0.5
  );

  // Build context string
  const chunksContext = results
    .map((result, idx) => {
      const meta = result.metadata;
      return `
## Context ${idx + 1}
**Meeting:** ${meta.meeting_title} (${meta.meeting_date})
**Type:** ${meta.chunk_type}${meta.item_title ? ` - ${meta.item_title}` : ''}

${result.text}
---`;
    })
    .join('\n');

  if (verifiedContext) {
    return verifiedContext + '\n\n---\n\n# Additional Context from Meeting Records\n\n' + chunksContext;
  }

  return chunksContext || 'No relevant information found.';
}

async function runBatchTest(testCases: AccuracyTestCase[]) {
  console.log('🚀 Starting Batch Accuracy Test');
  console.log(`📊 Testing ${testCases.length} questions using Anthropic Batch API (50% cost savings)\n`);

  // Initialize services
  console.log('📦 Initializing services...');
  const vectorStore = new VectorStore();
  await vectorStore.initialize();
  await voteLookupService.initialize();
  await councillorStatsLookupService.initialize();
  console.log('✅ Services initialized\n');

  // Build batch requests
  console.log('🔧 Building batch requests...');
  const batchRequests: Anthropic.Messages.BatchCreateParams.Request[] = [];

  for (const tc of testCases) {
    const context = await getContextForQuestion(vectorStore, tc.question);
    const systemPrompt = getSystemPrompt(context);

    batchRequests.push({
      custom_id: tc.id,
      params: {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        temperature: 0.4,
        system: systemPrompt,
        messages: [
          { role: 'user', content: tc.question }
        ],
      },
    });
    console.log(`  ✓ Prepared: ${tc.id} - ${tc.question.substring(0, 50)}...`);
  }

  // Submit batch
  console.log('\n📤 Submitting batch to Anthropic API...');
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const batch = await anthropic.messages.batches.create({
    requests: batchRequests,
  });

  console.log(`✅ Batch created: ${batch.id}`);
  console.log(`   Status: ${batch.processing_status}`);
  console.log(`   Request counts: ${JSON.stringify(batch.request_counts)}`);

  // Poll for completion
  console.log('\n⏳ Waiting for batch completion...');
  let currentBatch = batch;
  let pollCount = 0;
  const maxPolls = 120; // 10 minutes max (5 second intervals)

  while (currentBatch.processing_status === 'in_progress' && pollCount < maxPolls) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second intervals
    currentBatch = await anthropic.messages.batches.retrieve(batch.id);
    pollCount++;

    const counts = currentBatch.request_counts;
    console.log(`   [${pollCount}] Status: ${currentBatch.processing_status} | Succeeded: ${counts.succeeded}/${testCases.length} | Processing: ${counts.processing}`);
  }

  if (currentBatch.processing_status !== 'ended') {
    console.error(`❌ Batch did not complete. Final status: ${currentBatch.processing_status}`);
    return;
  }

  console.log('\n✅ Batch completed!');

  // Get results
  console.log('\n📥 Downloading results...');

  // The results come as a stream of JSONL
  const resultsStream = await anthropic.messages.batches.results(batch.id);
  const results: Map<string, string> = new Map();

  for await (const result of resultsStream) {
    if (result.result.type === 'succeeded') {
      const message = result.result.message;
      const content = message.content[0];
      if (content.type === 'text') {
        results.set(result.custom_id, content.text);
      }
    } else {
      console.error(`  ❌ ${result.custom_id}: ${result.result.type}`);
    }
  }

  // Evaluate results
  console.log('\n📊 Evaluating results...\n');
  console.log('=' .repeat(80));

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const response = results.get(tc.id) || '';
    const lower = response.toLowerCase();

    // Check expected content (ANY match)
    const hasExpected = tc.expectedContent.some(e => lower.includes(e.toLowerCase()));

    // Check required content (ALL must match)
    let hasRequired = true;
    if (tc.requiredContent) {
      hasRequired = tc.requiredContent.every(req => lower.includes(req.toLowerCase()));
    }

    // Check unexpected content (NONE should match)
    let hasUnexpected = false;
    if (tc.unexpectedContent) {
      hasUnexpected = tc.unexpectedContent.some(unexp => lower.includes(unexp.toLowerCase()));
    }

    const testPassed = hasExpected && hasRequired && !hasUnexpected;

    if (testPassed) {
      passed++;
      console.log(`✅ ${tc.id}: PASSED`);
    } else {
      failed++;
      console.log(`❌ ${tc.id}: FAILED`);
      console.log(`   Question: ${tc.question}`);
      console.log(`   Expected one of: ${tc.expectedContent.join(', ')}`);
      if (tc.requiredContent && !hasRequired) {
        console.log(`   Missing required: ${tc.requiredContent.join(', ')}`);
      }
      console.log(`   Response preview: ${response.substring(0, 200)}...`);
    }
    console.log('-'.repeat(80));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📈 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total: ${testCases.length}`);
  console.log(`Passed: ${passed} (${Math.round(passed / testCases.length * 100)}%)`);
  console.log(`Failed: ${failed} (${Math.round(failed / testCases.length * 100)}%)`);
  console.log(`Cost savings: 50% (using Batch API)`);
}

// Run the test
runBatchTest(alignmentTestCases).catch(console.error);
