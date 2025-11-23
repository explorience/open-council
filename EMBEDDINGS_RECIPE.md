# 🚀 Embedding Generation & Deployment - When You're Ready

## Prerequisites

✅ All meetings scraped (100s going back to 2014)
✅ Railway backend deployed and working
✅ Railway Volume created (Settings → Volumes → `/app/lancedb`)

---

## Step-by-Step Recipe

### 1. Generate Embeddings Locally

```bash
# Make sure your .env file has OPENAI_API_KEY
npm run chat:generate
```

**What happens:**
- Processes all JSON files in `data/`
- Creates `lancedb/` directory (~100-300 MB)
- Costs ~$3-5 for 200-300 meetings
- Takes ~10-20 minutes

### 2. Temporarily Include in Git

Edit `.gitignore` and comment out the lancedb line:

```diff
# Chatbot
.env
-lancedb/
+# lancedb/  (temporarily included)
server/dist/
```

### 3. Commit and Push to Railway

```bash
git add lancedb/
git commit -m "Add initial embeddings for chatbot"
git push origin main
```

Railway will automatically deploy with the embeddings.

### 4. Verify on Railway

- Go to Railway → Deployments
- Wait for deployment to complete
- Check Volumes tab - should show disk usage

### 5. Re-ignore lancedb/

Edit `.gitignore` back:

```diff
# Chatbot
.env
-# lancedb/  (temporarily included)
+lancedb/
server/dist/
```

```bash
git add .gitignore
git commit -m "Re-ignore lancedb directory"
git push origin main
```

### 6. Test the API

```bash
curl https://open-council-production.up.railway.app/api/stats
```

Should return: `{"count": 1847}` (or your chunk count)

---

## Deploy Frontend to Vercel

1. Go to https://vercel.com
2. Import `explorience/open-council`
3. Select branch (or merge to main first)
4. Click Deploy
5. Visit your site and test the chatbot!

---

## Future Updates

When you scrape new meetings:

```bash
# 1. Scrape new meetings (they go to data/)
cd scraping && uv run main.py

# 2. Re-generate embeddings locally
npm run chat:generate

# 3. Temporarily include, commit, push (repeat steps 2-5 above)
```

The Railway Volume will persist the updated embeddings.

---

## Costs

- **Embeddings**: ~$3-5 for 200-300 meetings (one-time)
- **Updates**: ~$0.20-0.50 per month of new meetings
- **Railway**: $5/month (Hobby plan, or free tier)
- **Vercel**: Free for personal projects

**Total**: ~$5-10/month after initial setup

---

## Troubleshooting

**"Table not initialized" error:**
- Embeddings weren't generated or uploaded
- Check Railway Volumes tab for disk usage

**Railway deployment fails:**
- Check if lancedb/ was included in git
- Check Railway logs for errors

**Chatbot not responding:**
- Verify Railway URL in `quartz.layout.ts`
- Check browser console for CORS errors

---

That's it! Simple git-based workflow, no fancy CLI tools needed.
