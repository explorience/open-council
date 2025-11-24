# Running Embedding Generation on Railway

Railway is successfully deployed! Here's how to generate embeddings directly on the Railway server.

## Method 1: Temporary Start Command (Recommended)

This approach runs embedding generation once on Railway, then switches back to normal server operation.

### Step 1: Modify railway.json

Edit your `railway.json` file:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm run chat:generate && npm run chat:server",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

Notice the start command now runs BOTH:
1. `npm run chat:generate` - generates embeddings (runs once, saves to `/app/lancedb`)
2. `npm run chat:server` - starts the API server

### Step 2: Commit and Deploy

```bash
git add railway.json
git commit -m "Temporarily add embedding generation to Railway start command"
git push origin main
```

Railway will automatically redeploy.

### Step 3: Monitor the Logs

In Railway dashboard:
1. Go to your deployment
2. Click "Deployments" → "View Logs"
3. Watch for these messages:

```
🔄 Loading meetings from data/...
✅ Loaded X meetings with Y items
🔄 Creating X chunks from meetings...
✅ Created X chunks
📊 Generating embeddings in batches of 100...
Batch 1/X: ████████████ 100%
...
✅ Embeddings generated and stored successfully!
🚀 RAG Chatbot API running on http://0.0.0.0:3001
```

This may take 5-15 minutes depending on how many meetings you have.

### Step 4: Revert to Normal Start Command

Once embeddings are generated (you'll see the success message), change `railway.json` back:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm run chat:server",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

Commit and push:

```bash
git add railway.json
git commit -m "Revert to normal server start command"
git push origin main
```

The embeddings are now stored in Railway's persistent volume at `/app/lancedb/` and will persist across deployments!

---

## Method 2: Railway Dashboard (If Available)

Some Railway plans allow running one-off commands:

1. Go to Railway dashboard → your project
2. Look for "Shell" or "Run Command" option
3. If available, run: `npm run chat:generate`

**Note**: This feature may not be available on all Railway plans.

---

## Method 3: Generate Locally, Upload via Git (If Absolutely Necessary)

⚠️ **Not recommended** - Only use if Methods 1 & 2 fail.

1. Temporarily remove `lancedb/` from `.gitignore`
2. Run `npm run chat:generate` locally
3. Commit the `lancedb/` directory
4. Push to Railway
5. Re-add `lancedb/` to `.gitignore`

This is messy and not recommended because the `lancedb/` directory can be very large.

---

## How to Know It Worked

### Test the /api/stats Endpoint

```bash
curl https://open-council-production.up.railway.app/api/stats
```

Should return:
```json
{
  "totalChunks": 1234,
  "status": "ready"
}
```

If `totalChunks` is greater than 0, embeddings are loaded!

### Test the Chat

1. Visit your site with the chatbot
2. Ask: "What happened at the most recent council meeting?"
3. You should get a streaming response with relevant information

---

## When to Re-run Embedding Generation

Run `chat:generate` again whenever you:
- Add new meeting data to `data/` directory
- Update meeting content
- Want to rebuild the entire vector database

Just repeat Method 1 (temporary start command) to regenerate.

---

## Costs

Embedding generation for ~100 meetings (2014-present):
- **OpenAI API**: ~$0.50-2.00 (one-time per generation)
- **Railway compute**: Free (runs during normal deployment)
- **Railway storage**: Minimal (~100MB for lancedb/)

---

## Troubleshooting

**"Table not initialized" error in logs:**
- Embeddings haven't been generated yet
- Run Method 1 above

**"OPENAI_API_KEY is not set" error:**
- Add `OPENAI_API_KEY` to Railway environment variables
- Get key from https://platform.openai.com/api-keys

**Embedding generation takes too long:**
- Normal for 100s of meetings (5-15 minutes)
- Railway has generous timeouts for initial startup
- Check logs to see progress

**Railway timeout during embedding generation:**
- Increase timeout in railway.json if needed (not usually necessary)
- Or generate in smaller batches by temporarily moving some data files

---

**Ready?** Use Method 1 to run embedding generation on Railway right now!
