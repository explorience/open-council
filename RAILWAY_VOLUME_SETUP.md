# Railway Volume Setup for LanceDB

Your chatbot needs a **persistent volume** to store embeddings between deploys. Without this, Railway will regenerate all embeddings on every deploy (wasting time and money).

## 🔧 Setting Up the Volume (One-Time Setup)

### Step 1: Create a Volume in Railway

1. Go to your Railway project dashboard
2. Click on your service (the chatbot backend)
3. Go to the **"Variables"** tab or **"Settings"** tab
4. Look for **"Volumes"** section
5. Click **"New Volume"** or **"Add Volume"**

### Step 2: Configure the Volume

**Mount Path:** `/usr/src/app/lancedb`

This is critical! The mount path must be exactly `/usr/src/app/lancedb` because:
- The Dockerfile sets `WORKDIR /usr/src/app`
- The code uses `./lancedb` which resolves to `/usr/src/app/lancedb`

**Volume Name:** You can name it anything (e.g., `lancedb-data` or `embeddings`)

### Step 3: Verify Volume is Mounted

After creating the volume, redeploy your service. In the logs you should see:

```
Mounting volume on: /var/lib/containers/railwayapp/bind-mounts/.../vol_...
```

This confirms the volume is being mounted.

### Step 4: Test Persistence

1. **First deploy after volume setup:**
   - Logs will show: "⚠️ No existing embeddings found. Running FULL generation..."
   - Takes 6-7 minutes
   - Creates 11,062 embeddings

2. **Second deploy (without adding new meetings):**
   - Logs should show: "Found 11062 existing embeddings"
   - Then: "✅ No new meetings to process. Database is up to date!"
   - Takes ~2-3 seconds
   - Starts server immediately

3. **Deploy with new meetings:**
   - Logs show: "Found 11062 existing embeddings"
   - Then: "✅ Generated X new embeddings" (only the new ones)
   - Takes ~5-30 seconds depending on how many new meetings

---

## ❌ If Volume Is NOT Set Up Correctly

You'll see these symptoms:

1. **Every deploy takes 6-7 minutes** (regenerating all embeddings)
2. **Logs always show:** "⚠️ No existing embeddings found. Running FULL generation..."
3. **Never shows:** "Found XXXX existing embeddings"

---

## 🔍 Troubleshooting

### Volume exists but embeddings still regenerate every time

**Check the mount path:**
1. Railway Dashboard → Your Service → Volumes
2. Verify mount path is exactly: `/usr/src/app/lancedb`
3. **NOT** `/app/lancedb` or `/lancedb` or anything else

**Check volume is attached to the right service:**
- Make sure the volume is attached to your backend service (not the Quartz frontend)

### Can't find Volumes section in Railway

**Railway plans:**
- Free tier: Volumes may not be available
- Hobby/Pro: Volumes are available
- Check your plan at: Railway Dashboard → Settings → Billing

**Alternative UI locations:**
- Some Railway versions: Service → Settings → Volumes
- Others: Service → Variables → Volumes
- New UI: Service → Settings → Data → Volumes

### Need to clear the volume and start fresh

If you need to delete all embeddings and regenerate:

1. Railway Dashboard → Your Service → Volumes
2. Click the volume
3. Click "Delete Volume" or "Detach Volume"
4. Redeploy
5. Create a new volume with mount path `/usr/src/app/lancedb`

---

## 💡 How It Works

### Without Volume (Bad):
```
Deploy 1: Generate 11,062 embeddings → Save to /usr/src/app/lancedb (lost on redeploy)
Deploy 2: /usr/src/app/lancedb is empty → Generate 11,062 embeddings again (wasted $2)
Deploy 3: /usr/src/app/lancedb is empty → Generate 11,062 embeddings again (wasted $2)
```

### With Volume (Good):
```
Deploy 1: Generate 11,062 embeddings → Save to volume → $2
Deploy 2: Load 11,062 from volume → Check for new → None found → $0
Deploy 3: Load 11,062 from volume → Check for new → 3 new → Generate 3 → $0.001
```

---

## 📊 Expected Behavior After Setup

### First deploy after creating volume:
```
Mode: INCREMENTAL UPDATE

📊 Step 1: Checking for new meetings...
⚠️  No existing embeddings found. Running FULL generation for first time...

Loading meetings from /usr/src/app/data
Loaded 443 meetings
Creating chunks...
Created 11062 chunks
Generating embeddings...
Processed 100 / 11062
Processed 200 / 11062
...
✅ Generated 11062 embeddings

📊 Step 2: Creating vector database...
Table council_meetings created successfully

✅ Vector database now contains 11062 total vectors
```

### Subsequent deploys (no new meetings):
```
Mode: INCREMENTAL UPDATE

📊 Step 1: Checking for new meetings...

Found 11062 existing embeddings
🔄 Loading meetings from /usr/src/app/data
Loaded 443 meetings
Creating chunks...
Created 11062 total chunks
Found 0 new chunks (11062 already exist)
✅ No new meetings to process. Database is up to date!

✅ Vector database now contains 11062 total vectors

🚀 RAG Chatbot API running on http://0.0.0.0:3001
```

### Deploy with 3 new meetings:
```
Mode: INCREMENTAL UPDATE

📊 Step 1: Checking for new meetings...

Found 11062 existing embeddings
🔄 Loading meetings from /usr/src/app/data
Loaded 446 meetings
Creating chunks...
Created 11137 total chunks
Found 75 new chunks (11062 already exist)
Generating embeddings for 75 new chunks...
Processed 75 / 75

✅ Generated 75 new embeddings

📊 Step 2: Adding to vector database...
Adding 75 new records to existing table...
Successfully added 75 new records

✅ Vector database now contains 11137 total vectors

🚀 RAG Chatbot API running on http://0.0.0.0:3001
```

---

## ✅ Checklist

- [ ] Volume created in Railway
- [ ] Mount path is exactly `/usr/src/app/lancedb`
- [ ] Volume attached to backend service (not frontend)
- [ ] First deploy completed (generated all embeddings)
- [ ] Second deploy only took 2-3 seconds (didn't regenerate)
- [ ] Logs show "Found XXXX existing embeddings"

Once all checked, your volume is working correctly! 🎉
