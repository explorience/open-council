// Express server for RAG chatbot API

import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { resolve } from 'path';
import { VectorStore } from './vector-store.js';
import { RAGService, ChatMetadataCollector } from './rag-service.js';
import { logChatInteraction, generateSessionId, topKToComplexity, ChatLogEntry } from './chat-logger.js';
import { EmbeddingGenerator } from './embeddings.js';
import type { ChatRequest } from './types.js';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
let vectorStore: VectorStore;
let ragService: RAGService;
let isRegenerating = false;

async function initializeServices() {
  console.log('Initializing services...');

  // Check for required API keys
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const llmProvider = (process.env.LLM_PROVIDER || 'anthropic') as 'openai' | 'anthropic';

  if (llmProvider === 'anthropic' && !anthropicKey) {
    console.warn('ANTHROPIC_API_KEY not set, falling back to OpenAI');
  }

  // Initialize vector store
  vectorStore = new VectorStore();
  await vectorStore.initialize();

  // Initialize RAG service
  ragService = new RAGService(openaiKey, anthropicKey, vectorStore, llmProvider);

  console.log('Services initialized successfully');
  console.log('LLM Provider:', llmProvider);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Get vector store stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await vectorStore.getStats();
    res.json({
      totalChunks: stats.count,
      status: stats.count > 0 ? 'ready' : 'empty',
      isRegenerating
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get relevant context for a query (debugging endpoint)
app.post('/api/context', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const results = await ragService.getRelevantContext(query);
    res.json({ results });
  } catch (error) {
    console.error('Error retrieving context:', error);
    res.status(500).json({ error: 'Failed to retrieve context' });
  }
});

// Chat endpoint with streaming
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [], sessionId: clientSessionId } = req.body as ChatRequest & { sessionId?: string };

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Use client-provided session ID or generate one
    const sessionId = clientSessionId || generateSessionId();
    const startTime = Date.now();

    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream the response
    try {
      // Metadata collector for logging
      const metadataCollector: ChatMetadataCollector = {};
      let fullResponse = '';

      for await (const chunk of ragService.chat(message, history, metadataCollector)) {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      // Send done signal
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

      // Log the interaction after streaming completes
      const responseTimeMs = Date.now() - startTime;
      const logEntry: ChatLogEntry = {
        timestamp: new Date().toISOString(),
        sessionId,
        question: message,
        response: fullResponse,
        metadata: {
          responseTimeMs,
          llmProvider: metadataCollector.llmProvider || 'unknown',
          model: metadataCollector.model || 'unknown',
          queryComplexity: topKToComplexity(metadataCollector.topK || 10),
          topK: metadataCollector.topK || 0,
          contextChunksUsed: metadataCollector.contextChunksUsed || 0,
        },
      };
      logChatInteraction(logEntry);
    } catch (error) {
      console.error('Error in chat stream:', error);
      res.write(`data: ${JSON.stringify({ error: 'Error generating response' })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process chat request' });
    }
  }
});

// Trigger embedding regeneration (for when new meetings are added)
// Use ?full=true or set FORCE_REGENERATE=true env var to regenerate ALL embeddings
app.post('/api/regenerate', async (req, res) => {
  try {
    // Check if already regenerating
    if (isRegenerating) {
      return res.status(429).json({
        error: 'Regeneration already in progress',
        message: 'Please wait for the current regeneration to complete'
      });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    // Check for full regeneration mode
    const fullMode = req.query.full === 'true' || process.env.FORCE_REGENERATE === 'true';

    // Start regeneration in background
    isRegenerating = true;

    // Send immediate response
    res.json({
      status: 'started',
      mode: fullMode ? 'full' : 'incremental',
      message: fullMode
        ? 'FULL embedding regeneration started. This may take a while. Check /api/stats to monitor progress.'
        : 'Incremental embedding generation started. Check /api/stats to monitor progress.'
    });

    // Run regeneration in background
    (async () => {
      try {
        if (fullMode) {
          console.log('\n🔄 Starting FULL embedding regeneration...');
          console.log('⚠️  This will replace all existing embeddings.\n');

          const dataDir = resolve(process.cwd(), 'data');
          const generator = new EmbeddingGenerator(openaiKey, dataDir);

          const chunks = await generator.generateAll();
          console.log(`\n✅ Generated ${chunks.length} embeddings`);

          console.log('\n📊 Replacing vector database...\n');
          await vectorStore.createTable(chunks);

          const stats = await vectorStore.getStats();
          console.log(`📊 Total vectors in database: ${stats.count}\n`);
        } else {
          console.log('\n🔄 Starting incremental embedding generation...');

          const dataDir = resolve(process.cwd(), 'data');
          const generator = new EmbeddingGenerator(openaiKey, dataDir);

          // Get existing chunk IDs
          const existingIds = await vectorStore.getExistingChunkIds();
          console.log(`Found ${existingIds.size} existing chunks`);

          // Generate embeddings for new chunks only
          const newChunks = await generator.generateIncremental(existingIds);

          if (newChunks.length > 0) {
            // Add new chunks to vector store
            await vectorStore.addChunks(newChunks);
            console.log(`✅ Added ${newChunks.length} new embeddings to database`);
          } else {
            console.log('✅ No new meetings to process');
          }

          const stats = await vectorStore.getStats();
          console.log(`📊 Total vectors in database: ${stats.count}\n`);
        }
      } catch (error) {
        console.error('❌ Error during regeneration:', error);
      } finally {
        isRegenerating = false;
      }
    })();
  } catch (error) {
    console.error('Error starting regeneration:', error);
    isRegenerating = false;
    res.status(500).json({ error: 'Failed to start regeneration' });
  }
});

// Start server
async function start() {
  try {
    await initializeServices();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 RAG Chatbot API running on http://0.0.0.0:${PORT}`);
      console.log(`\nEndpoints:`);
      console.log(`  GET  /health          - Health check`);
      console.log(`  GET  /api/stats       - Vector store statistics`);
      console.log(`  POST /api/context     - Get relevant context`);
      console.log(`  POST /api/chat        - Chat with streaming`);
      console.log(`  POST /api/regenerate  - Add embeddings for new meetings`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
