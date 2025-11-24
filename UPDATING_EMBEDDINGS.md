# Automatic Embedding Updates

Your chatbot now supports **incremental embedding generation** - it only processes NEW meetings, not all meetings every time!

## 🚀 How It Works

The system automatically detects which meetings already have embeddings and only generates embeddings for new ones. This means:

- **First run**: Processes all 443 meetings (~6-7 minutes, ~$2)
- **Adding 3 new meetings**: Processes only those 3 (~10 seconds, ~$0.001)
- **No manual tracking needed**: The system remembers what's already processed

---

## 📋 Three Ways to Update

### Method 1: Automatic API Call (Recommended for Automation)

After you push new meetings to GitHub, trigger the update:

```bash
curl -X POST https://open-council-production.up.railway.app/api/regenerate
```

**Response:**
```json
{
  "status": "started",
  "message": "Incremental embedding generation started. Check /api/stats to monitor progress."
}
```

**Check progress:**
```bash
curl https://open-council-production.up.railway.app/api/stats
```

**Response:**
```json
{
  "totalChunks": 11085,
  "status": "ready",
  "isRegenerating": false
}
```

---

### Method 2: GitHub Action (Set It and Forget It)

Create `.github/workflows/update-embeddings.yml`:

```yaml
name: Update Chatbot Embeddings

on:
  push:
    branches: [main]
    paths:
      - 'data/**/*.json'  # Only run when meeting data changes

jobs:
  update-embeddings:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger embedding regeneration
        run: |
          curl -X POST https://open-council-production.up.railway.app/api/regenerate

      - name: Wait for completion (optional)
        run: |
          for i in {1..30}; do
            STATUS=$(curl -s https://open-council-production.up.railway.app/api/stats | jq -r '.isRegenerating')
            if [ "$STATUS" == "false" ]; then
              echo "✅ Embeddings updated successfully"
              exit 0
            fi
            echo "⏳ Still regenerating... ($i/30)"
            sleep 10
          done
```

**Benefits:**
- Runs automatically when you push new meetings
- No manual intervention needed
- Free on GitHub Actions

---

### Method 3: Manual CLI (For Development)

If you have the repo locally and want to test:

```bash
# Incremental update (default - only new meetings)
npm run chat:generate

# Full regeneration (rebuild everything from scratch)
npm run chat:generate -- --full
```

---

## 🔄 Workflow for Adding New Meetings

Here's your weekly workflow:

1. **Scrape new meetings** (you're already doing this)
2. **Push to GitHub** (you're already doing this)
3. **Trigger update** (new step):
   - **Option A**: Set up GitHub Action (one-time setup, then automatic forever)
   - **Option B**: Run this command:
     ```bash
     curl -X POST https://open-council-production.up.railway.app/api/regenerate
     ```
4. **Done!** New meetings are now searchable in the chatbot

---

## ⏱️ Performance

| Scenario | Time | Cost | Automatic? |
|----------|------|------|------------|
| Initial 443 meetings | 6-7 min | ~$2 | ✅ First deploy |
| Add 1 new meeting | ~5 sec | ~$0.0003 | ✅ With GitHub Action |
| Add 10 new meetings | ~30 sec | ~$0.003 | ✅ With GitHub Action |
| Full regeneration (443 meetings) | 6-7 min | ~$2 | ❌ Manual with `--full` |

---

## 🛠️ API Endpoints

### GET /api/stats
Check database status:
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

### POST /api/regenerate
Trigger incremental update:
```bash
curl -X POST https://open-council-production.up.railway.app/api/regenerate
```

**Response:**
```json
{
  "status": "started",
  "message": "Incremental embedding generation started..."
}
```

**Note:** Returns immediately. The update runs in the background. Check `/api/stats` to monitor progress.

---

## 🔧 When to Use Full Regeneration

Use `npm run chat:generate -- --full` if:
- You changed how meetings are chunked (modified `embeddings.ts`)
- You want to switch embedding models
- The database got corrupted
- You want a fresh start

**Otherwise, always use incremental mode** (the default).

---

## 🎯 Recommended Setup (5 Minutes)

1. **Create the GitHub Action** (one-time):
   - Create `.github/workflows/update-embeddings.yml`
   - Copy the workflow from Method 2 above
   - Commit and push

2. **Test it**:
   - Add a new meeting JSON file to `data/`
   - Push to GitHub
   - Watch the Action run automatically
   - Check `/api/stats` to see the new embedding count

3. **Forget about it**:
   - Every time you push new meetings, embeddings update automatically
   - Zero manual intervention needed
   - Always up to date

---

## 🐛 Troubleshooting

**"No new meetings to process"**
- This is normal! It means all meetings already have embeddings
- The system is working correctly

**"Regeneration already in progress"**
- Wait a few minutes for the current regeneration to finish
- Check `/api/stats` - when `isRegenerating: false`, you can trigger again

**Embeddings seem out of date**
- Check Railway logs to see if regeneration succeeded
- Verify the API endpoint is accessible
- Try calling `/api/regenerate` manually

---

## 💡 Pro Tips

1. **Monitor costs**: Check your OpenAI usage at https://platform.openai.com/usage
   - Incremental updates cost almost nothing (~$0.001 per 3 meetings)

2. **Check logs**: Railway dashboard → Deployments → View Logs
   - You'll see: "✅ Added X new embeddings to database"

3. **Verify it worked**:
   ```bash
   curl https://open-council-production.up.railway.app/api/stats
   ```
   - `totalChunks` should increase after adding meetings

---

## 📚 Summary

✅ **Automatic**: Set up GitHub Action once, never worry about it again
✅ **Fast**: Only processes new meetings (seconds instead of minutes)
✅ **Cheap**: Incremental updates cost ~$0.001 per 3 meetings
✅ **Smart**: Automatically detects what's new
✅ **Flexible**: Manual trigger available when needed

**Your workflow is now fully automated!** 🎉
