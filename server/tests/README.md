# OpenCouncil Accuracy Test Suite

Chatbot accuracy tests for [opencouncil.xyz](https://opencouncil.xyz).

Ground truth: **London City Council – March 3, 2026**.

---

## Quick start

```bash
# From the repo root (where package.json lives)
cd server

# Run all tests (no judge scoring)
npx tsx --test tests/q1-2026-accuracy.test.ts

# Run with AI judge scoring (requires Anthropic API key)
JUDGE=1 ANTHROPIC_API_KEY=sk-ant-... npx tsx --test tests/q1-2026-accuracy.test.ts

# Run against a local dev server
OPENCOUNCIL_API_URL=http://localhost:3000/api/chat npx tsx --test tests/q1-2026-accuracy.test.ts
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENCOUNCIL_API_URL` | `https://open-council-production.up.railway.app/api/chat` | Chat API endpoint |
| `JUDGE` | _(unset)_ | Set to `1` to enable AI judge scoring |
| `ANTHROPIC_API_KEY` | _(unset)_ | Required when `JUDGE=1` |

---

## Test categories

| Category | Count | What it tests |
|---|---|---|
| `recent-facts` | 15 | Specific vote counts, dollar amounts, names from Mar 3 2026 |
| `cross-meeting` | 10 | Pattern recognition across meeting items |
| `councillor` | 10 | Per-councillor voting records |
| `hard-edge` | 15+ | Negation, hallucination traps, precision, false-premise questions |
| **Total** | **50+** | |

---

## Ground truth (March 3, 2026)

| Item | Outcome |
|---|---|
| Integrity Commissioner Report | Passed **14-1** (Trosow sole dissenter) |
| Peloza appointment | Appointed to **ICSC** |
| Ridout development | Approved **11-4** (Hopkins / Trosow / Ferreira / Rahman nay) |
| OEV BIA reimbursement $14,152.33 | Original **failed 5-8**, Stevenson alternative **passed 10-3** |
| Municipal Access Agreement – Telus | **Unanimously** amended |
| Extending past 6pm | Passed **12-1** (Trosow sole dissenter) |
| Housing Stability Report | Passed **12-1** (Stevenson sole dissenter) |
| Parking study amendment (Franke) | **Failed 4-10** |
| Bills 105 / 123 (zoning) | Passed **8-3** |
| Bill 108 | Passed **9-2** (Stevenson / Rahman nay) |
| Bill 109 | Passed **10-1** (Stevenson sole nay) |

---

## Judge mode

When `JUDGE=1`, each test case is also scored by **Claude Haiku** on three 0–5 dimensions:

| Dimension | Description |
|---|---|
| `accuracy` | Factual correctness vs ground truth |
| `completeness` | Coverage of all relevant facts |
| `hallucination` | Absence of fabricated content (5 = clean) |

Scores below 3 emit a warning in the console but do not fail the test run – this keeps the suite non-blocking while surfacing quality regressions.

---

## Running in Claude Code (ACP)

```
Run the opencouncil accuracy tests located at server/tests/q1-2026-accuracy.test.ts.
Use: npx tsx --test server/tests/q1-2026-accuracy.test.ts
If you want judge scoring, set JUDGE=1 and pass ANTHROPIC_API_KEY.
Report: number passed/failed per category, any low-scoring judge items.
```

---

## Adding new test cases

Edit `q1-2026-accuracy.test.ts` and add a new entry to the `TEST_CASES` array:

```typescript
{
  id: "rf-16",                          // unique id, category prefix + number
  category: "recent-facts",            // recent-facts | cross-meeting | councillor | hard-edge
  question: "...",                      // what to ask the chatbot
  mustContain: ["keyword"],             // strings that MUST appear (case-insensitive)
  mustNotContain: ["bad word"],         // strings that MUST NOT appear
  groundTruth: "The real answer...",    // used by the judge; be precise
}
```

---

## Dependencies

Only `tsx` is required (for TypeScript execution). Everything else uses Node.js built-ins:

```bash
npm install --save-dev tsx
# or just use npx tsx (no install needed)
```

No test framework dependencies beyond `node:test` (built-in since Node 18).

---

## Output example

```
▶ OpenCouncil Accuracy – March 3 2026
  ▶ Category: recent-facts (15 cases)
    ✔ [rf-01] What was the vote count on the Integrity Commissioner report... (1.2s)
    ✔ [rf-02] Who was the lone dissenter on the Integrity Commissioner... (0.9s)
    ...
  ▶ Category: hard-edge (15 cases)
    ✔ [he-01] Did the Ridout development pass unanimously... (1.1s)
    ✗ [he-07] Which councillors voted in favour of the Ridout... (0.8s)
      Expected "trosow" NOT in response. Got: "...Trosow voted in favour..."
    ...

ℹ tests 50
ℹ pass  48
ℹ fail  2
```
