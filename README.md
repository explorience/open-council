# Open Council

**Make your city council's decisions searchable, accessible, and queryable with AI.**

Open Council scrapes publicly available city council meeting data, structures it into searchable formats, and provides an AI-powered chatbot so anyone can ask questions about what their council has discussed, voted on, and decided — from 2011 to present.

**Live site:** [opencouncil.xyz](https://opencouncil.xyz)

---

## For Citizens

Visit [opencouncil.xyz](https://opencouncil.xyz) to:

- **Search meetings** — Browse council and committee meetings from 2011 to today
- **Ask questions** — Use the AI chatbot to ask about any topic discussed in council (e.g. "What has council said about bike lanes?" or "How did my councillor vote on the budget?")
- **Track councillors** — See attendance records and voting history
- **Browse by topic** — Find what committees discussed on specific issues

No account needed. No paywall. Just public data made actually accessible.

**Found a problem?** Email [info@opencouncil.xyz](mailto:info@opencouncil.xyz) or [open an issue](https://github.com/explorience/open-council/issues).

---

## For Developers

### Tech Stack

| Component | Tech |
|-----------|------|
| Static site | [Quartz](https://quartz.jzhao.xyz/) (TypeScript/Preact) |
| Chatbot API | Express + LanceDB vector store |
| Embeddings | OpenAI text-embedding-3-small |
| LLM | Anthropic Claude (via OpenRouter) |
| Scraper | Python 3.12+ with BeautifulSoup |
| Data | JSON (structured) + Markdown (rendered) |

### Project Structure

```
open-council/
├── content/          # Markdown pages (generated from data)
│   ├── months/       # Meeting pages by month
│   ├── councillors/  # Councillor profile pages
│   ├── committees/   # Committee pages
│   └── years/        # Year summary pages
├── data/             # Structured JSON meeting data (2011–present)
│   ├── YYYY-MM/      # Meeting JSON files by month
│   ├── councillors/  # Councillor metadata
│   ├── votes/        # Individual voting records
│   └── stats/        # Aggregate statistics
├── scraping/         # Python scraper (eScribe → JSON)
├── server/           # Express API + RAG pipeline
│   ├── index.ts      # API server entry point
│   ├── rag-service.ts    # Retrieval + generation
│   ├── vector-store.ts   # LanceDB vector search
│   ├── embeddings.ts     # Embedding generation
│   └── analytics.ts      # Query analytics
├── quartz/           # Quartz static site framework (customized)
├── scripts/          # Page generation + transcript tools
└── transcripts/      # Full meeting transcripts (where available)
```

### Local Development

**Prerequisites:** Node.js >= 22, Python 3.12+, [uv](https://docs.astral.sh/uv/)

```bash
# Clone and install
git clone https://github.com/explorience/open-council.git
cd open-council
npm install
cd scraping && uv sync && cd ..

# Set up environment
cp .env.example .env
# Add your OPENAI_API_KEY and optionally ANTHROPIC_API_KEY

# Generate embeddings (first time only — takes a few minutes)
npm run chat:generate

# Start development
npm run chat:dev    # Terminal 1: chatbot API (port 3001)
npm run dev         # Terminal 2: static site (port 8080)
```

### Key Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Serve the site locally |
| `npm run build` | Build the static site |
| `npm run chat:generate` | Generate vector embeddings from meeting data |
| `npm run chat:dev` | Start chatbot API with hot reload |
| `npm run chat:server` | Start chatbot API (production) |
| `npm run generate:pages` | Regenerate markdown pages from JSON data |
| `npm run transcripts:full` | Sync transcripts and add to pages |
| `npm run check` | Run TypeScript + Prettier checks |
| `npm run format` | Auto-format code with Prettier |

### Votes Pipeline

The roll-call vote data (`data/votes/`, `data/stats/`, and the `## Votes`
sections in meeting pages) is derived data — each stage reads the output
of the one before it. Regenerating out of order, or skipping a stage,
leaves stale data downstream. Run in this order:

```bash
npx tsx scripts/generate-votes.ts      # scrape/parse -> data/votes/*.json
npx tsx scripts/generate-stats.ts      # data/votes -> data/stats/*.json (councillor/meeting rollups)
npx tsx scripts/generate-pages.ts      # data -> content/**/*.md (base meeting + councillor pages)
npx tsx scripts/add-votes-to-pages.ts  # inject/refresh the "## Votes" section on each meeting page
```

`add-votes-to-pages.ts` is idempotent — re-running it replaces an
existing `## Votes` section rather than duplicating or skipping it, so
it's safe to run again any time `data/votes` changes without redoing
the earlier stages.

### Scraping

The scraper pulls meeting data from London's [eScribe system](https://pub-london.escribemeetings.com/):

```bash
cd scraping

# Scrape recent meetings (last 6 months)
uv run main.py

# Scrape a specific meeting
uv run main.py 'Community and Protective Services Committee' '2025-05-20'
```

It detects which meetings have already been scraped by checking the `data/` folder, so it's safe to run repeatedly.

---

## For Other Cities

Open Council was built for London, Ontario, but the approach works for any city that publishes council minutes online. Here's how to adapt it for your city.

### Step 1: Understand the Architecture

The system has three independent layers:

1. **Scraper** → Pulls raw meeting data from your city's meeting system and outputs structured JSON
2. **Content generator** → Converts JSON into markdown pages for browsing
3. **Chatbot** → Indexes the data into a vector store for AI-powered Q&A

You can use any combination of these. The chatbot works on the JSON data, not the website.

### Step 2: Write Your Scraper

This is the main work. Every city publishes minutes differently.

**If your city uses eScribe** (many Canadian cities do): You can likely reuse or adapt the existing scraper in `scraping/` with minimal changes. Look at `scraping/main.py` and update the base URL and meeting type names.

**If your city uses a different system:** You'll need to write a new scraper that outputs JSON in the same format. See `data/` for examples of the expected structure. The key fields are:
- Meeting title, date, type, URL
- Agenda items with titles and content
- Attendance (present, absent, remote)
- Voting records (where available)

Common meeting platforms to look at:
- [eScribe](https://escribemeetings.com/) — Used by many Canadian municipalities
- [Legistar](https://www.granicus.com/solution/govmeetings/) — Common in US cities
- Custom municipal websites — You'll need to inspect the HTML

### Step 3: Generate Pages

Once you have JSON data in `data/`, update the page generation scripts in `scripts/` to reflect your city's council structure (ward names, committee names, councillor info).

```bash
npm run generate:pages
```

### Step 4: Set Up the Chatbot

The chatbot is city-agnostic — it indexes whatever meeting data exists in `data/`:

```bash
# Generate embeddings from your city's data
npm run chat:generate

# Start the API
npm run chat:server
```

Update `server/system-prompt.ts` to reference your city instead of London.

### Step 5: Customize the Site

- Update `content/about.md` with your city's info
- Update `quartz.config.ts` with your site title and domain
- Adjust any London-specific references in the Quartz layout

### Inspiration

Similar projects making government more accessible:
- [OttWatch](https://www.ottwatch.ca/) — Ottawa city council tracker
- [OpenParliament.ca](https://openparliament.ca/) — Canadian federal parliament

---

## Support

Open Council is a community project with over **600 hours** of volunteer work behind it.

- **Report issues:** [GitHub Issues](https://github.com/explorience/open-council/issues)
- **Email:** [info@opencouncil.xyz](mailto:info@opencouncil.xyz)
- **Support the project:** [Ko-fi](https://ko-fi.com/heenalr)

## License

This project is licensed under the [Peer Production License](./LICENSE) — a copyfarleft license that allows free use by individuals, cooperatives, and nonprofits, while requiring commercial entities to negotiate separate terms. See [LICENSE-FAQ.md](./LICENSE-FAQ.md) for details.
