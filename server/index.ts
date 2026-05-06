// Express server for RAG chatbot API

import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { resolve } from 'path';
import { VectorStore } from './vector-store.js';
import { RAGService, ChatMetadataCollector, OPENROUTER_MODELS, type OpenRouterModel, type LLMProvider } from './rag-service.js';
import { validateResponse, detectPromptInjection } from './response-validator.js';
import { logChatInteraction, generateSessionId, topKToComplexity, ChatLogEntry } from './chat-logger.js';
import { EmbeddingGenerator } from './embeddings.js';
import { logQuery, getCombinedTrending } from './analytics.js';
import type { ChatRequest } from './types.js';

// Load environment variables
config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

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
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const openrouterModel = process.env.OPENROUTER_MODEL as OpenRouterModel | undefined;
  const llmProvider = (process.env.LLM_PROVIDER || 'anthropic') as LLMProvider;

  // Validate provider configuration
  if (llmProvider === 'anthropic' && !anthropicKey) {
    console.warn('ANTHROPIC_API_KEY not set, falling back to OpenAI');
  }

  if (llmProvider === 'openrouter') {
    if (!openrouterKey) {
      throw new Error('OPENROUTER_API_KEY required when LLM_PROVIDER=openrouter');
    }
    if (openrouterModel && !(openrouterModel in OPENROUTER_MODELS)) {
      console.warn(`Unknown OPENROUTER_MODEL: ${openrouterModel}, using default`);
    }
  }

  // Initialize vector store
  vectorStore = new VectorStore();
  await vectorStore.initialize();

  // Initialize RAG service
  ragService = new RAGService(
    openaiKey,
    anthropicKey,
    vectorStore,
    llmProvider,
    openrouterKey,
    openrouterModel
  );

  console.log('Services initialized successfully');
  console.log('LLM Provider:', llmProvider);
  if (llmProvider === 'openrouter') {
    console.log('OpenRouter Model:', openrouterModel || 'claude-3.5-haiku (default)');
  }
  if (openrouterKey) {
    console.log('🔀 Smart routing enabled: simple → llama-3.3-70b, complex → claude-sonnet-4 (via OpenRouter)');
  }
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Get vector store stats
app.get('/api/stats', async (_req, res) => {
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
    const err = error as Error;
    console.error('Error retrieving context:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to retrieve context', debug: err.message });
  }
});

// Get trending topics based on query analytics
app.get('/api/trending', (_req, res) => {
  try {
    const trending = getCombinedTrending();
    res.json({
      topics: trending.combined,
      queryBased: trending.queryTrending,
      meetingBased: trending.meetingTopics,
    });
  } catch (error) {
    console.error('Error getting trending topics:', error);
    res.status(500).json({ error: 'Failed to get trending topics' });
  }
});

// Chat endpoint with streaming
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [], sessionId: clientSessionId } = req.body as ChatRequest & { sessionId?: string };

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Log query for analytics (non-blocking)
    try {
      logQuery(message);
    } catch (e) {
      // Don't fail the request if analytics fails
      console.error('Failed to log query:', e);
    }

    // Use client-provided session ID or generate one
    const sessionId = clientSessionId || generateSessionId();
    const startTime = Date.now();

    // Set up SSE headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // INPUT FILTER: Detect prompt injection attempts before calling the LLM
    const injectionResponse = detectPromptInjection(message);
    if (injectionResponse) {
      console.log(`🛡️ Prompt injection detected and blocked: "${message.substring(0, 80)}..."`);
      res.write(`data: ${JSON.stringify({ content: injectionResponse })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, sources: [], detectedTopics: [] })}\n\n`);
      res.end();
      return;
    }

    // Stream the response
    try {
      // Metadata collector for logging
      const metadataCollector: ChatMetadataCollector = {};
      let fullResponse = '';

      for await (const chunk of ragService.chat(message, history, metadataCollector)) {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      // Validate response before sending done signal
      const validation = validateResponse(fullResponse, metadataCollector.usedStructuredData || false);

      // OUTPUT FILTER: If system prompt was leaked, replace entire response
      if (validation.blockedResponse) {
        console.log(`🛡️ System prompt leak detected in response - blocking and replacing`);
        // We already streamed the leaked content unfortunately (SSE), but we can
        // send a clear replacement signal. The client should handle 'blocked' events.
        res.write(`data: ${JSON.stringify({ blocked: true, content: validation.blockedResponse })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true, sources: [], detectedTopics: [] })}\n\n`);
        res.end();
        return;
      }

      if (validation.disclaimer) {
        const disclaimerChunk = '\n\n---\n' + validation.disclaimer;
        fullResponse += disclaimerChunk;
        res.write(`data: ${JSON.stringify({ content: disclaimerChunk })}\n\n`);
      }

      // Send done signal with sources metadata
      res.write(`data: ${JSON.stringify({
        done: true,
        sources: metadataCollector.sources || [],
        detectedTopics: metadataCollector.detectedTopics || [],
      })}\n\n`);
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
      // Extract useful error details for debugging
      const err = error as Error & { status?: number; code?: string; type?: string };
      const errorMessage = err.message || 'Unknown error';
      const errorCode = err.code || err.type || '';
      const statusCode = err.status || 0;

      // Categorize the error for user-friendly messaging
      let userError = 'Error generating response';
      let errorCategory = 'unknown';

      if (errorMessage.includes('rate limit') || statusCode === 429) {
        userError = 'Rate limit exceeded. Please wait a moment and try again.';
        errorCategory = 'rate_limit';
      } else if (errorMessage.includes('insufficient') || errorMessage.includes('credit') || errorMessage.includes('quota')) {
        userError = 'API quota exceeded. Please try again later.';
        errorCategory = 'quota';
      } else if (errorMessage.includes('timeout') || errorCode === 'ETIMEDOUT' || errorCode === 'ESOCKETTIMEDOUT') {
        userError = 'Request timed out. Try a simpler question.';
        errorCategory = 'timeout';
      } else if (errorMessage.includes('context') || errorMessage.includes('too long') || errorMessage.includes('maximum')) {
        userError = 'Question too complex. Try breaking it into smaller parts.';
        errorCategory = 'context_length';
      } else if (statusCode === 401 || statusCode === 403 || errorMessage.includes('auth')) {
        userError = 'API authentication error. Please contact support.';
        errorCategory = 'auth';
      } else if (statusCode >= 500 || errorMessage.includes('unavailable')) {
        userError = 'AI service temporarily unavailable. Please try again.';
        errorCategory = 'service_unavailable';
      }

      // Detailed server logging - always include stack trace
      console.error('Error in chat stream:', {
        category: errorCategory,
        message: errorMessage,
        code: errorCode,
        status: statusCode,
        query: message.substring(0, 100),
        stack: err.stack,
        timestamp: new Date().toISOString(),
      });

      res.write(`data: ${JSON.stringify({
        error: userError,
        errorCategory,
        // Always include debug info - this is an API, not a public page
        debug: errorMessage,
      })}\n\n`);
      res.end();
    }
  } catch (error) {
    const err = error as Error;
    console.error('Error in chat endpoint:', {
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
    });
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

          // Get existing chunk info (id → text-hash + file_path) so we can
          // detect content changes, not just brand-new chunks.
          const existingInfo = await vectorStore.getExistingChunkInfo();
          console.log(`Found ${existingInfo.size} existing chunks`);

          // Generate embeddings for new + content-changed chunks
          const result = await generator.generateIncremental(existingInfo);

          if (result.chunks.length > 0) {
            await vectorStore.addChunks(result.chunks);
            console.log(`✅ Upserted ${result.chunks.length} embeddings`);
          }
          if (result.orphanIds.length > 0) {
            await vectorStore.deleteChunksByIds(result.orphanIds);
          }
          if (result.chunks.length === 0 && result.orphanIds.length === 0) {
            console.log('✅ No changes to process');
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

// Feedback form endpoint
app.post('/api/feedback', async (req, res) => {
  try {
    const { email, name, type, message } = req.body;

    // Validate required fields
    if (!email || !type || !message) {
      return res.status(400).json({ error: 'Email, type, and message are required' });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Rate limiting: max 5 submissions per IP per hour (simple in-memory)
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    if (!feedbackRateLimits.has(ip as string)) {
      feedbackRateLimits.set(ip as string, []);
    }
    const attempts = feedbackRateLimits.get(ip as string)!;
    const recentAttempts = attempts.filter(t => now - t < 3600000); // last hour
    feedbackRateLimits.set(ip as string, recentAttempts);

    if (recentAttempts.length >= 5) {
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    }
    recentAttempts.push(now);

    const feedback = {
      email,
      name: name || 'Anonymous',
      type,
      message,
      timestamp: new Date().toISOString(),
      ip: ip as string,
    };

    // Log to file
    const feedbackDir = './data/feedback';
    const fs = await import('fs/promises');
    await fs.mkdir(feedbackDir, { recursive: true });
    const feedbackFile = `${feedbackDir}/feedback.jsonl`;
    await fs.appendFile(feedbackFile, JSON.stringify(feedback) + '\n');

    console.log(`📝 Feedback received: [${type}] from ${email}`);

    // Send Discord webhook notification if configured
    const webhookUrl = process.env.FEEDBACK_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `**New Open Council Feedback**\n**Type:** ${type}\n**From:** ${name || 'Anonymous'} (${email})\n**Message:** ${message.slice(0, 1500)}`,
          }),
        });
      } catch (webhookErr) {
        console.error('Webhook notification failed:', webhookErr);
      }
    }

    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

const feedbackRateLimits = new Map<string, number[]>();

// Start server
async function start() {
  try {
    await initializeServices();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 RAG Chatbot API running on http://0.0.0.0:${PORT}`);
      console.log(`\nEndpoints:`);
      console.log(`  GET  /health          - Health check`);
      console.log(`  GET  /api/stats       - Vector store statistics`);
      console.log(`  GET  /api/trending    - Trending topics`);
      console.log(`  POST /api/context     - Get relevant context`);
      console.log(`  POST /api/chat        - Chat with streaming`);
      console.log(`  POST /api/regenerate  - Add embeddings for new meetings`);
      console.log(`  POST /api/feedback    - Submit feedback`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
