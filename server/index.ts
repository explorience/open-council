// Express server for RAG chatbot API

import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { VectorStore } from './vector-store.js';
import { RAGService } from './rag-service.js';
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
    res.json(stats);
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
    const { message, history = [] } = req.body as ChatRequest;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream the response
    try {
      for await (const chunk of ragService.chat(message, history)) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      // Send done signal
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
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

// Start server
async function start() {
  try {
    await initializeServices();

    app.listen(PORT, () => {
      console.log(`\n🚀 RAG Chatbot API running on http://localhost:${PORT}`);
      console.log(`\nEndpoints:`);
      console.log(`  GET  /health          - Health check`);
      console.log(`  GET  /api/stats       - Vector store statistics`);
      console.log(`  POST /api/context     - Get relevant context`);
      console.log(`  POST /api/chat        - Chat with streaming`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
