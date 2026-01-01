/**
 * Debug script to test failing OpenRouter models with long context
 */

import OpenAI from 'openai';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Models that failed in production
const MODELS_TO_TEST = [
  'mistralai/mistral-large-2411',
  'deepseek/deepseek-chat',
  'cohere/command-r-08-2024',
  'google/gemini-2.0-flash-001',
];

// Simulate long system prompt like our RAG service uses (~15K tokens)
const LONG_SYSTEM_PROMPT = `You are Open Council AI, an expert assistant for London, Ontario City Council meetings.

# Instructions
- Answer questions about council meetings, votes, and councillor positions
- Be factual and cite specific meetings when possible
- If information is not in the context, say so

# Context from Council Records

## Meeting: Council - October 14, 2025
The Adequate and Suitable Cooling By-law was discussed.
Motion: "That the following actions BE TAKEN with respect to the Adequate and Suitable Cooling By-law"
Vote Result: FAILED 7-8

Councillors who voted YEA (in favor):
- Councillor Trosow
- Councillor Lehman
- Councillor Peloza
- Councillor Franke
- Councillor Hopkins
- Councillor Stevely
- Councillor Ferreira

Councillors who voted NAY (against):
- Mayor Morgan
- Deputy Mayor Lewis
- Councillor Hillier
- Councillor Van Meerbergen
- Councillor Stevenson
- Councillor McAlister
- Councillor Cuddy
- Councillor Pribil

${Array(50).fill(`
## Additional Context ${Math.random()}
This is additional context to make the prompt longer. The council discussed various matters including zoning amendments, budget allocations, and infrastructure projects. Councillors debated the merits of different approaches to urban planning and fiscal responsibility.

The meeting included presentations from city staff on capital projects, development applications, and community initiatives. Various delegations spoke to council about their concerns and proposals.

Voting patterns showed typical alignments with progressive councillors like Trosow, Lehman, and Peloza often voting together on social issues, while fiscal conservatives like Stevenson and Van Meerbergen frequently dissented on spending measures.
`).join('\n')}
`;

const openrouter = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

async function testModel(modelId: string) {
  console.log(`\nTesting: ${modelId}`);
  console.log(`  System prompt length: ~${Math.round(LONG_SYSTEM_PROMPT.length / 4)} tokens`);

  try {
    const start = Date.now();
    const completion = await openrouter.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: LONG_SYSTEM_PROMPT },
        { role: 'user', content: 'Did the Cooling By-law pass or fail?' },
      ],
      max_tokens: 500,
      temperature: 0.4,
    });

    const elapsed = Date.now() - start;
    const response = completion.choices[0]?.message?.content || '';
    console.log(`  ✅ Response (${elapsed}ms): ${response.substring(0, 100)}...`);

    // Check if answer is correct
    const lower = response.toLowerCase();
    const correct = lower.includes('fail') || lower.includes('7-8') || lower.includes('7 to 8');
    console.log(`  ${correct ? '✅ CORRECT' : '❌ WRONG'}`);

    return { success: true, correct, elapsed };
  } catch (error) {
    const err = error as any;
    console.log(`  ❌ Error: ${err.message}`);
    if (err.error) {
      console.log(`     Details: ${JSON.stringify(err.error).substring(0, 200)}`);
    }
    return { success: false, correct: false, elapsed: 0 };
  }
}

async function main() {
  console.log('🔍 Testing Models with Long Context\n');

  const results: { model: string; success: boolean; correct: boolean; elapsed: number }[] = [];

  for (const model of MODELS_TO_TEST) {
    const result = await testModel(model);
    results.push({ model, ...result });
  }

  console.log('\n📊 Summary:');
  for (const r of results) {
    const status = !r.success ? '❌ ERROR' : r.correct ? '✅ CORRECT' : '⚠️ WRONG';
    console.log(`  ${r.model}: ${status} (${r.elapsed}ms)`);
  }
}

main().catch(console.error);
