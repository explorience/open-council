#!/usr/bin/env node

// CLI script to generate embeddings for all meeting data

import { config } from 'dotenv';
import { resolve } from 'path';
import { EmbeddingGenerator } from './embeddings.js';
import { VectorStore } from './vector-store.js';
import type { EmbeddingChunk } from './types.js';

// Load environment variables
config();

async function main() {
  console.log('🔮 London City Council - Embedding Generation\n');

  // Check for --full flag OR FORCE_REGENERATE env var
  const fullRegeneration = process.argv.includes('--full') || process.env.FORCE_REGENERATE === 'true';
  const mode = fullRegeneration ? 'FULL REGENERATION' : 'INCREMENTAL UPDATE';
  console.log(`Mode: ${mode}`);
  if (process.env.FORCE_REGENERATE === 'true') {
    console.log('(FORCE_REGENERATE=true detected in environment)');
  }
  console.log('');

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
      // Incremental mode - process new + content-changed chunks, prune orphans
      console.log('📊 Step 1: Checking for new and changed meetings...\n');
      const existingInfo = await vectorStore.getExistingChunkInfo();

      // First, load all meetings to see what SHOULD be in the database
      const allMeetings = await generator.loadMeetings();
      console.log(`📂 Data folder has ${allMeetings.length} meetings`);

      if (allMeetings.length > 0) {
        const dates = allMeetings.map(m => m.meeting.datetime).sort();
        console.log(`📅 Data date range: ${dates[0]} to ${dates[dates.length - 1]}`);
      }

      if (existingInfo.size === 0) {
        console.log('⚠️  No existing embeddings found. Running FULL generation for first time...\n');
        chunks = await generator.generateAll();
        console.log(`\n✅ Generated ${chunks.length} embeddings`);
        console.log('\n📊 Step 2: Creating vector database...\n');
        await vectorStore.createTable(chunks);
      } else {
        console.log(`Found ${existingInfo.size} existing embeddings in database`);

        // Buffer chunks and save every 10 batches to preserve progress if interrupted
        let pendingChunks: EmbeddingChunk[] = [];
        let batchCount = 0;
        let savedCount = 0;

        const result = await generator.generateIncremental(existingInfo, async (batchChunks) => {
          pendingChunks.push(...batchChunks);
          batchCount++;

          // Save every 10 batches (upsert: replaces matching ids, inserts new)
          if (batchCount % 10 === 0) {
            await vectorStore.addChunks(pendingChunks);
            savedCount += pendingChunks.length;
            console.log(`  💾 Saved ${savedCount} chunks to database`);
            pendingChunks = [];
          }
        });
        chunks = result.chunks;

        // Save any remaining chunks
        if (pendingChunks.length > 0) {
          await vectorStore.addChunks(pendingChunks);
          savedCount += pendingChunks.length;
          console.log(`  💾 Saved ${savedCount} chunks to database`);
        }

        // Delete orphans (chunks whose ids no longer appear for files still on disk)
        if (result.orphanIds.length > 0) {
          await vectorStore.deleteChunksByIds(result.orphanIds);
        }

        if (chunks.length > 0 || result.orphanIds.length > 0) {
          console.log(
            `\n✅ Synced: ${chunks.length} new/changed embeddings, ` +
            `${result.orphanIds.length} orphans removed`
          );
        } else {
          console.log(`\n✅ Database is up to date - no changes detected`);
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
