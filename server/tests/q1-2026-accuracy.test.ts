/**
 * OpenCouncil Chatbot Accuracy Test Suite
 * Q1 2026 - London City Council
 *
 * Ground truth: March 3, 2026 Council Meeting
 *
 * Run:
 *   npx tsx --test server/tests/q1-2026-accuracy.test.ts
 *   JUDGE=1 npx tsx --test server/tests/q1-2026-accuracy.test.ts
 *
 * Categories:
 *   recent-facts   (15) – specific votes/numbers from Mar 3 2026
 *   cross-meeting  (10) – patterns across multiple meetings
 *   councillor     (10) – councillor-specific behaviour
 *   hard-edge      (15) – hallucination traps, negation, precision edge cases
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_URL =
  process.env.OPENCOUNCIL_API_URL ||
  "https://open-council-production.up.railway.app/api/chat";
const TIMEOUT_MS = 30_000;
const JUDGE_MODE = process.env.JUDGE === "1";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TestCase {
  id: string;
  category: "recent-facts" | "cross-meeting" | "councillor" | "hard-edge";
  question: string;
  /** Keywords/phrases that MUST appear in a correct answer */
  mustContain?: string[];
  /** Keywords/phrases that MUST NOT appear (hallucination guards) */
  mustNotContain?: string[];
  /** Freeform description used by the judge */
  groundTruth: string;
}

interface JudgeScore {
  accuracy: number;       // 0-5
  completeness: number;   // 0-5
  hallucination: number;  // 0-5 (5 = no hallucination)
  reasoning: string;
}

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------
async function askChatbot(message: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    let fullText = "";

    if (contentType.includes("text/event-stream")) {
      // Parse SSE stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            const raw = line.slice(5).trim();
            if (raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              // Support both {content:"..."} and OpenAI delta format
              const chunk =
                parsed.content ??
                parsed.choices?.[0]?.delta?.content ??
                "";
              fullText += chunk;
            } catch {
              // non-JSON data line – skip
            }
          }
        }
      }
    } else {
      // Fallback: plain JSON response
      const json = await res.json();
      fullText =
        json.content ?? json.message ?? json.text ?? JSON.stringify(json);
    }

    return fullText.trim();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Judge (Claude Haiku)
// ---------------------------------------------------------------------------
async function judgeResponse(
  question: string,
  response: string,
  groundTruth: string
): Promise<JudgeScore> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set – cannot run judge");
  }

  const prompt = `You are evaluating a city council chatbot's answer against ground truth.

Question: ${question}

Ground Truth: ${groundTruth}

Chatbot Response: ${response}

Score each dimension 0-5:
- accuracy: How factually correct is the response vs ground truth? (5=perfect)
- completeness: Does it cover all relevant ground truth facts? (5=fully complete)  
- hallucination: Are there fabricated facts not in ground truth? (5=no hallucination, 0=severe hallucination)

Respond ONLY with valid JSON:
{"accuracy":N,"completeness":N,"hallucination":N,"reasoning":"one sentence"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const data = await res.json();
  const text = data.content[0].text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Unexpected judge response: ${text}`);
  return JSON.parse(match[0]) as JudgeScore;
}

// ---------------------------------------------------------------------------
// Test runner helper
// ---------------------------------------------------------------------------
async function runTestCase(tc: TestCase) {
  const response = await askChatbot(tc.question);

  // Basic assertions (always run)
  assert.ok(
    response.length > 10,
    `Response too short for "${tc.question.slice(0, 60)}..."`
  );

  const lowerResponse = response.toLowerCase();

  for (const phrase of tc.mustContain ?? []) {
    assert.ok(
      lowerResponse.includes(phrase.toLowerCase()),
      `Expected "${phrase}" in response.\nQuestion: ${tc.question}\nGot: ${response}`
    );
  }

  for (const phrase of tc.mustNotContain ?? []) {
    assert.ok(
      !lowerResponse.includes(phrase.toLowerCase()),
      `Unexpected phrase "${phrase}" found in response.\nQuestion: ${tc.question}\nGot: ${response}`
    );
  }

  // Optional judge scoring
  if (JUDGE_MODE) {
    const score = await judgeResponse(tc.question, response, tc.groundTruth);
    console.log(
      `  [JUDGE] ${tc.id} acc=${score.accuracy} comp=${score.completeness} hal=${score.hallucination} – ${score.reasoning}`
    );
    // Soft threshold – warn but don't fail so test suite still reports
    if (score.accuracy < 3 || score.hallucination < 3) {
      console.warn(
        `  ⚠️  Low judge score for ${tc.id}: accuracy=${score.accuracy}, hallucination=${score.hallucination}`
      );
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------
const TEST_CASES: TestCase[] = [
  // =========================================================================
  // CATEGORY: recent-facts (15 cases)
  // =========================================================================
  {
    id: "rf-01",
    category: "recent-facts",
    question:
      "What was the vote count on the Integrity Commissioner report at the March 3, 2026 council meeting?",
    mustContain: ["14", "1"],
    groundTruth:
      "The Integrity Commissioner report passed 14-1, with Trosow as the sole dissenter.",
  },
  {
    id: "rf-02",
    category: "recent-facts",
    question:
      "Who was the lone dissenter on the Integrity Commissioner report in March 2026?",
    mustContain: ["trosow"],
    groundTruth:
      "Councillor Trosow was the lone dissenter (14-1) on the Integrity Commissioner report.",
  },
  {
    id: "rf-03",
    category: "recent-facts",
    question:
      "Was Steve Peloza appointed to any committee at the March 3, 2026 council meeting?",
    mustContain: ["peloza", "infrastructure"],
    groundTruth:
      "Yes, Peloza was appointed to the ICSC (Investment and Economic Prosperity Committee or similar) at the March 3, 2026 meeting.",
  },
  {
    id: "rf-04",
    category: "recent-facts",
    question:
      "How did council vote on the Ridout Street development at the March 2026 meeting?",
    mustContain: ["ridout"],
    groundTruth:
      "The Ridout development was approved 11-4, with Hopkins, Trosow, Ferreira, and Rahman voting against.",
  },
  {
    id: "rf-05",
    category: "recent-facts",
    question:
      "Which councillors voted against the Ridout development approval in March 2026?",
    mustContain: ["hopkins", "trosow", "ferreira", "rahman"],
    groundTruth:
      "Hopkins, Trosow, Ferreira, and Rahman voted against the Ridout development (11-4 approval).",
  },
  {
    id: "rf-06",
    category: "recent-facts",
    question:
      "What was the OEV BIA reimbursement amount discussed at the March 3, 2026 council meeting?",
    mustContain: ["reimburs"],
    groundTruth:
      "The OEV BIA reimbursement amount was $14,152.33.",
  },
  {
    id: "rf-07",
    category: "recent-facts",
    question:
      "What happened to the original OEV BIA reimbursement motion in March 2026?",
    mustContain: ["fail"],
    groundTruth:
      "The original OEV BIA reimbursement motion failed 5-8.",
  },
  {
    id: "rf-08",
    category: "recent-facts",
    question:
      "What was the vote on Stevenson's alternative motion for the OEV BIA reimbursement?",
    mustContain: ["10", "3"],
    groundTruth:
      "Stevenson's alternative OEV BIA reimbursement motion passed 10-3.",
  },
  {
    id: "rf-09",
    category: "recent-facts",
    question:
      "How did council vote on the Municipal Access Agreement with Telus in March 2026?",
    mustContain: ["unanimous"],
    groundTruth:
      "The Municipal Access Agreement with Telus was unanimously amended.",
  },
  {
    id: "rf-10",
    category: "recent-facts",
    question:
      "Who dissented on the motion to extend the March 3, 2026 council meeting past 6pm?",
    mustContain: ["trosow"],
    groundTruth:
      "Trosow was the sole dissenter (12-1) on extending the meeting past 6pm.",
  },
  {
    id: "rf-11",
    category: "recent-facts",
    question:
      "What was the vote to extend the March 2026 council meeting past 6pm?",
    mustContain: ["12", "1"],
    groundTruth: "The vote to extend past 6pm passed 12-1, Trosow sole dissenter.",
  },
  {
    id: "rf-12",
    category: "recent-facts",
    question:
      "Who was the sole dissenter on the Housing Stability Report at the March 3, 2026 meeting?",
    mustContain: ["stevenson"],
    groundTruth:
      "Stevenson was the sole dissenter (12-1) on the Housing Stability Report.",
  },
  {
    id: "rf-13",
    category: "recent-facts",
    question:
      "What happened to Councillor Franke's parking study amendment at the March 2026 meeting?",
    mustContain: ["fail", "4", "10"],
    groundTruth:
      "Franke's parking study amendment failed 4-10.",
  },
  {
    id: "rf-14",
    category: "recent-facts",
    question:
      "How did Bills 105 and 123 (zoning) vote at the March 3, 2026 council meeting?",
    mustContain: ["8", "3"],
    groundTruth:
      "Bills 105/123 (zoning) passed 8-3.",
  },
  {
    id: "rf-15",
    category: "recent-facts",
    question:
      "What were the votes on Bills 108 and 109 at the March 3, 2026 London council meeting?",
    mustContain: ["108", "109"],
    groundTruth:
      "Bill 108 passed 9-2 (Stevenson and Rahman nay); Bill 109 passed 10-1 (Stevenson sole nay).",
  },

  // =========================================================================
  // CATEGORY: cross-meeting (10 cases)
  // =========================================================================
  {
    id: "cm-01",
    category: "cross-meeting",
    question:
      "Has Councillor Trosow been a consistent dissenter at recent London council meetings?",
    mustContain: ["trosow"],
    groundTruth:
      "Trosow dissented on multiple items at the March 3, 2026 meeting (Integrity Commissioner, Ridout development, extending past 6pm), suggesting a pattern of dissent.",
  },
  {
    id: "cm-02",
    category: "cross-meeting",
    question:
      "Which councillors have most frequently voted against development approvals recently?",
    mustContain: ["trosow"],
    groundTruth:
      "On the March 3, 2026 Ridout development vote, Hopkins, Trosow, Ferreira, and Rahman voted against. Trosow also dissented on other items.",
  },
  {
    id: "cm-03",
    category: "cross-meeting",
    question:
      "How has Councillor Stevenson's voting record differed from council majority recently?",
    mustContain: ["stevenson"],
    groundTruth:
      "Stevenson dissented on the Housing Stability Report (12-1), voted against Bill 108 and Bill 109. Stevenson also proposed the successful alternative OEV BIA reimbursement motion.",
  },
  {
    id: "cm-04",
    category: "cross-meeting",
    question:
      "What zoning or planning items has London council addressed in early 2026?",
    mustContain: ["2026"],
    groundTruth:
      "At the March 3, 2026 meeting, council addressed the Ridout development (approved 11-4) and Bills 105/123 related to zoning (passed 8-3).",
  },
  {
    id: "cm-05",
    category: "cross-meeting",
    question:
      "Can you summarize the key business improvement area (BIA) decisions at March 2026 council?",
    mustContain: ["bia"],
    groundTruth:
      "The OEV BIA reimbursement of $14,152.33 was discussed. The original motion failed 5-8, then Stevenson's alternative passed 10-3.",
  },
  {
    id: "cm-06",
    category: "cross-meeting",
    question:
      "What telecom infrastructure agreements has London council approved in 2026?",
    mustContain: ["fiber"],
    groundTruth:
      "The Municipal Access Agreement with Telus was unanimously amended at the March 3, 2026 meeting.",
  },
  {
    id: "cm-07",
    category: "cross-meeting",
    question:
      "How has council handled integrity and governance matters in early 2026?",
    mustContain: ["integrity"],
    groundTruth:
      "The Integrity Commissioner report was addressed on March 3, 2026, passing 14-1 with Trosow as sole dissenter.",
  },
  {
    id: "cm-08",
    category: "cross-meeting",
    question:
      "What housing-related decisions did London council make in March 2026?",
    mustContain: ["housing"],
    groundTruth:
      "The Housing Stability Report passed 12-1 at the March 3, 2026 meeting with Stevenson as sole dissenter.",
  },
  {
    id: "cm-09",
    category: "cross-meeting",
    question:
      "Give me a general picture of how divided London council was on March 3, 2026.",
    mustContain: ["march", "2026"],
    groundTruth:
      "Council showed mostly strong consensus (several near-unanimous votes) with scattered dissent. Trosow dissented on multiple items. A few closer votes (Ridout 11-4, BIA original 5-8, zoning 8-3).",
  },
  {
    id: "cm-10",
    category: "cross-meeting",
    question:
      "Which councillor proposed the successful alternative OEV BIA reimbursement motion?",
    mustContain: ["stevenson"],
    groundTruth:
      "Stevenson proposed the alternative OEV BIA reimbursement motion, which passed 10-3 after the original failed 5-8.",
  },

  // =========================================================================
  // CATEGORY: councillor (10 cases)
  // =========================================================================
  {
    id: "co-01",
    category: "councillor",
    question: "How many times did Councillor Trosow dissent on March 3, 2026?",
    mustContain: ["trosow"],
    groundTruth:
      "Trosow dissented at least three times: Integrity Commissioner report (14-1), Ridout development (11-4), and extending past 6pm (12-1).",
  },
  {
    id: "co-02",
    category: "councillor",
    question: "Did Councillor Rahman vote against any items on March 3, 2026?",
    mustContain: ["rahman"],
    groundTruth:
      "Rahman voted against the Ridout development (11-4) and against Bill 108 (9-2).",
  },
  {
    id: "co-03",
    category: "councillor",
    question:
      "What was Councillor Hopkins' voting record at the March 3, 2026 meeting?",
    mustContain: ["hopkins"],
    groundTruth:
      "Hopkins voted against the Ridout development (one of 4 nay votes in an 11-4 decision).",
  },
  {
    id: "co-04",
    category: "councillor",
    question:
      "On which items did Councillor Stevenson vote against the majority in March 2026?",
    mustContain: ["stevenson"],
    groundTruth:
      "Stevenson voted against the Housing Stability Report (12-1), Bill 108 (9-2), and Bill 109 (10-1).",
  },
  {
    id: "co-05",
    category: "councillor",
    question:
      "Did Councillor Ferreira support or oppose the Ridout development in March 2026?",
    mustContain: ["ferreira"],
    groundTruth:
      "Ferreira opposed the Ridout development, voting nay in the 11-4 approval.",
  },
  {
    id: "co-06",
    category: "councillor",
    question:
      "Which council appointment was made at the March 3, 2026 meeting and who was appointed?",
    mustContain: ["peloza", "infrastructure"],
    groundTruth:
      "Peloza was appointed to the ICSC at the March 3, 2026 meeting.",
  },
  {
    id: "co-07",
    category: "councillor",
    question:
      "Did Councillor Franke have any motions at the March 2026 meeting? What happened?",
    mustContain: ["franke"],
    groundTruth:
      "Franke put forward a parking study amendment that failed 4-10.",
  },
  {
    id: "co-08",
    category: "councillor",
    question:
      "Was there any councillor who dissented both on the Integrity Commissioner report and on extending the meeting past 6pm on March 3, 2026?",
    mustContain: ["trosow"],
    groundTruth:
      "Yes, Trosow dissented on both the Integrity Commissioner report (14-1) and the extension past 6pm (12-1).",
  },
  {
    id: "co-09",
    category: "councillor",
    question:
      "Which councillors voted nay on Bill 108 at the March 3, 2026 meeting?",
    mustContain: ["stevenson", "rahman"],
    groundTruth:
      "Stevenson and Rahman voted against Bill 108 (passed 9-2).",
  },
  {
    id: "co-10",
    category: "councillor",
    question:
      "Who was the only councillor to vote against Bill 109 on March 3, 2026?",
    mustContain: ["stevenson"],
    groundTruth:
      "Stevenson was the sole nay vote on Bill 109 (passed 10-1).",
  },

  // =========================================================================
  // CATEGORY: hard-edge (15+ cases)
  // =========================================================================
  {
    id: "he-01",
    category: "hard-edge",
    question:
      "Did the Ridout development pass unanimously at the March 3, 2026 council meeting?",
    mustContain: ["ridout"],
    mustNotContain: ["unanimous"],
    groundTruth:
      "No. The Ridout development passed 11-4, not unanimously. Hopkins, Trosow, Ferreira, and Rahman opposed it.",
  },
  {
    id: "he-02",
    category: "hard-edge",
    question:
      "Was the OEV BIA reimbursement motion approved or rejected at March 2026 council?",
    groundTruth:
      "The original motion failed 5-8. A Stevenson alternative passed 10-3. So the reimbursement was ultimately approved via the alternative.",
  },
  {
    id: "he-03",
    category: "hard-edge",
    question:
      "Did the Housing Stability Report pass unanimously in March 2026?",
    
    mustNotContain: ["unanimous"],
    groundTruth:
      "No. It passed 12-1 with Stevenson as sole dissenter.",
  },
  {
    id: "he-04",
    category: "hard-edge",
    question:
      "Was Franke's parking study amendment approved at the March 3, 2026 meeting?",
    mustContain: ["fail", "4", "10"],
    groundTruth:
      "No. Franke's parking study amendment failed 4-10.",
  },
  {
    id: "he-05",
    category: "hard-edge",
    question:
      "Was Bill 108 passed unanimously at the March 3, 2026 London council meeting?",
    mustNotContain: ["unanimous"],
    mustContain: ["9", "2"],
    groundTruth:
      "No. Bill 108 passed 9-2 with Stevenson and Rahman voting against.",
  },
  {
    id: "he-06",
    category: "hard-edge",
    question:
      "Tell me the exact dollar amount reimbursed via the OEV BIA decision in March 2026.",
    mustContain: ["14,152.33"],
    groundTruth:
      "The OEV BIA reimbursement amount was $14,152.33.",
  },
  {
    id: "he-07",
    category: "hard-edge",
    question:
      "Which councillors voted in favour of the Ridout development at the March 3, 2026 meeting?",
    mustNotContain: ["trosow", "ferreira", "rahman", "hopkins"],
    groundTruth:
      "The 11 yes votes did NOT include Hopkins, Trosow, Ferreira, or Rahman (those were the 4 nay votes). The chatbot should not list the nay voters as yes voters.",
  },
  {
    id: "he-08",
    category: "hard-edge",
    question:
      "Did Councillor Trosow vote for the Integrity Commissioner report on March 3, 2026?",
    mustContain: ["no", "14"],
    groundTruth:
      "No. Trosow was the lone dissenter (14-1) against the Integrity Commissioner report.",
  },
  {
    id: "he-09",
    category: "hard-edge",
    question:
      "Did Councillor Stevenson vote for or against the Housing Stability Report in March 2026?",
    mustContain: ["stevenson"],
    groundTruth:
      "Stevenson voted against the Housing Stability Report (sole dissenter, 12-1).",
  },
  {
    id: "he-10",
    category: "hard-edge",
    question:
      "Was there any vote at the March 3, 2026 meeting that failed completely (0 support)?",
    groundTruth:
      "No vote with zero support is recorded in the March 3, 2026 ground truth. The original OEV BIA motion failed 5-8 (5 did support it). The chatbot should not fabricate a 0-support vote.",
  },
  {
    id: "he-11",
    category: "hard-edge",
    question:
      "What was the vote count when council decided to extend the meeting beyond 6pm on March 3, 2026?",
    mustContain: ["12", "1"],
    groundTruth:
      "The extension past 6pm passed 12-1 with Trosow as sole dissenter.",
  },
  {
    id: "he-12",
    category: "hard-edge",
    question:
      "How many councillors voted against Bills 105 and 123 on March 3, 2026?",
    mustContain: ["3"],
    mustNotContain: ["four", "five", "2 "],
    groundTruth:
      "Bills 105/123 passed 8-3, so 3 councillors voted against.",
  },
  {
    id: "he-13",
    category: "hard-edge",
    question:
      "Was the Telus Municipal Access Agreement rejected by council in March 2026?",
    mustNotContain: ["denied"],
    groundTruth:
      "No. The Municipal Access Agreement with Telus was unanimously amended (approved, not rejected).",
  },
  {
    id: "he-14",
    category: "hard-edge",
    question:
      "Did the original OEV BIA reimbursement motion pass at the March 3, 2026 council meeting?",
    mustContain: ["fail"],
    mustNotContain: ["yes"],
    groundTruth:
      "The ORIGINAL OEV BIA reimbursement motion FAILED 5-8. Only the Stevenson alternative later passed 10-3.",
  },
  {
    id: "he-15",
    category: "hard-edge",
    question:
      "Did Councillor Rahman support the Ridout development on March 3, 2026?",
    mustContain: ["rahman"],
    groundTruth:
      "Rahman voted against the Ridout development (it passed 11-4 with Rahman as one of the four nay votes).",
  },
  {
    id: "he-16",
    category: "hard-edge",
    question:
      "How many items did Councillor Trosow dissent on at the March 3, 2026 meeting?",
    mustContain: ["trosow"],
    groundTruth:
      "Trosow dissented on at least 3 items: Integrity Commissioner (14-1), Ridout development (11-4), and extending past 6pm (12-1).",
  },
  {
    id: "he-17",
    category: "hard-edge",
    question:
      "Was Councillor Peloza involved in any controversial votes at the March 3, 2026 meeting?",
    mustContain: ["peloza"],
    groundTruth:
      "The primary record of Peloza at the March 3 meeting is an appointment to the ICSC. The chatbot should not fabricate controversies.",
  },
];

// ---------------------------------------------------------------------------
// Build tests
// ---------------------------------------------------------------------------
const byCategory = TEST_CASES.reduce<Record<string, TestCase[]>>((acc, tc) => {
  (acc[tc.category] ??= []).push(tc);
  return acc;
}, {});

describe("OpenCouncil Accuracy – March 3 2026", { timeout: 1800000 }, () => {
  before(() => {
    console.log(`\n🗳️  OpenCouncil Accuracy Test Suite`);
    console.log(`   API: ${API_URL}`);
    console.log(`   Judge mode: ${JUDGE_MODE}`);
    console.log(`   Total cases: ${TEST_CASES.length}\n`);
  });

  for (const [category, cases] of Object.entries(byCategory)) {
    describe(`Category: ${category} (${cases.length} cases)`, () => {
      for (const tc of cases) {
        test(`[${tc.id}] ${tc.question.slice(0, 80)}`, { timeout: TIMEOUT_MS }, async () => {
          await runTestCase(tc);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Smoke test – basic connectivity
// ---------------------------------------------------------------------------
describe("Smoke", { timeout: TIMEOUT_MS }, () => {
  test("API responds to a basic council question", async () => {
    const response = await askChatbot(
      "When was the most recent London city council meeting you have data for?"
    );
    assert.ok(response.length > 0, "Should return a non-empty response");
    console.log(`  Smoke response: ${response.slice(0, 120)}...`);
  });
});
