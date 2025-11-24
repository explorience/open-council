# Automatic Embedding Updates

Your chatbot automatically updates embeddings when you push new meetings to GitHub! No manual intervention needed.

## 🚀 How It Works

Your workflow is fully automated:

1. **Add new meeting JSON files to `data/`** (you're already doing this)
2. **Push to main branch** (you're already doing this)
3. **Railway auto-redeploys** (already configured)
4. **Embeddings auto-update** (incremental - only new meetings!)
5. **Server starts** (chatbot immediately available)

---

## ⚡ Performance

| Scenario | Time | Cost | Frequency |
|----------|------|------|-----------|
| **First deploy** (all 443 meetings) | 6-7 min | ~$2 | Once |
| **No new meetings** (redeploy only) | 2-3 sec | $0 | As needed |
| **Add 3 new meetings** (weekly) | ~10 sec | ~$0.001 | Weekly |

The system automatically detects which meetings already have embeddings and only processes new ones.

---

## 📋 What Happens on Each Deploy

### First Deploy (Initial Setup)
```
Mode: INCREMENTAL UPDATE
⚠️  No existing embeddings found. Running FULL generation for first time...
Loaded 443 meetings
Created 11062 chunks
Generating embeddings...
✅ Generated 11062 embeddings
✅ Vector database now contains 11062 total vectors
🚀 RAG Chatbot API running on http://0.0.0.0:3001
```
**Duration:** 6-7 minutes | **Cost:** ~$2

### Subsequent Deploys (No New Meetings)
```
Mode: INCREMENTAL UPDATE
Found 11062 existing embeddings
Loaded 443 meetings
Created 11062 total chunks
Found 0 new chunks (11062 already exist)
✅ No new meetings to process. Database is up to date!
🚀 RAG Chatbot API running on http://0.0.0.0:3001
```
**Duration:** 2-3 seconds | **Cost:** $0

### Weekly Updates (New Meetings Added)
```
Mode: INCREMENTAL UPDATE
Found 11062 existing embeddings
Loaded 446 meetings
Created 11137 total chunks
Found 75 new chunks (11062 already exist)
✅ Generated 75 new embeddings
✅ Vector database now contains 11137 total vectors
🚀 RAG Chatbot API running on http://0.0.0.0:3001
```
**Duration:** 5-30 seconds | **Cost:** ~$0.001

---

## ✅ Your Complete Workflow

### Weekly (or as needed):

```bash
# 1. Scrape new council meetings (you're already doing this)
npm run scrape

# 2. Commit and push
git add data/
git commit -m "Add new council meeting data"
git push origin main

# 3. That's it! Railway automatically:
#    - Detects the push
#    - Redeploys the app
#    - Checks for new meetings
#    - Generates embeddings for ONLY new meetings (fast!)
#    - Starts the chatbot server
```

**No manual embedding commands needed!** 🎉

---

## 🔧 Configuration

The automatic updates are configured in `railway.json`:

```json
{
  "deploy": {
    "startCommand": "npm run chat:generate && npm run chat:server"
  }
}
```

This runs:
1. `npm run chat:generate` - Incremental embedding update (default mode)
2. `npm run chat:server` - Start the API server

### Incremental Mode (Default)
- Automatically detects existing embeddings
- Only processes new meetings
- Fast and cheap

### Full Regeneration (Manual)
If you ever need to regenerate ALL embeddings from scratch:

```bash
npm run chat:generate -- --full
```

**When to use full regeneration:**
- You changed how meetings are chunked (modified `embeddings.ts`)
- You want to switch embedding models
- The database got corrupted
- You want a fresh start

**Otherwise, always use the default incremental mode.**

---

## 🛠️ API Endpoints (Optional)

If you want to trigger updates manually via API:

### Check Status
```bash
curl https://open-council-production.up.railway.app/api/stats
```

**Response:**
```json
{
  "totalChunks": 11062,
  "status": "ready",
  "isRegenerating": false
}
```

### Trigger Manual Update (Optional)
```bash
curl -X POST https://open-council-production.up.railway.app/api/regenerate
```

This runs in the background. Check `/api/stats` to monitor progress.

**Note:** You don't need this if you're using the Railway auto-deploy workflow (which you are).

---

## 🐛 Troubleshooting

### Every deploy takes 6-7 minutes (regenerating all embeddings)

**Problem:** Railway volume is not set up correctly.

**Solution:** See `RAILWAY_VOLUME_SETUP.md` for detailed instructions.

**Quick check:**
1. Railway Dashboard → Your Service → Volumes
2. Verify mount path is exactly: `/usr/src/app/lancedb`
3. Check logs for: "Found XXXX existing embeddings"
4. If logs show "No existing embeddings found" every time, volume isn't working

### Embeddings seem out of date

**Check Railway deployment:**
1. Go to Railway Dashboard → Deployments
2. Verify latest deploy succeeded
3. Check logs for "✅ Generated X new embeddings"

**Verify new data was committed:**
```bash
git log --oneline -5
# Should see your commit with new meeting data
```

**Test the API:**
```bash
curl https://open-council-production.up.railway.app/api/stats
# totalChunks should have increased
```

### Railway deployment failed

**Check logs:**
1. Railway Dashboard → Deployments → View Logs
2. Look for error messages

**Common issues:**
- `OPENAI_API_KEY not set` → Add to Railway environment variables
- `Rate limit exceeded` → Wait 60 seconds, redeploy
- `Out of memory` → Increase Railway plan (unlikely with 443 meetings)

### Want to force full regeneration

**Option 1: Via Railway dashboard**
1. Delete the volume: Railway → Service → Volumes → Delete
2. Redeploy
3. Create new volume with mount path `/usr/src/app/lancedb`

**Option 2: Change start command temporarily**
Edit `railway.json`:
```json
"startCommand": "npm run chat:generate -- --full && npm run chat:server"
```
Push to trigger deploy, then change back.

---

## 💡 Best Practices

### 1. Check Embedding Count After Adding Meetings

After pushing new meetings:

```bash
# Before push
curl https://open-council-production.up.railway.app/api/stats
# { "totalChunks": 11062 }

# After push + Railway redeploy
curl https://open-council-production.up.railway.app/api/stats
# { "totalChunks": 11137 }  ← Increased!
```

### 2. Monitor OpenAI Costs

Check your usage at: https://platform.openai.com/usage

**Expected costs:**
- Initial setup: ~$2 (one-time)
- Weekly updates (3 meetings): ~$0.001
- Monthly total: ~$0.004
- Yearly total: ~$0.05

Very cheap because of incremental updates!

### 3. Keep Railway Logs Clean

After initial setup, your logs should be short:
```
Mode: INCREMENTAL UPDATE
Found 11062 existing embeddings
✅ No new meetings to process
🚀 RAG Chatbot API running
```

If you see long embedding generation logs every deploy, your volume isn't working.

---

## 📊 Summary

**Your automated workflow:**
```
Weekly: Add meetings → Push to GitHub → Railway auto-deploys → Embeddings auto-update → Done!
```

**Time saved:**
- Old way: 6-7 minutes per update
- New way: 5-30 seconds per update
- **Savings: ~99% faster!**

**Cost saved:**
- Old way: ~$2 per update
- New way: ~$0.001 per update
- **Savings: ~99.95% cheaper!**

**Manual work saved:**
- Old way: Run script every time
- New way: Push to GitHub (already doing this)
- **Savings: Zero extra steps!**

---

## ✅ Checklist

- [x] Railway auto-deploys on push to main
- [x] `railway.json` configured with incremental update command
- [ ] Railway volume set up correctly (see `RAILWAY_VOLUME_SETUP.md`)
- [ ] First deploy completed successfully (generated all embeddings)
- [ ] Second deploy was fast (2-3 seconds, didn't regenerate)
- [ ] Tested adding new meetings (only new ones processed)

Once all items are checked, your system is fully automated! 🎉
