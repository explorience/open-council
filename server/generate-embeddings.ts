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

  // Check for --full flag
  const fullRegeneration = process.argv.includes('--full');
  const mode = fullRegeneration ? 'FULL REGENERATION' : 'INCREMENTAL UPDATE';
  console.log(`Mode: ${mode}\n`);

  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is required');
    console.error('Please create a .env file with your OpenAI API key:');
    console.error('  OPENAI_API_KEY=your-key-here\n');
    process.exit(1);
  }

  try {
    // Initialize vector store
    const vectorStore = new VectorStore();
    await vectorStore.initialize();

    // Initialize embedding generator
    const dataDir = resolve(process.cwd(), 'data');
    const generator = new EmbeddingGenerator(apiKey, dataDir);

    let chunks;

    if (fullRegeneration) {
      // Full regeneration mode - process all meetings
      console.log('📊 Step 1: Generating ALL embeddings (full regeneration)...\n');
      chunks = await generator.generateAll();
      console.log(`\n✅ Generated ${chunks.length} embeddings`);

      console.log('\n📊 Step 2: Replacing vector database...\n');
      await vectorStore.createTable(chunks);
    } else {
      // Incremental mode - only process new meetings
      console.log('📊 Step 1: Checking for new meetings...\n');
      const existingIds = await vectorStore.getExistingChunkIds();

      if (existingIds.size === 0) {
        console.log('⚠️  No existing embeddings found. Running FULL generation for first time...\n');
        chunks = await generator.generateAll();
        console.log(`\n✅ Generated ${chunks.length} embeddings`);
        console.log('\n📊 Step 2: Creating vector database...\n');
        await vectorStore.createTable(chunks);
      } else {
        console.log(`Found ${existingIds.size} existing embeddings`);

        // Buffer chunks and save every 10 batches to preserve progress if interrupted
        let pendingChunks: typeof chunks = [];
        let batchCount = 0;
        let savedCount = 0;

        chunks = await generator.generateIncremental(existingIds, async (batchChunks) => {
          pendingChunks.push(...batchChunks);
          batchCount++;

          // Save every 10 batches
          if (batchCount % 10 === 0) {
            await vectorStore.addChunks(pendingChunks);
            savedCount += pendingChunks.length;
            console.log(`  💾 Saved ${savedCount} chunks to database`);
            pendingChunks = [];
          }
        });

        // Save any remaining chunks
        if (pendingChunks.length > 0) {
          await vectorStore.addChunks(pendingChunks);
          savedCount += pendingChunks.length;
          console.log(`  💾 Saved ${savedCount} chunks to database`);
        }

        if (chunks.length > 0) {
          console.log(`\n✅ Generated and saved ${chunks.length} new embeddings`);
        }
      }
    }

    const stats = await vectorStore.getStats();
    console.log(`\n✅ Vector database now contains ${stats.count} total vectors`);

    console.log('\n🎉 Done! You can now start the chatbot server with:');
    console.log('   npm run chat:server\n');

    if (!fullRegeneration && chunks.length === 0) {
      console.log('💡 Tip: Use --full flag to regenerate all embeddings:\n');
      console.log('   npm run chat:generate -- --full\n');
    }
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
