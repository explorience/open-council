# 🚀 Deployment Guide - Open Council with Chatbot

This guide shows you how to deploy the Open Council site with the AI chatbot using **Vercel** (static site) and **Railway** (chatbot API).

## Architecture

```
┌─────────────────┐         ┌──────────────────┐
│  Vercel         │         │  Railway.app     │
│  (Static Site)  │────────▶│  (Chatbot API)   │
│  Quartz Build   │  HTTPS  │  Express Server  │
└─────────────────┘         └──────────────────┘
```

---

## Part 1: Deploy Chatbot Backend to Railway

### Step 1: Sign Up for Railway

1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project"

### Step 2: Deploy from GitHub

1. Click "Deploy from GitHub repo"
2. Select `explorience/open-council`
3. Railway will auto-detect it's a Node.js project

### Step 3: Configure Environment Variables

In Railway project settings, add these environment variables:

```
OPENAI_API_KEY=sk-proj-your-openai-key-here
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here
LLM_PROVIDER=anthropic
PORT=3001
```

### Step 4: Generate Embeddings

Railway doesn't have your meeting data embeddings yet. You need to:

**Option A: Generate Locally, Upload to Railway**

1. Run locally:
   ```bash
   npm run chat:generate
   ```

2. This creates a `lancedb/` directory

3. Upload to Railway using Railway CLI:
   ```bash
   # Install Railway CLI
   npm install -g @railway/cli

   # Login
   railway login

   # Link to your project
   railway link

   # Upload lancedb directory
   railway up lancedb/
   ```

**Option B: Generate on Railway (recommended)**

1. In Railway, go to your deployment
2. Click on "Deployments" tab
3. Add a "Run command" deployment:
   ```bash
   npm run chat:generate
   ```
4. This will generate embeddings once on Railway
5. Railway will persist the `lancedb/` directory

### Step 5: Get Your Railway URL

After deployment:
1. Go to your Railway project
2. Click on "Settings"
3. Find "Domains" section
4. Copy the public URL (e.g., `https://your-app.railway.app`)

---

## Part 2: Deploy Static Site to Vercel

### Step 1: Connect to Vercel

1. Go to https://vercel.com
2. Sign up/login with GitHub
3. Click "Add New Project"
4. Import `explorience/open-council`

### Step 2: Configure Build Settings

Vercel should auto-detect the settings from `vercel.json`, but verify:

- **Framework Preset**: Other
- **Build Command**: `npm run build`
- **Output Directory**: `public`
- **Install Command**: `npm install`
- **Node Version**: 22.x

### Step 3: Update Chatbot API URL

Before deploying, update the chatbot API URL to point to Railway:

1. Edit `quartz.layout.ts`
2. Find this line:
   ```typescript
   apiUrl: "http://localhost:3001"
   ```
3. Change to your Railway URL:
   ```typescript
   apiUrl: "https://your-app.railway.app"
   ```
4. Commit and push:
   ```bash
   git add quartz.layout.ts
   git commit -m "Update chatbot API URL to Railway"
   git push origin main
   ```

### Step 4: Deploy

Click "Deploy" in Vercel. It will:
1. Build your Quartz site
2. Deploy to Vercel's CDN
3. Give you a URL like `https://open-council.vercel.app`

---

## Part 3: Test Everything

### Test the Static Site

1. Visit your Vercel URL
2. You should see your council meeting site
3. Verify navigation works

### Test the Chatbot

1. Look for the chat bubble in the bottom-right corner
2. Click it to open the chat
3. Try asking: "What happened at the January 21st meeting?"
4. You should get a streaming response

### Troubleshooting

**Chatbot not appearing:**
- Check browser console for errors
- Verify Railway service is running
- Check CORS settings in `server/index.ts`

**"Table not initialized" error:**
- Run `npm run chat:generate` on Railway
- Make sure `lancedb/` directory exists and is persisted

**API connection errors:**
- Verify the `apiUrl` in `quartz.layout.ts` matches your Railway URL
- Check Railway logs for errors
- Ensure environment variables are set on Railway

---

## Part 4: Custom Domains (Optional)

### Railway Custom Domain

1. In Railway project settings
2. Go to "Domains"
3. Add custom domain (e.g., `api.opencouncil.ca`)
4. Add DNS records as instructed

### Vercel Custom Domain

1. In Vercel project settings
2. Go to "Domains"
3. Add custom domain (e.g., `opencouncil.ca`)
4. Add DNS records as instructed

### Update API URL

After setting up domains, update `quartz.layout.ts`:

```typescript
apiUrl: "https://api.opencouncil.ca"
```

---

## Costs

### Railway (Chatbot Backend)
- **Free Tier**: $5 credit/month (enough for moderate usage)
- **Hobby Plan**: $5/month for more resources
- **Estimated**: $0-10/month depending on usage

### Vercel (Static Site)
- **Free Tier**: Unlimited bandwidth for personal projects
- **Estimated**: $0/month

### API Costs (OpenAI/Anthropic)
- **Embeddings**: ~$0.50-1.00 one-time
- **Chat**: ~$0.003-0.03 per conversation
- **Estimated**: $5-20/month depending on traffic

**Total**: ~$5-30/month for everything

---

## Updating Content

### Add New Meetings

1. Run scraper locally:
   ```bash
   cd scraping
   uv run main.py
   ```

2. New JSON files appear in `data/`

3. Re-generate embeddings:
   ```bash
   npm run chat:generate
   ```

4. Upload new embeddings to Railway:
   ```bash
   railway up lancedb/
   ```

5. Commit and push to trigger Vercel rebuild:
   ```bash
   git add data/ content/
   git commit -m "Add new meeting data"
   git push origin main
   ```

---

## Monitoring

### Railway Logs

View real-time logs:
```bash
railway logs
```

Or in Railway dashboard: Deployments → View Logs

### Vercel Logs

View deployment logs in Vercel dashboard:
Project → Deployments → [Latest] → Build Logs

---

## Environment Variables Reference

### Railway (Backend)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings |
| `ANTHROPIC_API_KEY` | No | Anthropic API key for Claude chat |
| `LLM_PROVIDER` | No | `anthropic` or `openai` (default: anthropic) |
| `PORT` | No | Server port (default: 3001) |

### Vercel (Frontend)

No environment variables needed for the static site.

---

## Security Checklist

- [ ] API keys are set as environment variables (not in code)
- [ ] `.env` file is gitignored
- [ ] `lancedb/` directory is gitignored
- [ ] CORS is configured properly in `server/index.ts`
- [ ] Railway service uses HTTPS
- [ ] Vercel deployment uses HTTPS

---

## Support

- **Railway Issues**: https://railway.app/help
- **Vercel Issues**: https://vercel.com/support
- **Chatbot Issues**: See [CHATBOT.md](./CHATBOT.md)

---

**Ready to deploy?** Start with Part 1 (Railway) first, then Part 2 (Vercel)!
