# Contributing to Open Council

Thank you for your interest in contributing to Open Council! This project aims to make London City Council meetings more accessible and searchable for citizens.

## Ways to Contribute

### Testing & Feedback
- Try the chatbot at [opencouncil.xyz](https://opencouncil.xyz) and report inaccurate or unhelpful responses
- Test on different devices and report UI/UX issues
- Suggest features that would help civic engagement

### Code Contributions
- Fix bugs or improve existing features
- Add new features from the issue tracker
- Improve documentation

### Data Quality
- Report missing or incorrectly parsed meetings
- Help verify voting record accuracy
- Identify edge cases in meeting minutes parsing

## Development Setup

### Prerequisites
- Node.js >= 22
- npm >= 10.9.2
- Python 3.x with `uv` package manager
- OpenAI API key (for embeddings)
- Anthropic API key (optional, for chat)

### Getting Started

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   npm install
   cd scraping && uv sync
   ```
3. Copy environment file and add your API keys:
   ```bash
   cp .env.example .env
   ```
4. Generate embeddings (first time only):
   ```bash
   npm run chat:generate
   ```
5. Start development servers:
   ```bash
   # Terminal 1: API server
   npm run chat:dev

   # Terminal 2: Static site
   npm run dev
   ```

## Project Structure

- `quartz/` - Static site generator (TypeScript/Preact)
- `server/` - Express API with RAG pipeline
- `scraping/` - Python web scraper
- `data/` - JSON meeting data
- `content/` - Markdown meeting content

## Submitting Changes

1. Create a feature branch from `main`
2. Make your changes
3. Run checks:
   ```bash
   npm run check
   npm run test
   ```
4. Commit with a clear message describing the change
5. Open a pull request with:
   - Description of what the PR does
   - Any relevant issue numbers
   - Screenshots for UI changes

## Code Style

- TypeScript/JavaScript: Prettier formatting (run `npm run format`)
- Python: Standard Python conventions
- Commit messages: Clear, concise, present tense ("Add feature" not "Added feature")

## Reporting Issues

When reporting bugs, please include:
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Browser/device info for UI issues

For chatbot accuracy issues, include:
- The exact question you asked
- The response you received
- What the correct answer should be (with source if possible)

## Questions?

Open an issue or reach out to the maintainers. We're happy to help you get started!

## License

By contributing, you agree that your contributions will be licensed under the [Peer Production License](./LICENSE).
