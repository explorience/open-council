# RAG Chat Widget Transfer Guide for Quartz Sites

This guide explains how to add a RAG (Retrieval Augmented Generation) chat feature to any Quartz knowledge base. The system allows users to ask natural language questions about your content and get AI-powered answers with source citations.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Backend Setup](#step-1-backend-setup)
4. [Step 2: Frontend Chat Widget](#step-2-frontend-chat-widget)
5. [Step 3: Generate Embeddings](#step-3-generate-embeddings)
6. [Step 4: Railway Deployment](#step-4-railway-deployment)
7. [Step 5: Connect Frontend to Backend](#step-5-connect-frontend-to-backend)
8. [Customization Guide](#customization-guide)
9. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         YOUR QUARTZ SITE                        │
│                    (Vercel/Netlify/GitHub Pages)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Chat Widget (Preact component)                          │   │
│  │  - Floating button bottom-right                          │   │
│  │  - Message history                                       │   │
│  │  - Streaming responses                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS POST /api/chat
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RAILWAY BACKEND                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Express.js API Server (Port 3001)                       │   │
│  │  - /api/chat (streaming SSE responses)                   │   │
│  │  - /api/stats (health check)                             │   │
│  │  - /api/regenerate (update embeddings)                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────┐     │
│  │                    RAG Pipeline                        │     │
│  │  1. Generate query embedding (OpenAI)                  │     │
│  │  2. Search vector database (LanceDB)                   │     │
│  │  3. Retrieve relevant chunks                           │     │
│  │  4. Build context with metadata                        │     │
│  │  5. Send to LLM (Claude/GPT-4)                        │     │
│  │  6. Stream response back                               │     │
│  └───────────────────────────────────────────────────────┘     │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────┐     │
│  │              LanceDB (Embedded Vector DB)              │     │
│  │  - Stored in /app/lancedb (Railway volume)            │     │
│  │  - ~100-500MB depending on content size               │     │
│  └───────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

**Key Components:**
- **Frontend**: Preact chat widget that integrates into Quartz
- **Backend**: Express.js server with RAG pipeline
- **Vector Store**: LanceDB (embedded, no external database needed)
- **Embeddings**: OpenAI's text-embedding-3-small (cheap & effective)
- **LLM**: Anthropic Claude Sonnet (primary) or OpenAI GPT-4o (fallback)

---

## Prerequisites

Before starting, you need:

1. **API Keys**:
   - OpenAI API key (required for embeddings): https://platform.openai.com/api-keys
   - Anthropic API key (recommended for chat): https://console.anthropic.com/settings/keys

2. **Accounts**:
   - Railway account: https://railway.app (for backend hosting)
   - Vercel/Netlify account (if not already hosting Quartz)

3. **Your Quartz Site**:
   - A working Quartz knowledge base
   - Content in markdown files

4. **Local Development**:
   - Node.js 20+ installed
   - Git installed

---

## Step 1: Backend Setup

### 1.1 Create Server Directory Structure

In your Quartz project root, create a `server/` directory with these files:

```
your-quartz-project/
├── server/
│   ├── index.ts           # Express server
│   ├── rag-service.ts     # RAG pipeline
│   ├── vector-store.ts    # LanceDB wrapper
│   ├── embeddings.ts      # Embedding generation
│   ├── generate-embeddings.ts  # CLI script
│   ├── system-prompt.ts   # LLM instructions
│   ├── types.ts           # TypeScript types
│   └── tsconfig.json      # TypeScript config
├── lancedb/               # Vector database (gitignored)
├── .env                   # API keys (gitignored)
├── Dockerfile
├── railway.json
├── start.sh
└── ... (rest of Quartz)
```

### 1.2 Install Dependencies

Add these to your `package.json`:

```json
{
  "scripts": {
    "chat:generate": "npx tsx server/generate-embeddings.ts",
    "chat:server": "npx tsx server/index.ts",
    "chat:dev": "npx tsx watch server/index.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.68.0",
    "@lancedb/lancedb": "^0.22.3",
    "apache-arrow": "^15.0.2",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "express": "^5.1.0",
    "openai": "^4.76.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3"
  }
}
```

Run: `npm install --legacy-peer-deps`

### 1.3 Create TypeScript Types

**`server/types.ts`**:

```typescript
export interface ContentChunk {
  id: string;
  text: string;
  metadata: {
    title: string;
    url: string;
    section?: string;
    file_path: string;
  };
}

export interface VectorRecord {
  id: string;
  text: string;
  vector: number[];
  title: string;
  url: string;
  section: string;
  file_path: string;
}

export interface SearchResult {
  id: string;
  text: string;
  title: string;
  url: string;
  section: string;
  file_path: string;
  _distance?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
```

### 1.4 Create Vector Store

**`server/vector-store.ts`**:

```typescript
import * as lancedb from '@lancedb/lancedb';
import type { Table } from '@lancedb/lancedb';
import type { VectorRecord, SearchResult } from './types';

const DB_PATH = './lancedb';
const TABLE_NAME = 'knowledge_base';

let db: lancedb.Connection | null = null;
let table: Table | null = null;

export async function initVectorStore(): Promise<void> {
  if (!db) {
    db = await lancedb.connect(DB_PATH);
  }
}

export async function getOrCreateTable(): Promise<Table> {
  if (table) return table;

  await initVectorStore();

  const tables = await db!.tableNames();
  if (tables.includes(TABLE_NAME)) {
    table = await db!.openTable(TABLE_NAME);
  }

  return table!;
}

export async function createTableWithData(records: VectorRecord[]): Promise<Table> {
  await initVectorStore();

  // Drop existing table if it exists
  const tables = await db!.tableNames();
  if (tables.includes(TABLE_NAME)) {
    await db!.dropTable(TABLE_NAME);
  }

  table = await db!.createTable(TABLE_NAME, records);
  return table;
}

export async function addRecords(records: VectorRecord[]): Promise<void> {
  const t = await getOrCreateTable();
  if (t) {
    await t.add(records);
  }
}

export async function vectorSearch(
  embedding: number[],
  limit: number = 10
): Promise<SearchResult[]> {
  const t = await getOrCreateTable();
  if (!t) return [];

  const results = await t
    .vectorSearch(embedding)
    .limit(limit)
    .toArray();

  return results.map(r => ({
    id: r.id,
    text: r.text,
    title: r.title,
    url: r.url,
    section: r.section || '',
    file_path: r.file_path,
    _distance: r._distance
  }));
}

export async function getStats(): Promise<{ totalChunks: number; status: string }> {
  try {
    const t = await getOrCreateTable();
    if (!t) {
      return { totalChunks: 0, status: 'empty' };
    }
    const count = await t.countRows();
    return { totalChunks: count, status: 'ready' };
  } catch {
    return { totalChunks: 0, status: 'empty' };
  }
}

export async function getAllChunkIds(): Promise<Set<string>> {
  try {
    const t = await getOrCreateTable();
    if (!t) return new Set();

    const results = await t.query().select(['id']).toArray();
    return new Set(results.map(r => r.id));
  } catch {
    return new Set();
  }
}
```

### 1.5 Create Embeddings Generator

**`server/embeddings.ts`**:

```typescript
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import type { ContentChunk, VectorRecord } from './types';
import { createTableWithData, addRecords, getAllChunkIds } from './vector-store';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100;
const MAX_TOKENS_PER_BATCH = 8000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Estimate tokens (conservative)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// Generate embeddings for a batch of texts
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map(d => d.embedding);
}

// Parse your content files and create chunks
// CUSTOMIZE THIS FUNCTION FOR YOUR CONTENT STRUCTURE
export function parseContentFiles(contentDir: string): ContentChunk[] {
  const chunks: ContentChunk[] = [];

  function walkDir(dir: string) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        walkDir(filePath);
      } else if (file.endsWith('.md')) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const relativePath = path.relative(contentDir, filePath);

        // Extract title from frontmatter or filename
        const titleMatch = content.match(/^---\s*\n(?:.*\n)*?title:\s*["']?([^"'\n]+)["']?\s*\n/);
        const title = titleMatch ? titleMatch[1] : path.basename(file, '.md');

        // Convert file path to URL (adjust for your routing)
        const url = '/' + relativePath.replace(/\.md$/, '').replace(/\/index$/, '');

        // Split content into sections by headers
        const sections = content.split(/(?=^##?\s)/m);

        sections.forEach((section, index) => {
          const sectionTitle = section.match(/^##?\s+(.+)$/m)?.[1] || 'Introduction';
          const cleanText = section
            .replace(/^---[\s\S]*?---\n/, '') // Remove frontmatter
            .replace(/^##?\s+.+$/m, '')       // Remove header
            .trim();

          if (cleanText.length > 50) { // Skip very short sections
            chunks.push({
              id: `${relativePath}-section-${index}`,
              text: cleanText.slice(0, 8000), // Limit chunk size
              metadata: {
                title,
                url,
                section: sectionTitle,
                file_path: relativePath
              }
            });
          }
        });
      }
    }
  }

  walkDir(contentDir);
  return chunks;
}

// Main embedding generation function
export async function generateAllEmbeddings(
  contentDir: string,
  fullRegenerate: boolean = false
): Promise<void> {
  console.log('Parsing content files...');
  const chunks = parseContentFiles(contentDir);
  console.log(`Found ${chunks.length} chunks`);

  // Check which chunks already exist
  let existingIds = new Set<string>();
  if (!fullRegenerate) {
    existingIds = await getAllChunkIds();
    console.log(`Found ${existingIds.size} existing chunks in database`);
  }

  // Filter to new chunks only
  const newChunks = chunks.filter(c => !existingIds.has(c.id));
  console.log(`Processing ${newChunks.length} new chunks`);

  if (newChunks.length === 0) {
    console.log('No new chunks to process');
    return;
  }

  // Process in batches
  const records: VectorRecord[] = [];
  let batch: ContentChunk[] = [];
  let batchTokens = 0;

  for (const chunk of newChunks) {
    const tokens = estimateTokens(chunk.text);

    if (batch.length >= BATCH_SIZE || batchTokens + tokens > MAX_TOKENS_PER_BATCH) {
      // Process current batch
      if (batch.length > 0) {
        console.log(`Processing batch of ${batch.length} chunks...`);
        const embeddings = await generateEmbeddings(batch.map(c => c.text));

        for (let i = 0; i < batch.length; i++) {
          records.push({
            id: batch[i].id,
            text: batch[i].text,
            vector: embeddings[i],
            title: batch[i].metadata.title,
            url: batch[i].metadata.url,
            section: batch[i].metadata.section || '',
            file_path: batch[i].metadata.file_path
          });
        }

        // Save incrementally every 10 chunks
        if (records.length >= 10) {
          if (fullRegenerate && records.length === batch.length) {
            await createTableWithData(records);
          } else {
            await addRecords(records);
          }
          records.length = 0; // Clear after saving
        }
      }

      batch = [];
      batchTokens = 0;
    }

    batch.push(chunk);
    batchTokens += tokens;
  }

  // Process remaining batch
  if (batch.length > 0) {
    console.log(`Processing final batch of ${batch.length} chunks...`);
    const embeddings = await generateEmbeddings(batch.map(c => c.text));

    for (let i = 0; i < batch.length; i++) {
      records.push({
        id: batch[i].id,
        text: batch[i].text,
        vector: embeddings[i],
        title: batch[i].metadata.title,
        url: batch[i].metadata.url,
        section: batch[i].metadata.section || '',
        file_path: batch[i].metadata.file_path
      });
    }
  }

  // Save any remaining records
  if (records.length > 0) {
    if (fullRegenerate && existingIds.size === 0) {
      await createTableWithData(records);
    } else {
      await addRecords(records);
    }
  }

  console.log('Embedding generation complete!');
}
```

### 1.6 Create CLI Script

**`server/generate-embeddings.ts`**:

```typescript
import 'dotenv/config';
import { generateAllEmbeddings } from './embeddings';

const CONTENT_DIR = './content'; // Adjust to your content directory

async function main() {
  const fullRegenerate = process.argv.includes('--full');

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log(`Mode: ${fullRegenerate ? 'Full regeneration' : 'Incremental update'}`);
  console.log(`Content directory: ${CONTENT_DIR}`);

  await generateAllEmbeddings(CONTENT_DIR, fullRegenerate);
}

main().catch(console.error);
```

### 1.7 Create System Prompt

**`server/system-prompt.ts`**:

```typescript
export function getSystemPrompt(siteName: string, siteDescription: string): string {
  return `You are a helpful assistant for ${siteName}. ${siteDescription}

You answer questions based on the provided context from the knowledge base.

IMPORTANT GUIDELINES:
1. Only answer based on the provided context. If the context doesn't contain relevant information, say so clearly.
2. Cite your sources using markdown links: [Page Title](/path/to/page)
3. Be concise but thorough. Provide actionable information when possible.
4. If the question is ambiguous, ask for clarification.
5. Format your responses using markdown for readability (headers, lists, code blocks as appropriate).

RESPONSE FORMAT:
- Start with a direct answer to the question
- Provide supporting details from the context
- Include relevant source links
- End with related topics if applicable`;
}
```

### 1.8 Create RAG Service

**`server/rag-service.ts`**:

```typescript
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { vectorSearch, getStats } from './vector-store';
import { getSystemPrompt } from './system-prompt';
import type { ChatMessage, SearchResult } from './types';

const TOP_K = 15; // Number of chunks to retrieve

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// Generate embedding for the query
async function getQueryEmbedding(query: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  return response.data[0].embedding;
}

// Build context from search results
function buildContext(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No relevant content found in the knowledge base.';
  }

  return results.map((r, i) => {
    return `--- Source ${i + 1}: ${r.title} (${r.section}) ---
URL: ${r.url}
Content:
${r.text}
---`;
  }).join('\n\n');
}

// Main chat function with streaming
export async function* chat(
  message: string,
  history: ChatMessage[],
  siteName: string = 'Knowledge Base',
  siteDescription: string = ''
): AsyncGenerator<string> {
  // 1. Generate query embedding
  const embedding = await getQueryEmbedding(message);

  // 2. Search vector store
  const results = await vectorSearch(embedding, TOP_K);

  // 3. Build context
  const context = buildContext(results);

  // 4. Prepare messages
  const systemPrompt = getSystemPrompt(siteName, siteDescription);
  const userMessage = `Context from knowledge base:
${context}

User question: ${message}`;

  // 5. Stream response from LLM
  if (anthropic && process.env.LLM_PROVIDER !== 'openai') {
    // Use Claude
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        ...history.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        })),
        { role: 'user' as const, content: userMessage }
      ]
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  } else {
    // Use OpenAI
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4000,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        })),
        { role: 'user', content: userMessage }
      ]
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}

export { getStats };
```

### 1.9 Create Express Server

**`server/index.ts`**:

```typescript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chat, getStats } from './rag-service';
import { generateAllEmbeddings } from './embeddings';

const app = express();
const PORT = process.env.PORT || 3001;

// CUSTOMIZE THESE FOR YOUR SITE
const SITE_NAME = 'My Knowledge Base';
const SITE_DESCRIPTION = 'A comprehensive knowledge base about [your topic].';
const CONTENT_DIR = './content';

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
  const stats = await getStats();
  res.json(stats);
});

// Chat endpoint with streaming
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const chunk of chat(message, history, SITE_NAME, SITE_DESCRIPTION)) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (error) {
    console.error('Chat error:', error);
    res.write(`data: ${JSON.stringify({ error: 'An error occurred' })}\n\n`);
  }

  res.end();
});

// Regenerate embeddings endpoint
let isRegenerating = false;
app.post('/api/regenerate', async (req, res) => {
  if (isRegenerating) {
    return res.json({ status: 'already_running', message: 'Regeneration already in progress' });
  }

  isRegenerating = true;
  res.json({ status: 'started', message: 'Embedding regeneration started' });

  try {
    await generateAllEmbeddings(CONTENT_DIR, false);
  } catch (error) {
    console.error('Regeneration error:', error);
  } finally {
    isRegenerating = false;
  }
});

// Validate environment
if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is required');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('WARNING: ANTHROPIC_API_KEY not set, using OpenAI for chat');
}

app.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
```

### 1.10 Create Server TypeScript Config

**`server/tsconfig.json`**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["./**/*.ts"]
}
```

---

## Step 2: Frontend Chat Widget

### 2.1 Create Chat Component

**`quartz/components/ChatBot.tsx`**:

```tsx
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

interface ChatBotOptions {
  title?: string
  placeholder?: string
  apiUrl?: string
}

const defaultOptions: ChatBotOptions = {
  title: "Ask a Question",
  placeholder: "Type your question...",
  apiUrl: "http://localhost:3001"
}

export default ((userOpts?: Partial<ChatBotOptions>) => {
  const opts = { ...defaultOptions, ...userOpts }

  const ChatBot: QuartzComponent = (props: QuartzComponentProps) => {
    return (
      <div id="chatbot-container" data-api-url={opts.apiUrl}>
        {/* Toggle Button */}
        <button id="chatbot-toggle" aria-label="Open chat">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>

        {/* Chat Window */}
        <div id="chatbot-window" class="hidden">
          <div id="chatbot-header">
            <span id="chatbot-title">{opts.title}</span>
            <div id="chatbot-header-buttons">
              <button id="chatbot-maximize" aria-label="Maximize">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <polyline points="9 21 3 21 3 15"></polyline>
                  <line x1="21" y1="3" x2="14" y2="10"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>
              </button>
              <button id="chatbot-close" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          <div id="chatbot-messages">
            <div class="chatbot-message assistant">
              <div class="message-content">
                Hi! I can help you find information in this knowledge base. What would you like to know?
              </div>
            </div>
          </div>

          <div id="chatbot-input-area">
            <textarea
              id="chatbot-input"
              placeholder={opts.placeholder}
              rows={1}
            ></textarea>
            <button id="chatbot-send" aria-label="Send message">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  ChatBot.afterDOMLoaded = `
    const container = document.getElementById('chatbot-container');
    const toggle = document.getElementById('chatbot-toggle');
    const window = document.getElementById('chatbot-window');
    const closeBtn = document.getElementById('chatbot-close');
    const maximizeBtn = document.getElementById('chatbot-maximize');
    const input = document.getElementById('chatbot-input');
    const sendBtn = document.getElementById('chatbot-send');
    const messages = document.getElementById('chatbot-messages');
    const apiUrl = container?.dataset.apiUrl || 'http://localhost:3001';

    let history = [];
    let isMaximized = localStorage.getItem('chatbot-maximized') === 'true';

    // Initialize maximized state
    if (isMaximized && window) {
      window.classList.add('maximized');
    }

    // Toggle chat window
    toggle?.addEventListener('click', () => {
      window?.classList.toggle('hidden');
      toggle?.classList.toggle('hidden');
      if (!window?.classList.contains('hidden')) {
        input?.focus();
      }
    });

    // Close chat
    closeBtn?.addEventListener('click', () => {
      if (isMaximized) {
        isMaximized = false;
        window?.classList.remove('maximized');
        localStorage.setItem('chatbot-maximized', 'false');
      } else {
        window?.classList.add('hidden');
        toggle?.classList.remove('hidden');
      }
    });

    // Maximize/minimize
    maximizeBtn?.addEventListener('click', () => {
      isMaximized = !isMaximized;
      window?.classList.toggle('maximized');
      localStorage.setItem('chatbot-maximized', String(isMaximized));
    });

    // Auto-resize textarea
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    });

    // Send message
    async function sendMessage() {
      const text = input?.value?.trim();
      if (!text) return;

      // Add user message
      addMessage(text, 'user');
      input.value = '';
      input.style.height = 'auto';

      // Add to history
      history.push({ role: 'user', content: text });

      // Create assistant message placeholder
      const assistantDiv = document.createElement('div');
      assistantDiv.className = 'chatbot-message assistant';
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = 'Thinking...';
      assistantDiv.appendChild(contentDiv);
      messages?.appendChild(assistantDiv);
      messages.scrollTop = messages.scrollHeight;

      try {
        const response = await fetch(apiUrl + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: history.slice(-10) })
        });

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  fullResponse += data.content;
                  contentDiv.innerHTML = formatMarkdown(fullResponse);
                  messages.scrollTop = messages.scrollHeight;
                }
              } catch {}
            }
          }
        }

        // Add to history
        history.push({ role: 'assistant', content: fullResponse });

      } catch (error) {
        contentDiv.textContent = 'Sorry, an error occurred. Please try again.';
      }
    }

    function addMessage(text, role) {
      const div = document.createElement('div');
      div.className = 'chatbot-message ' + role;
      const content = document.createElement('div');
      content.className = 'message-content';
      content.innerHTML = formatMarkdown(text);
      div.appendChild(content);
      messages?.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function formatMarkdown(text) {
      return text
        .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
        .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\n/g, '<br>');
    }

    sendBtn?.addEventListener('click', sendMessage);

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
      if (e.key === 'Escape') {
        closeBtn?.click();
      }
    });
  `

  ChatBot.css = \`
    #chatbot-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 1000;
      font-family: var(--bodyFont);
    }

    #chatbot-toggle {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--secondary);
      color: var(--light);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: transform 0.2s, background 0.2s;
    }

    #chatbot-toggle:hover {
      transform: scale(1.05);
      background: var(--tertiary);
    }

    #chatbot-toggle.hidden {
      display: none;
    }

    #chatbot-window {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 400px;
      height: 500px;
      background: var(--light);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: slideIn 0.3s ease;
    }

    #chatbot-window.hidden {
      display: none;
    }

    #chatbot-window.maximized {
      width: 95vw;
      height: 95vh;
      bottom: 2.5vh;
      right: 2.5vw;
      border-radius: 16px;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    #chatbot-header {
      background: var(--secondary);
      color: var(--light);
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    #chatbot-title {
      font-weight: 600;
      font-size: 0.95rem;
    }

    #chatbot-header-buttons {
      display: flex;
      gap: 8px;
    }

    #chatbot-header-buttons button {
      background: transparent;
      border: none;
      color: var(--light);
      cursor: pointer;
      padding: 4px;
      opacity: 0.8;
      transition: opacity 0.2s;
    }

    #chatbot-header-buttons button:hover {
      opacity: 1;
    }

    #chatbot-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chatbot-message {
      max-width: 85%;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .chatbot-message.user {
      align-self: flex-end;
    }

    .chatbot-message.assistant {
      align-self: flex-start;
    }

    .message-content {
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .chatbot-message.user .message-content {
      background: var(--secondary);
      color: var(--light);
      border-bottom-right-radius: 4px;
    }

    .chatbot-message.assistant .message-content {
      background: var(--lightgray);
      color: var(--darkgray);
      border-bottom-left-radius: 4px;
    }

    .message-content a {
      color: var(--secondary);
      text-decoration: underline;
    }

    .message-content code {
      background: rgba(0,0,0,0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
    }

    #chatbot-input-area {
      padding: 12px;
      border-top: 1px solid var(--lightgray);
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    #chatbot-input {
      flex: 1;
      border: 1px solid var(--lightgray);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 0.9rem;
      resize: none;
      max-height: 150px;
      font-family: inherit;
    }

    #chatbot-input:focus {
      outline: none;
      border-color: var(--secondary);
    }

    #chatbot-send {
      background: var(--secondary);
      color: var(--light);
      border: none;
      border-radius: 8px;
      width: 40px;
      height: 40px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }

    #chatbot-send:hover {
      background: var(--tertiary);
    }

    @media (max-width: 480px) {
      #chatbot-window {
        width: calc(100vw - 40px);
        height: calc(100vh - 100px);
        bottom: 80px;
      }
    }
  \`

  return ChatBot
}) satisfies QuartzComponentConstructor
```

### 2.2 Register the Component

Add to `quartz/components/index.ts`:

```typescript
export { default as ChatBot } from "./ChatBot"
```

### 2.3 Add to Layout

In `quartz.layout.ts`, add to the `afterBody` section:

```typescript
import { ChatBot } from "./quartz/components"

// ... in your layout config
afterBody: [
  // ... other components
  Component.ChatBot({
    title: "Ask About This Site",
    placeholder: "Type your question...",
    apiUrl: "https://your-app.up.railway.app" // Your Railway URL
  }),
],
```

---

## Step 3: Generate Embeddings

### 3.1 Create Environment File

Create `.env` in project root:

```env
OPENAI_API_KEY=sk-proj-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
LLM_PROVIDER=anthropic
PORT=3001
```

### 3.2 Add to .gitignore

```
.env
lancedb/
```

### 3.3 Customize Content Parsing

Edit `server/embeddings.ts` to match your content structure:

```typescript
// Key function to customize: parseContentFiles()
// Adjust the directory, file patterns, and chunking logic
// to match how your Quartz content is organized
```

### 3.4 Generate Embeddings

```bash
# First time - full generation
npm run chat:generate -- --full

# After adding new content - incremental
npm run chat:generate
```

### 3.5 Test Locally

```bash
# Terminal 1: Start chat server
npm run chat:server

# Terminal 2: Build and serve Quartz
npm run build && npm run serve
```

Visit http://localhost:8080 and click the chat button!

---

## Step 4: Railway Deployment

### 4.1 Create Dockerfile

**`Dockerfile`**:

```dockerfile
FROM node:22-slim

WORKDIR /usr/src/app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Make start script executable
RUN chmod +x start.sh

# Expose port
EXPOSE 3001

# Start the app
CMD ["./start.sh"]
```

### 4.2 Create Railway Config

**`railway.json`**:

```json
{
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### 4.3 Create Start Script

**`start.sh`**:

```bash
#!/bin/sh
set -e

echo "Starting Knowledge Base Chat..."
echo ""
echo "Step 1: Checking for new embeddings..."
npm run chat:generate
echo ""
echo "Step 2: Starting chat server..."
exec npm run chat:server
```

### 4.4 Deploy to Railway

1. **Create Railway Project**:
   - Go to https://railway.app
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository

2. **Add Environment Variables**:
   - In Railway dashboard, go to your service
   - Click "Variables"
   - Add:
     - `OPENAI_API_KEY` = your key
     - `ANTHROPIC_API_KEY` = your key
     - `LLM_PROVIDER` = `anthropic`
     - `PORT` = `3001`

3. **Add Persistent Volume**:
   - In Railway dashboard, click "New" → "Volume"
   - Mount path: `/usr/src/app/lancedb`
   - This persists your embeddings across deployments

4. **Configure Networking**:
   - Click on your service → "Settings" → "Networking"
   - Click "Generate Domain" to get a public URL
   - Copy the URL (e.g., `https://your-app.up.railway.app`)

5. **Deploy**:
   - Railway auto-deploys on git push
   - Check "Deployments" tab for build logs

### 4.5 Update Frontend API URL

Update `quartz.layout.ts` with your Railway URL:

```typescript
Component.ChatBot({
  title: "Ask About This Site",
  placeholder: "Type your question...",
  apiUrl: "https://your-app.up.railway.app"
}),
```

---

## Step 5: Connect Frontend to Backend

### 5.1 Redeploy Quartz

After updating the API URL:

```bash
npm run build
git add .
git commit -m "Add chat widget with production API"
git push
```

### 5.2 Test the Integration

1. Visit your deployed Quartz site
2. Click the chat button (bottom-right)
3. Ask a question about your content
4. Verify you get relevant answers with source links

### 5.3 Monitor Health

Check your backend is running:

```bash
curl https://your-app.up.railway.app/health
# Should return: {"status":"ok"}

curl https://your-app.up.railway.app/api/stats
# Should return: {"totalChunks":123,"status":"ready"}
```

---

## Customization Guide

### Change Colors

Edit the CSS variables in `ChatBot.tsx`:

```css
/* Use your Quartz theme variables */
background: var(--secondary);  /* Button and header */
background: var(--tertiary);   /* Hover states */
background: var(--light);      /* Window background */
background: var(--lightgray);  /* Assistant messages */
```

### Change LLM Model

Edit `server/rag-service.ts`:

```typescript
// For Claude
model: 'claude-sonnet-4-5-20250929'  // Current latest
model: 'claude-3-5-haiku-20241022'   // Faster, cheaper

// For OpenAI
model: 'gpt-4o'        // Best quality
model: 'gpt-4o-mini'   // Faster, cheaper
```

### Adjust Retrieval

Edit `server/rag-service.ts`:

```typescript
const TOP_K = 15;  // Increase for more context, decrease for speed
```

### Customize System Prompt

Edit `server/system-prompt.ts` to add:
- Domain-specific instructions
- Response formatting guidelines
- Citation requirements
- Topic-specific knowledge

---

## Troubleshooting

### Chat not connecting

1. Check CORS is enabled on backend
2. Verify API URL is correct (https, not http)
3. Check Railway logs for errors
4. Test with: `curl https://your-app.up.railway.app/health`

### No search results

1. Verify embeddings were generated: `/api/stats` should show chunks
2. Check content directory path in `embeddings.ts`
3. Run `npm run chat:generate -- --full` to regenerate

### Slow responses

1. Reduce TOP_K in `rag-service.ts`
2. Use faster model (gpt-4o-mini or claude-haiku)
3. Check Railway resources (upgrade if needed)

### Embeddings not persisting

1. Ensure Railway volume is mounted at `/usr/src/app/lancedb`
2. Check volume is attached in Railway dashboard

### TypeScript errors

1. Run `npm install --legacy-peer-deps`
2. Check all files use correct imports
3. Verify `server/tsconfig.json` exists

---

## Cost Estimates

### OpenAI Embeddings
- Model: text-embedding-3-small
- Cost: ~$0.02 per 1M tokens
- Typical site (100-500 pages): $1-5 one-time

### LLM Chat (per 1000 questions)
- Claude Sonnet: ~$15-30
- GPT-4o: ~$25-50
- GPT-4o-mini: ~$1-3
- Claude Haiku: ~$1-3

### Railway Hosting
- Starter: $5/month (512MB RAM)
- Hobby: $20/month (8GB RAM)
- Volume storage: $0.25/GB/month

---

## Summary

You now have:

1. **Backend API** (`server/`) - RAG pipeline with vector search
2. **Frontend Widget** (`ChatBot.tsx`) - Floating chat interface
3. **Deployment** - Railway backend + Quartz frontend
4. **Embeddings** - Searchable vector database of your content

The system will:
- Answer questions about your content
- Cite sources with links to pages
- Stream responses in real-time
- Persist embeddings across deployments
- Update incrementally when you add content

Happy chatting!
