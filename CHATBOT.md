# 🤖 AI Chatbot - Intelligent Council Meeting Search

The Open Council project now includes an AI-powered chatbot that uses **Retrieval Augmented Generation (RAG)** to help you explore and understand London City Council meetings through natural conversations.

## ✨ Features

- **Semantic Search**: Ask questions in natural language and get relevant answers from council meeting data
- **RAG-Powered**: Retrieves relevant context from meetings before generating responses
- **Streaming Responses**: Real-time response generation for a smooth chat experience
- **Smart Chunking**: Meeting data is intelligently chunked by motions, votes, bills, and content
- **Source Citations**: Responses include references to specific meetings and dates
- **Multiple LLM Options**: Choose between OpenAI GPT-4 or Anthropic Claude

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Chat UI   │────▶│  Express API │────▶│  LLM (API)  │
│  (Preact)   │◀────│   (RAG)      │◀────│Claude/GPT-4 │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  LanceDB     │
                    │ (Vector DB)  │
                    └──────────────┘
                           ▲
                           │
                    ┌──────────────┐
                    │  Embeddings  │
                    │   (OpenAI)   │
                    └──────────────┘
```

## 🚀 Quick Start

### 1. Install Dependencies

Dependencies are already installed if you ran `npm install`.

### 2. Set Up Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
# Required for embeddings
OPENAI_API_KEY=sk-...

# Optional: For Claude-powered chat (recommended)
ANTHROPIC_API_KEY=sk-ant-...

# Choose your LLM provider (anthropic or openai)
LLM_PROVIDER=anthropic
```

**Getting API Keys:**
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/settings/keys

### 3. Generate Embeddings

This step processes all meeting JSON files and creates vector embeddings:

```bash
npm run chat:generate
```

This will:
1. Load all meeting data from `data/` directory
2. Create semantic chunks (motions, votes, bills, etc.)
3. Generate embeddings using OpenAI's `text-embedding-3-small` model
4. Store vectors in LanceDB (stored in `lancedb/` directory)

**Note**: This costs ~$0.50-1.00 for a few months of meetings. You only need to run this once, or when you add new meetings.

### 4. Start the Chat Server

```bash
npm run chat:server
```

The API will start on http://localhost:3001 with these endpoints:

- `GET /health` - Health check
- `GET /api/stats` - Vector database statistics
- `POST /api/context` - Get relevant context for a query (debug)
- `POST /api/chat` - Chat with streaming

### 5. Enable Chatbot in Quartz

Edit `quartz.config.ts` and add `Component.ChatBot()` to your page layout:

```typescript
import { Component } from "./quartz/components"

// In your layout configuration:
{
  right: [
    Component.Search(),
    Component.Darkmode(),
    Component.ChatBot({
      apiUrl: "http://localhost:3001" // Change in production
    }),
  ],
}
```

### 6. Start Quartz

```bash
npm run dev
```

Visit http://localhost:8080 and you'll see a chat icon in the bottom-right corner!

## 💬 Example Questions

Try asking the chatbot questions like:

- "What did council decide about zoning on January 21st?"
- "Show me all votes where councillors voted unanimously"
- "What bills were passed in January 2025?"
- "Who attended the Planning and Environment Committee meeting?"
- "What motions did Councillor Rahman propose?"
- "Tell me about housing policy discussions"
- "What happened at the most recent council meeting?"

## 🔧 Development

### Running in Development Mode

For auto-reload during development:

```bash
npm run chat:dev
```

### Re-generating Embeddings

If you scrape new meetings, re-run:

```bash
npm run chat:generate
```

This will overwrite the existing vector database.

### Debugging

To see what context is being retrieved for a query:

```bash
curl -X POST http://localhost:3001/api/context \
  -H "Content-Type: application/json" \
  -d '{"query": "What happened at the January 21st meeting?"}'
```

### Vector Database Stats

```bash
curl http://localhost:3001/api/stats
```

## 🎨 Customization

### Change Chat UI Appearance

Edit `quartz/components/styles/chatbot.scss` to customize colors, sizes, and animations.

### Modify System Prompt

Edit the `getSystemPrompt()` method in `server/rag-service.ts` to change how the AI responds.

### Adjust Retrieval Settings

In `server/rag-service.ts`:

```typescript
const TOP_K = 5; // Number of chunks to retrieve
```

### Change Embedding Model

In `server/embeddings.ts`:

```typescript
const EMBEDDING_MODEL = 'text-embedding-3-small'; // or 'text-embedding-3-large'
```

### Switch LLM Models

In `server/rag-service.ts`:

```typescript
// OpenAI
model: 'gpt-4o' // or 'gpt-4-turbo', 'gpt-3.5-turbo'

// Anthropic
model: 'claude-3-5-sonnet-20241022' // or 'claude-3-opus-20240229'
```

## 📊 How It Works

### 1. Data Chunking

Meeting data is split into semantic chunks:

- **Attendance**: Who was present, absent, or remote
- **Content**: General meeting content and proceedings
- **Motions**: Individual agenda items with motions and votes
- **Bills**: Legislation passed

### 2. Embedding Generation

Each chunk is converted to a 1536-dimensional vector using OpenAI's embedding model.

### 3. Semantic Search

When you ask a question:
1. Your question is converted to a vector
2. Similar chunks are found using vector similarity
3. Top 5 most relevant chunks are retrieved

### 4. RAG Response

The retrieved chunks are added as context to the LLM prompt, allowing it to answer based on actual meeting data.

### 5. Streaming

Responses are streamed token-by-token for a smooth experience.

## 💰 Cost Estimates

**One-time Embedding Generation:**
- ~$0.50-1.00 for a few months of meetings
- Uses OpenAI `text-embedding-3-small` ($0.02 per 1M tokens)

**Per Chat:**
- **OpenAI GPT-4o**: ~$0.01-0.03 per query
- **Anthropic Claude Sonnet**: ~$0.003-0.015 per query

**Recommendation**: Use Anthropic Claude for better quality and lower cost.

## 🔒 Privacy & Security

- All API keys should be stored in `.env` (not committed to git)
- The chatbot only accesses public council meeting data
- Chat history is stored client-side only
- No user data is logged or stored

## 📦 File Structure

```
open-council/
├── server/                      # Backend API
│   ├── index.ts                # Express server
│   ├── embeddings.ts           # Embedding generation
│   ├── vector-store.ts         # LanceDB wrapper
│   ├── rag-service.ts          # RAG pipeline
│   ├── types.ts                # TypeScript types
│   ├── generate-embeddings.ts  # CLI script
│   └── tsconfig.json           # TypeScript config
│
├── quartz/components/
│   ├── ChatBot.tsx             # Preact component
│   ├── scripts/chatbot.inline.ts  # Client-side JS
│   └── styles/chatbot.scss     # Styles
│
├── lancedb/                    # Vector database (gitignored)
├── .env                        # API keys (gitignored)
└── .env.example               # Template
```

## 🐛 Troubleshooting

### "Table not initialized" error

Run `npm run chat:generate` to create the vector database.

### "OPENAI_API_KEY not found"

Make sure you created a `.env` file with your API key.

### Chatbot not appearing

Make sure you added `Component.ChatBot()` to your `quartz.config.ts` layout.

### API connection errors

Ensure the chat server is running on port 3001:

```bash
npm run chat:server
```

### CORS errors

The server allows all origins by default. If you need to restrict, edit `server/index.ts`:

```typescript
app.use(cors({
  origin: 'https://yourdomain.com'
}))
```

## 🚀 Production Deployment

### Environment Variables

Set these in your hosting platform (Vercel, Netlify, etc.):

```env
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
LLM_PROVIDER=anthropic
PORT=3001
```

### API Deployment

The chat server (`server/`) needs to be deployed separately from the static Quartz site. Options:

1. **Railway.app** (easiest)
2. **Fly.io**
3. **DigitalOcean App Platform**
4. **AWS Lambda + API Gateway**

### Update API URL

In `quartz.config.ts`:

```typescript
Component.ChatBot({
  apiUrl: "https://your-chat-api.com"
})
```

### Pre-generate Embeddings

Run `npm run chat:generate` locally, then upload the `lancedb/` directory to your server.

## 🤝 Contributing

Ideas for improvements:

- [ ] Add citation links directly in responses
- [ ] Support for filtering by meeting type or date range
- [ ] Multi-language support
- [ ] Voice input
- [ ] Export chat transcripts
- [ ] Suggested follow-up questions
- [ ] Meeting summaries on demand

## 📝 License

MIT (same as parent project)

---

**Questions?** Open an issue or ask the chatbot itself! 😉
