// Test script to verify recent meetings are in the RAG database
// Run with: npx tsx scraping/test-recent-meetings.ts

const API_URL = "https://open-council-production.up.railway.app";

interface TestCase {
  name: string;
  query: string;
  expectedKeywords: string[];
  meetingDate: string;
}

const tests: TestCase[] = [
  {
    name: "Dec 2 Planning - 56 Albion Street Heritage",
    query: "What happened with the heritage alteration permit for 56 Albion Street in December 2025?",
    expectedKeywords: ["albion", "heritage", "transom", "blackfriars", "door"],
    meetingDate: "2025-12-02"
  },
  {
    name: "Dec 2 Planning - 455 Highbury Avenue Zoning",
    query: "What was decided about 455 Highbury Avenue North zoning in December 2025?",
    expectedKeywords: ["highbury", "zoning", "industrial", "self storage", "brydges"],
    meetingDate: "2025-12-02"
  },
  {
    name: "Nov 19 Audit - ARAO Audit",
    query: "What did the Audit Committee discuss about the Anti-Racism and Anti-Oppression audit in November 2025?",
    expectedKeywords: ["arao", "anti-racism", "mnp", "audit"],
    meetingDate: "2025-11-19"
  },
  {
    name: "Nov 19 Audit - Health Unit Financials",
    query: "What was reported about the Middlesex-London Health Unit financial statements at the Audit Committee?",
    expectedKeywords: ["middlesex", "health unit", "financial", "2024"],
    meetingDate: "2025-11-19"
  },
  {
    name: "Nov 4 Council - Pecuniary Interest",
    query: "Did any councillor declare a pecuniary interest at the November 4, 2025 Council meeting?",
    expectedKeywords: ["rahman", "pecuniary", "wellington", "st. joseph"],
    meetingDate: "2025-11-04"
  }
];

async function runTest(test: TestCase): Promise<{ passed: boolean; details: string }> {
  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: test.query,
        conversationHistory: []
      })
    });

    if (!response.ok) {
      return { passed: false, details: `HTTP ${response.status}: ${response.statusText}` };
    }

    // Read streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      return { passed: false, details: "No response body" };
    }

    let fullResponse = "";
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullResponse += parsed.content;
            }
          } catch {}
        }
      }
    }

    const responseLower = fullResponse.toLowerCase();
    const foundKeywords = test.expectedKeywords.filter(kw =>
      responseLower.includes(kw.toLowerCase())
    );

    const passed = foundKeywords.length >= Math.ceil(test.expectedKeywords.length / 2);

    return {
      passed,
      details: `Found ${foundKeywords.length}/${test.expectedKeywords.length} keywords: [${foundKeywords.join(", ")}]\nResponse preview: ${fullResponse.slice(0, 300)}...`
    };
  } catch (error) {
    return { passed: false, details: `Error: ${error}` };
  }
}

async function main() {
  console.log("🧪 Testing Recent Meetings in RAG Database\n");
  console.log(`API: ${API_URL}\n`);
  console.log("=".repeat(60) + "\n");

  let passCount = 0;

  for (const test of tests) {
    console.log(`📋 ${test.name}`);
    console.log(`   Query: "${test.query}"`);
    console.log(`   Expected date: ${test.meetingDate}`);

    const result = await runTest(test);

    if (result.passed) {
      console.log(`   ✅ PASSED`);
      passCount++;
    } else {
      console.log(`   ❌ FAILED`);
    }
    console.log(`   ${result.details.split("\n").join("\n   ")}`);
    console.log("");
  }

  console.log("=".repeat(60));
  console.log(`\n📊 Results: ${passCount}/${tests.length} tests passed\n`);

  if (passCount === tests.length) {
    console.log("🎉 All tests passed! Recent meetings are in the database.");
  } else if (passCount === 0) {
    console.log("⚠️  No tests passed. The recent meetings may not be embedded yet.");
    console.log("   Check Railway deployment status or trigger a redeploy.");
  } else {
    console.log("⚠️  Some tests failed. Partial data may be available.");
  }
}

main();
