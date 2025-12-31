/**
 * Model Comparison Test
 *
 * Tests multiple OpenRouter models against the production API context,
 * then evaluates responses locally.
 *
 * Run with: npx tsx server/tests/model-comparison.ts
 */

import OpenAI from 'openai';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const PRODUCTION_API = 'https://open-council-production.up.railway.app/api/context';

if (!OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY in .env');
  process.exit(1);
}

// Models to test - ordered by expected cost (cheapest first)
const MODELS_TO_TEST = [
  { name: 'gemini-flash', id: 'google/gemini-flash-1.5', inputCost: 0.075, outputCost: 0.30 },
  { name: 'gpt-4o-mini', id: 'openai/gpt-4o-mini', inputCost: 0.15, outputCost: 0.60 },
  { name: 'llama-3.3-70b', id: 'meta-llama/llama-3.3-70b-instruct', inputCost: 0.30, outputCost: 0.30 },
  { name: 'qwen-72b', id: 'qwen/qwen-2.5-72b-instruct', inputCost: 0.33, outputCost: 0.39 },
  { name: 'claude-3.5-haiku', id: 'anthropic/claude-3.5-haiku', inputCost: 0.80, outputCost: 4.00 },
];

// Representative test cases
const TEST_CASES = [
  // Easy - vote lookups
  { id: 'easy-1', q: 'Did the Cooling By-law pass or fail?', expected: ['failed', 'fail', '7-8', '7 to 8'] },
  { id: 'easy-2', q: 'How did Mayor Morgan vote on the Cooling By-law?', expected: ['against', 'nay', 'no'], required: ['Morgan'] },

  // Medium - councillor stances
  { id: 'med-1', q: 'Is Shawn Lewis generally aligned with the Mayor?', expected: ['yes', 'aligned', 'votes with'], required: ['Lewis'] },
  { id: 'med-2', q: 'Who usually votes with the Mayor?', expected: ['Lewis', 'Hillier', 'Lehman', 'Cuddy'] },

  // Hard - patterns
  { id: 'hard-1', q: 'Compare voting patterns of Stevenson and Trosow', expected: ['disagree', 'opposite', 'different'], required: ['Stevenson', 'Trosow'] },
  { id: 'hard-2', q: 'What predicts how Van Meerbergen will vote?', expected: ['cost', 'fiscal', 'spending', 'bike'], required: ['Van Meerbergen'] },

  // Very hard
  { id: 'vhard-1', q: 'If Stevenson voted yes on the Cooling By-law, would it have passed?', expected: ['yes', 'would have passed', '8-7'], required: ['Stevenson'] },
];

interface TestResult {
  model: string;
  modelId: string;
  inputCost: number;
  outputCost: number;
  passed: number;
  failed: number;
  totalTime: number;
  avgTime: number;
  failures: string[];
}

// Get context from production API
async function getContextFromProduction(question: string): Promise<string> {
  const response = await fetch(PRODUCTION_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: question }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get context: ${response.status}`);
  }

  const data = await response.json();
  const results = data.results || [];

  return results.map((r: { text: string }, i: number) => `## Context ${i + 1}\n${r.text}`).join('\n\n');
}

// Build system prompt (simplified version)
function buildSystemPrompt(context: string): string {
  return `You are a helpful assistant that answers questions about London, Ontario City Council meetings.

Use ONLY the following context to answer questions. If the information isn't in the context, say so.

# Context from Council Records

${context}

# Instructions
- Be concise and factual
- Cite specific meetings, dates, and vote counts when available
- If asked about voting patterns, use the data provided`;
}

async function queryModel(
  openrouter: OpenAI,
  modelId: string,
  systemPrompt: string,
  question: string
): Promise<{ response: string; timeMs: number }> {
  const start = Date.now();

  const completion = await openrouter.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ],
    max_tokens: 2000,
    temperature: 0.4,
  });

  const timeMs = Date.now() - start;
  const response = completion.choices[0]?.message?.content || '';

  return { response, timeMs };
}

function checkAnswer(
  response: string,
  expected: string[],
  required?: string[]
): boolean {
  const lower = response.toLowerCase();

  if (required) {
    for (const req of required) {
      if (!lower.includes(req.toLowerCase())) return false;
    }
  }

  return expected.some(exp => lower.includes(exp.toLowerCase()));
}

async function testModel(
  openrouter: OpenAI,
  model: typeof MODELS_TO_TEST[0]
): Promise<TestResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${model.name} (${model.id})`);
  console.log(`Cost: $${model.inputCost}/MTok input, $${model.outputCost}/MTok output`);
  console.log('='.repeat(60));

  let passed = 0;
  let failed = 0;
  let totalTime = 0;
  const failures: string[] = [];

  for (const tc of TEST_CASES) {
    try {
      // Get context from production API
      const context = await getContextFromProduction(tc.q);
      const systemPrompt = buildSystemPrompt(context);

      const { response, timeMs } = await queryModel(openrouter, model.id, systemPrompt, tc.q);
      totalTime += timeMs;

      const isCorrect = checkAnswer(response, tc.expected, tc.required);

      if (isCorrect) {
        passed++;
        console.log(`  ✅ ${tc.id}: PASSED (${(timeMs/1000).toFixed(1)}s)`);
      } else {
        failed++;
        failures.push(tc.id);
        console.log(`  ❌ ${tc.id}: FAILED (${(timeMs/1000).toFixed(1)}s)`);
        console.log(`     Expected: ${tc.expected.join(' | ')}`);
        console.log(`     Response: ${response.substring(0, 150)}...`);
      }
    } catch (error) {
      failed++;
      failures.push(tc.id);
      const err = error as Error;
      console.log(`  ❌ ${tc.id}: ERROR - ${err.message}`);
    }
  }

  const avgTime = totalTime / TEST_CASES.length;
  console.log(`\n📊 ${model.name}: ${passed}/${TEST_CASES.length} passed (${Math.round(passed/TEST_CASES.length*100)}%) | Avg: ${(avgTime/1000).toFixed(1)}s`);

  return {
    model: model.name,
    modelId: model.id,
    inputCost: model.inputCost,
    outputCost: model.outputCost,
    passed,
    failed,
    totalTime,
    avgTime,
    failures
  };
}

async function main() {
  console.log('🚀 Model Comparison Test');
  console.log(`Testing ${MODELS_TO_TEST.length} models with ${TEST_CASES.length} questions`);
  console.log('Using production API for context retrieval\n');

  const openrouter = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  });

  const results: TestResult[] = [];

  for (const model of MODELS_TO_TEST) {
    try {
      const result = await testModel(openrouter, model);
      results.push(result);
    } catch (error) {
      const err = error as Error;
      console.log(`\n❌ ${model.name}: SKIPPED - ${err.message}`);
      results.push({
        model: model.name,
        modelId: model.id,
        inputCost: model.inputCost,
        outputCost: model.outputCost,
        passed: 0,
        failed: TEST_CASES.length,
        totalTime: 0,
        avgTime: 0,
        failures: ['ALL']
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📈 SUMMARY');
  console.log('='.repeat(70));
  console.log('\n| Model           | Accuracy | Avg Time | Input $/M | Output $/M | Failures |');
  console.log('|-----------------|----------|----------|-----------|------------|----------|');

  for (const r of results) {
    const accuracy = `${r.passed}/${TEST_CASES.length} (${Math.round(r.passed/TEST_CASES.length*100)}%)`;
    const avgTime = r.avgTime > 0 ? `${(r.avgTime/1000).toFixed(1)}s` : 'N/A';
    const failures = r.failures.length > 0 ? r.failures.slice(0, 2).join(', ') + (r.failures.length > 2 ? '...' : '') : '-';
    console.log(`| ${r.model.padEnd(15)} | ${accuracy.padEnd(8)} | ${avgTime.padEnd(8)} | $${r.inputCost.toFixed(2).padStart(6)} | $${r.outputCost.toFixed(2).padStart(8)} | ${failures.padEnd(8)} |`);
  }

  // Find best model with 100% accuracy
  const perfectModels = results.filter(r => r.passed === TEST_CASES.length);
  if (perfectModels.length > 0) {
    perfectModels.sort((a, b) => a.inputCost - b.inputCost);
    console.log(`\n🏆 Best 100% accurate model: ${perfectModels[0].model} ($${perfectModels[0].inputCost}/MTok input)`);
  } else {
    const bestAccuracy = Math.max(...results.map(r => r.passed));
    const bestModels = results.filter(r => r.passed === bestAccuracy);
    bestModels.sort((a, b) => a.inputCost - b.inputCost);
    console.log(`\n🏆 Best accuracy: ${bestModels[0].model} (${bestAccuracy}/${TEST_CASES.length})`);
  }

  // Cost comparison vs Claude Sonnet
  console.log('\n📊 Cost Comparison vs Claude Sonnet 4.5 ($3/$15 per MTok):');
  for (const r of results.filter(r => r.passed >= TEST_CASES.length - 1)) {
    const inputSavings = ((3 - r.inputCost) / 3 * 100).toFixed(0);
    const outputSavings = ((15 - r.outputCost) / 15 * 100).toFixed(0);
    console.log(`   ${r.model}: ${inputSavings}% input savings, ${outputSavings}% output savings`);
  }
}

main().catch(console.error);
