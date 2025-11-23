# 🚀 AI Chatbot - Quick Start Guide

Get your intelligent council meeting chatbot up and running in 5 minutes!

## Step 1: Set Up API Keys

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
OPENAI_API_KEY=sk-your-openai-key-here
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here  # Optional but recommended
LLM_PROVIDER=anthropic
```

Get your keys:
- **OpenAI**: https://platform.openai.com/api-keys (required)
- **Anthropic**: https://console.anthropic.com/settings/keys (optional, for better quality)

## Step 2: Generate Embeddings

Run this once to process all meeting data:

```bash
npm run chat:generate
```

This takes 2-5 minutes and costs ~$0.50-1.00.

## Step 3: Start the Chat Server

```bash
npm run chat:server
```

Keep this running in a separate terminal.

## Step 4: Start Quartz

In another terminal:

```bash
npm run dev
```

## Step 5: Try It!

1. Visit http://localhost:8080
2. Look for the chat icon in the bottom-right corner
3. Click it and ask: "What happened at the January 21st council meeting?"

## Example Questions

- "What bills were passed about housing?"
- "Show me votes where councillors disagreed"
- "Who attended the Planning Committee meeting?"
- "What did Councillor Rahman propose?"

## Troubleshooting

**"Table not initialized" error?**
→ Run `npm run chat:generate`

**Chatbot not appearing?**
→ Make sure both `npm run chat:server` and `npm run dev` are running

**API connection errors?**
→ Check that `.env` file exists with valid API keys

---

📖 **Full documentation**: See [CHATBOT.md](./CHATBOT.md)
