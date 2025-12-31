# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Council is a full-stack application that scrapes London City Council meetings, formats them into markdown/JSON, and provides an AI-powered chatbot using RAG (Retrieval Augmented Generation) to answer questions about council meetings in natural language.

**Tech Stack:**
- Frontend/Static Site: Quartz 4 (TypeScript/Preact)
- Backend API: Node.js Express with RAG pipeline
- Data Scraping: Python with BeautifulSoup
- Vector Database: LanceDB
- LLM: Anthropic Claude (primary) / OpenAI GPT-4 (fallback)
- Embeddings: OpenAI text-embedding-3-small

## Commands

### Development
```bash
npm run dev              # Build and serve site with hot reload (port 8080)
npm run chat:dev         # Start Express API server with auto-reload (port 3001)
npm run chat:generate    # Generate embeddings (one-time or incremental)
```

### Build & Test
```bash
npm run build            # Build static site to public/
npm run check            # TypeScript type check + Prettier format check
npm run format           # Auto-format with Prettier
npm run test             # Run tests with tsx
```

### Scraping (in scraping/ directory)
```bash
uv run main.py                              # Scrape past 6 months
uv run main.py "Council" "2025-01-15"       # Specific meeting
uv run backfill.py                          # All historical data
uv run main.py TEST_ALL_MEETINGS 2024       # Test parsing for a year
```

## Architecture

### Data Flow
```
eScribe Website → Python Scraper → JSON + Markdown
                                   ↓
                    data/YYYY-MM/*.json + content/YYYY-MM/*.md
                                   ↓
                    Embeddings → LanceDB → RAG API → Chatbot
```

### Key Directories
- `quartz/components/` - React/Preact components (ChatBot.tsx is the AI chat UI)
- `server/` - Express backend: rag-service.ts (RAG pipeline), embeddings.ts, vector-store.ts
- `scraping/` - Python scraper: Meeting.py, MeetingItem.py, process_meeting.py
- `data/` - JSON meeting data organized by YYYY-MM/
- `content/` - Markdown meeting content for static site

### RAG API Endpoints
- `GET /health` - Health check
- `GET /api/stats` - Vector DB statistics
- `POST /api/chat` - Streaming chat responses (SSE)
- `POST /api/context` - Retrieve relevant chunks (debug)
- `POST /api/regenerate` - Add embeddings for new meetings

## Environment Variables
```
OPENAI_API_KEY=sk-...           # Required for embeddings
ANTHROPIC_API_KEY=sk-ant-...    # Recommended for chat
LLM_PROVIDER=anthropic          # "anthropic", "openai", or "openrouter"
PORT=3001                       # Chat API port

# Optional: OpenRouter for cheaper models
OPENROUTER_API_KEY=sk-or-...    # Required if LLM_PROVIDER=openrouter
OPENROUTER_MODEL=claude-3.5-haiku  # Options: claude-3-haiku, claude-3.5-haiku, gemini-flash, gemini-pro, gpt-4o-mini, llama-3.1-70b, llama-3.3-70b, mistral-large, qwen-72b
```

## Key Patterns

### Meeting Data Structure
Meetings are stored as JSON with: title, datetime (YYYY-MM-DD HH:MM:SS in London timezone), meeting_type, present/absent attendees, items (agenda), motions with votes, and bills.

### Embedding Chunks
Each chunk includes metadata: meeting_title, meeting_date, meeting_type, meeting_url, chunk_type (motion/content/bill/attendance), file_path.

### Dynamic TOP_K Strategy
RAG uses variable TOP_K based on query complexity: 10 (single meeting), 30 (specific topic), 80 (multiple meetings), 150 (comprehensive historical).

## Deployment
- **Static site**: Vercel (builds from main, outputs to public/)
- **API backend**: Railway (runs npm run chat:server, persists lancedb/)

## Development Notes
- Node.js >= 22, npm >= 10.9.2 required
- Run `npm run chat:generate` before `npm run chat:server` on first setup
- HTML structure varies across years (2011-2025); scraper uses heuristics
- 2016 meetings often fail due to eScribe server issues
- Use `elem.prettify()` for debugging HTML parsing in Python
