#!/usr/bin/env node

// CLI script to generate embeddings for all meeting data

import { config } from 'dotenv';
import { resolve } from 'path';
import { EmbeddingGenerator } from './embeddings.js';
import { VectorStore } from './vector-store.js';

// Load environment variables
config();

async function main() {
  console.log('🔮 London City Council - Embedding Generation\n');

  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is required');
    console.error('Please create a .env file with your OpenAI API key:');
    console.error('  OPENAI_API_KEY=your-key-here\n');
    process.exit(1);
  }

  try {
    // Initialize embedding generator
    const dataDir = resolve(process.cwd(), 'data');
    const generator = new EmbeddingGenerator(apiKey, dataDir);

    // Generate embeddings
    console.log('📊 Step 1: Generating embeddings...\n');
    const chunks = await generator.generateAll();

    console.log(`\n✅ Generated ${chunks.length} embeddings`);

    // Store in vector database
    console.log('\n📊 Step 2: Storing in vector database...\n');
    const vectorStore = new VectorStore();
    await vectorStore.initialize();
    await vectorStore.createTable(chunks);

    const stats = await vectorStore.getStats();
    console.log(`\n✅ Successfully stored ${stats.count} vectors in LanceDB`);

    console.log('\n🎉 Done! You can now start the chatbot server with:');
    console.log('   npm run chat:server\n');
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
