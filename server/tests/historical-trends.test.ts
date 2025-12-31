/**
 * Historical Trends Query Test Cases
 *
 * These test cases verify the chatbot's ability to answer questions about
 * how council discussions on specific topics have evolved over time.
 *
 * Data coverage: 2011-2025 (London City Council meeting records)
 *
 * Note: These are manual test cases with expected answer criteria.
 * Run these tests by querying the chatbot and evaluating responses
 * against the expected answer notes.
 */

import test, { describe } from "node:test";
import assert from "node:assert";

/**
 * Test case structure for historical trend queries
 */
interface HistoricalTrendTestCase {
  /** The question to ask the chatbot */
  question: string;
  /** Topic category for grouping */
  category: string;
  /** What a good answer should contain */
  expectedAnswerNotes: string[];
  /** Approximate date range the answer should cover */
  expectedDateRange: {
    start: string;
    end: string;
  };
  /** Minimum number of meetings/discussions expected to be referenced */
  minimumReferencesExpected: number;
}

/**
 * Historical trend test cases organized by topic category
 */
export const historicalTrendTestCases: HistoricalTrendTestCase[] = [
  // ============================================
  // CYCLING AND BIKE INFRASTRUCTURE
  // ============================================
  {
    question: "What has council discussed about bike lanes since 2020?",
    category: "Transportation - Cycling",
    expectedAnswerNotes: [
      "Should reference Civic Works Committee discussions",
      "Should mention specific bike lane projects or locations",
      "Should include council decisions on cycling infrastructure",
      "May reference the cycling master plan or network expansion",
      "Should cover discussions from 2020-2024/2025",
    ],
    expectedDateRange: { start: "2020-01", end: "2025-12" },
    minimumReferencesExpected: 5,
  },
  {
    question: "How has council's stance on cycling infrastructure changed over time?",
    category: "Transportation - Cycling",
    expectedAnswerNotes: [
      "Should show evolution of cycling policy from 2011-present",
      "Should reference early discussions (2011-2015) vs recent ones (2020+)",
      "Should mention any major policy shifts or plan adoptions",
      "Should reference protected bike lanes vs painted lanes debates",
      "May include budget allocations for cycling over the years",
    ],
    expectedDateRange: { start: "2011-01", end: "2025-12" },
    minimumReferencesExpected: 8,
  },
  {
    question: "How many times has cycling or bike lanes been discussed in the past 3 years?",
    category: "Transportation - Cycling",
    expectedAnswerNotes: [
      "Should provide an approximate count of meetings",
      "Should reference Civic Works Committee as primary venue",
      "May mention Planning and Environment Committee discussions",
      "Should indicate whether discussions were frequent or infrequent",
      "Should cite specific years (2022, 2023, 2024/2025)",
    ],
    expectedDateRange: { start: "2022-01", end: "2025-12" },
    minimumReferencesExpected: 10,
  },

  // ============================================
  // AFFORDABLE HOUSING
  // ============================================
  {
    question: "How has council addressed affordable housing over the past decade?",
    category: "Housing",
    expectedAnswerNotes: [
      "Should reference Housing Development Corporation discussions",
      "Should mention London & Middlesex Community Housing",
      "Should include policy discussions about housing affordability",
      "Should reference budget allocations for affordable housing",
      "May mention housing stability plan or similar initiatives",
    ],
    expectedDateRange: { start: "2014-01", end: "2025-12" },
    minimumReferencesExpected: 10,
  },
  {
    question: "What affordable housing initiatives has council approved since 2019?",
    category: "Housing",
    expectedAnswerNotes: [
      "Should list specific housing projects or developments approved",
      "Should mention funding amounts or sources",
      "May reference partnerships with provincial/federal programs",
      "Should include decisions from Strategic Priorities and Policy Committee",
      "May reference community housing annual meetings",
    ],
    expectedDateRange: { start: "2019-01", end: "2025-12" },
    minimumReferencesExpected: 6,
  },
  {
    question: "How has the housing crisis discussion evolved in council meetings?",
    category: "Housing",
    expectedAnswerNotes: [
      "Should show increasing urgency in discussions over time",
      "Should reference specific crisis-related motions or reports",
      "May mention homelessness in connection with housing",
      "Should indicate how frequently the topic is discussed now vs earlier",
      "May reference emergency housing measures",
    ],
    expectedDateRange: { start: "2015-01", end: "2025-12" },
    minimumReferencesExpected: 8,
  },

  // ============================================
  // HOMELESSNESS
  // ============================================
  {
    question: "What has council discussed about homelessness and encampments since 2018?",
    category: "Homelessness",
    expectedAnswerNotes: [
      "Should reference Community and Protective Services Committee discussions",
      "Should mention specific policies on encampments",
      "Should include shelter capacity discussions",
      "May reference emergency measures especially during COVID-19",
      "Should show increasing discussion frequency in recent years",
    ],
    expectedDateRange: { start: "2018-01", end: "2025-12" },
    minimumReferencesExpected: 8,
  },
  {
    question: "How has council's approach to homelessness changed over the past 5 years?",
    category: "Homelessness",
    expectedAnswerNotes: [
      "Should compare approaches from 2019-2020 vs 2023-2025",
      "Should mention any strategy documents or plans adopted",
      "May reference housing-first approaches",
      "Should include budget allocations for homeless services",
      "May mention coordination with other organizations (MLHU, etc.)",
    ],
    expectedDateRange: { start: "2020-01", end: "2025-12" },
    minimumReferencesExpected: 6,
  },

  // ============================================
  // CLIMATE AND ENVIRONMENT
  // ============================================
  {
    question: "How has council discussed climate change and environmental policy since 2015?",
    category: "Environment",
    expectedAnswerNotes: [
      "Should reference climate emergency declaration if applicable",
      "Should mention environmental assessments",
      "May include discussions about emissions reduction",
      "Should reference Planning and Environment Committee",
      "May mention net-zero targets or climate action plans",
    ],
    expectedDateRange: { start: "2015-01", end: "2025-12" },
    minimumReferencesExpected: 8,
  },
  {
    question: "What environmental initiatives has council approved in the past 3 years?",
    category: "Environment",
    expectedAnswerNotes: [
      "Should list specific environmental projects or policies",
      "May include urban forest/tree planting initiatives",
      "Should mention any greenhouse gas reduction measures",
      "May reference stormwater management or green infrastructure",
      "Should include relevant budget items",
    ],
    expectedDateRange: { start: "2022-01", end: "2025-12" },
    minimumReferencesExpected: 5,
  },

  // ============================================
  // TRANSIT AND TRANSPORTATION
  // ============================================
  {
    question: "What has council discussed about transit and bus rapid transit?",
    category: "Transportation - Transit",
    expectedAnswerNotes: [
      "Should reference London Transit Commission discussions",
      "Should mention BRT (Bus Rapid Transit) plans",
      "May include rapid transit environmental assessments",
      "Should cover discussions spanning multiple years",
      "May reference transit funding from other levels of government",
    ],
    expectedDateRange: { start: "2015-01", end: "2025-12" },
    minimumReferencesExpected: 10,
  },
  {
    question: "How has the rapid transit project evolved through council discussions?",
    category: "Transportation - Transit",
    expectedAnswerNotes: [
      "Should show chronological progression of the project",
      "Should reference key decision points and votes",
      "May include route discussions and changes",
      "Should mention funding agreements",
      "May reference public consultation feedback",
    ],
    expectedDateRange: { start: "2017-01", end: "2025-12" },
    minimumReferencesExpected: 8,
  },

  // ============================================
  // BUDGET AND TAXES
  // ============================================
  {
    question: "How has council discussed property tax increases over the years?",
    category: "Budget and Finance",
    expectedAnswerNotes: [
      "Should reference annual budget discussions",
      "Should mention specific tax rate percentages discussed",
      "Should include Strategic Priorities and Policy Committee discussions",
      "May reference multi-year budgets",
      "Should show pattern of discussions around budget time",
    ],
    expectedDateRange: { start: "2015-01", end: "2025-12" },
    minimumReferencesExpected: 10,
  },
  {
    question: "What were the major budget debates in the past 5 years?",
    category: "Budget and Finance",
    expectedAnswerNotes: [
      "Should identify contentious budget items",
      "Should reference Budget Committee meetings",
      "May mention specific service area funding debates",
      "Should include tax rate discussions",
      "May reference COVID-19 impact on budgets (2020-2021)",
    ],
    expectedDateRange: { start: "2020-01", end: "2025-12" },
    minimumReferencesExpected: 8,
  },

  // ============================================
  // DEVELOPMENT AND ZONING
  // ============================================
  {
    question: "How has council addressed intensification and infill development?",
    category: "Development",
    expectedAnswerNotes: [
      "Should reference Planning and Environment Committee",
      "Should mention official plan policies",
      "May include specific neighbourhood discussions",
      "Should reference zoning bylaw amendments",
      "May mention density bonus policies",
    ],
    expectedDateRange: { start: "2012-01", end: "2025-12" },
    minimumReferencesExpected: 10,
  },
  {
    question: "What rezoning decisions has council made in the downtown area since 2020?",
    category: "Development",
    expectedAnswerNotes: [
      "Should list specific rezoning applications",
      "Should reference downtown/core area specifically",
      "May include mixed-use development approvals",
      "Should mention Planning and Environment Committee",
      "May reference official plan amendments",
    ],
    expectedDateRange: { start: "2020-01", end: "2025-12" },
    minimumReferencesExpected: 5,
  },

  // ============================================
  // DEVELOPMENT CHARGES
  // ============================================
  {
    question: "How has council discussed development charges over the years?",
    category: "Development Finance",
    expectedAnswerNotes: [
      "Should reference development charges bylaw reviews",
      "Should mention rate changes or updates",
      "May include discussions about exemptions or reductions",
      "Should reference impact on housing affordability",
      "May mention provincial legislation changes",
    ],
    expectedDateRange: { start: "2011-01", end: "2025-12" },
    minimumReferencesExpected: 8,
  },

  // ============================================
  // DOWNTOWN AND DUNDAS PLACE
  // ============================================
  {
    question: "What has council discussed about downtown revitalization and Dundas Place?",
    category: "Downtown",
    expectedAnswerNotes: [
      "Should reference Dundas Place flex street project",
      "Should mention downtown investment strategies",
      "May include business improvement area discussions",
      "Should reference Civic Works Committee discussions",
      "May mention pedestrianization or shared street concepts",
    ],
    expectedDateRange: { start: "2015-01", end: "2025-12" },
    minimumReferencesExpected: 6,
  },

  // ============================================
  // POLICE AND PUBLIC SAFETY
  // ============================================
  {
    question: "How has council discussed police services and public safety over the past decade?",
    category: "Public Safety",
    expectedAnswerNotes: [
      "Should reference London Police Services Board",
      "Should mention police budget discussions",
      "May include community safety initiatives",
      "Should reference Community and Protective Services Committee",
      "May mention 2020 discussions following Black Lives Matter movement",
    ],
    expectedDateRange: { start: "2014-01", end: "2025-12" },
    minimumReferencesExpected: 8,
  },

  // ============================================
  // RECREATION AND PARKS
  // ============================================
  {
    question: "What recreation facility decisions has council made in recent years?",
    category: "Recreation",
    expectedAnswerNotes: [
      "Should reference arenas, pools, or community centres",
      "Should mention Parks and Recreation discussions",
      "May include facility renewal or replacement projects",
      "Should reference Community and Protective Services Committee",
      "May mention recreation master plan",
    ],
    expectedDateRange: { start: "2018-01", end: "2025-12" },
    minimumReferencesExpected: 5,
  },

  // ============================================
  // INFRASTRUCTURE
  // ============================================
  {
    question: "How has council addressed water and sewer infrastructure needs?",
    category: "Infrastructure",
    expectedAnswerNotes: [
      "Should reference Civic Works Committee discussions",
      "Should mention infrastructure funding or investment",
      "May include specific capital projects",
      "Should reference asset management discussions",
      "May mention rate increases for water/sewer",
    ],
    expectedDateRange: { start: "2015-01", end: "2025-12" },
    minimumReferencesExpected: 8,
  },

  // ============================================
  // TEMPORAL FREQUENCY QUERIES
  // ============================================
  {
    question: "How often has affordable housing been discussed in the past year?",
    category: "Housing - Frequency",
    expectedAnswerNotes: [
      "Should provide approximate count of discussions",
      "Should identify which committees discussed it most",
      "Should indicate if frequency is high, medium, or low",
      "May compare to previous years if data available",
      "Should mention recent policy focus areas",
    ],
    expectedDateRange: { start: "2024-01", end: "2025-12" },
    minimumReferencesExpected: 4,
  },
  {
    question: "How many times has homelessness been brought up in council in 2023?",
    category: "Homelessness - Frequency",
    expectedAnswerNotes: [
      "Should provide count or estimate of discussions",
      "Should identify primary committees involved",
      "May mention specific recurring agenda items",
      "Should indicate prominence of the issue",
      "May reference specific motions or reports",
    ],
    expectedDateRange: { start: "2023-01", end: "2023-12" },
    minimumReferencesExpected: 6,
  },

  // ============================================
  // COMPARATIVE/EVOLUTION QUERIES
  // ============================================
  {
    question:
      "Compare how council discussed housing in 2015 versus 2023. What changed?",
    category: "Housing - Comparative",
    expectedAnswerNotes: [
      "Should reference specific discussions from both years",
      "Should identify shifts in priorities or approach",
      "Should note changes in urgency or frequency",
      "May mention new programs or initiatives in 2023 not present in 2015",
      "Should indicate evolution of housing policy",
    ],
    expectedDateRange: { start: "2015-01", end: "2023-12" },
    minimumReferencesExpected: 6,
  },
  {
    question:
      "Has the council's focus on climate issues increased since 2018?",
    category: "Environment - Trend",
    expectedAnswerNotes: [
      "Should compare discussion frequency 2018 vs now",
      "Should mention climate emergency declaration if applicable",
      "Should reference specific policy adoptions",
      "Should indicate whether focus has increased, decreased, or stayed same",
      "May include budget allocations for climate initiatives",
    ],
    expectedDateRange: { start: "2018-01", end: "2025-12" },
    minimumReferencesExpected: 5,
  },
];

// ============================================
// TEST RUNNER STRUCTURE
// ============================================

describe("Historical Trend Queries", () => {
  describe("Test Case Validation", () => {
    test("all test cases have required fields", () => {
      for (const testCase of historicalTrendTestCases) {
        assert(testCase.question, "Test case must have a question");
        assert(testCase.category, "Test case must have a category");
        assert(
          testCase.expectedAnswerNotes.length > 0,
          "Test case must have expected answer notes"
        );
        assert(
          testCase.expectedDateRange.start,
          "Test case must have start date"
        );
        assert(testCase.expectedDateRange.end, "Test case must have end date");
        assert(
          testCase.minimumReferencesExpected > 0,
          "Test case must expect at least one reference"
        );
      }
    });

    test("all date ranges are valid", () => {
      for (const testCase of historicalTrendTestCases) {
        const start = new Date(testCase.expectedDateRange.start);
        const end = new Date(testCase.expectedDateRange.end);
        assert(
          !isNaN(start.getTime()),
          `Invalid start date in test: ${testCase.question}`
        );
        assert(
          !isNaN(end.getTime()),
          `Invalid end date in test: ${testCase.question}`
        );
        assert(
          start <= end,
          `Start date must be before end date in test: ${testCase.question}`
        );
      }
    });

    test("test cases cover expected topic categories", () => {
      const categories = new Set(historicalTrendTestCases.map((tc) => tc.category));

      // Verify we have diverse coverage
      assert(
        categories.has("Transportation - Cycling"),
        "Should have cycling tests"
      );
      assert(categories.has("Housing"), "Should have housing tests");
      assert(categories.has("Homelessness"), "Should have homelessness tests");
      assert(categories.has("Environment"), "Should have environment tests");
      assert(
        categories.has("Transportation - Transit"),
        "Should have transit tests"
      );
      assert(
        categories.has("Budget and Finance"),
        "Should have budget tests"
      );
      assert(categories.has("Development"), "Should have development tests");
    });

    test("test cases include temporal queries", () => {
      const temporalQueries = historicalTrendTestCases.filter(
        (tc) =>
          tc.question.includes("how many times") ||
          tc.question.includes("how often") ||
          tc.question.includes("frequency")
      );
      assert(
        temporalQueries.length >= 2,
        "Should have at least 2 temporal frequency queries"
      );
    });

    test("test cases include comparative queries", () => {
      const comparativeQueries = historicalTrendTestCases.filter(
        (tc) =>
          tc.question.toLowerCase().includes("compare") ||
          tc.question.toLowerCase().includes("changed") ||
          tc.question.toLowerCase().includes("evolved") ||
          tc.question.toLowerCase().includes("increased")
      );
      assert(
        comparativeQueries.length >= 3,
        "Should have at least 3 comparative/evolution queries"
      );
    });
  });
});

// ============================================
// HELPER FUNCTIONS FOR MANUAL TESTING
// ============================================

/**
 * Prints test cases in a format suitable for manual testing
 */
export function printTestCasesForManualTesting(): void {
  console.log("\n=== HISTORICAL TREND TEST CASES ===\n");
  console.log("Data Coverage: 2011-2025\n");

  const byCategory = historicalTrendTestCases.reduce(
    (acc, tc) => {
      const cat = tc.category.split(" - ")[0];
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(tc);
      return acc;
    },
    {} as Record<string, HistoricalTrendTestCase[]>
  );

  for (const [category, cases] of Object.entries(byCategory)) {
    console.log(`\n## ${category.toUpperCase()}\n`);

    for (const tc of cases) {
      console.log(`Question: "${tc.question}"`);
      console.log(`Date Range: ${tc.expectedDateRange.start} to ${tc.expectedDateRange.end}`);
      console.log(`Expected References: ${tc.minimumReferencesExpected}+`);
      console.log("Expected Answer Should:");
      for (const note of tc.expectedAnswerNotes) {
        console.log(`  - ${note}`);
      }
      console.log("");
    }
  }
}

/**
 * Validates a chatbot response against a test case
 * Returns a score and notes about what was present/missing
 */
export function evaluateResponse(
  testCase: HistoricalTrendTestCase,
  response: string
): { score: number; maxScore: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;
  const maxScore = testCase.expectedAnswerNotes.length + 2; // +2 for date range and references

  // Check for date references
  const datePattern = /\b(20\d{2}|201\d|202\d)\b/g;
  const datesFound = response.match(datePattern) || [];
  if (datesFound.length >= 2) {
    score += 1;
    notes.push(`[PASS] Found ${datesFound.length} date references`);
  } else {
    notes.push(`[FAIL] Insufficient date references (found ${datesFound.length})`);
  }

  // Check for meeting/committee references
  const meetingPatterns = [
    /council/i,
    /committee/i,
    /meeting/i,
    /civic works/i,
    /planning/i,
    /strategic priorities/i,
  ];
  const meetingRefsFound = meetingPatterns.filter((p) => p.test(response)).length;
  if (meetingRefsFound >= 2) {
    score += 1;
    notes.push(`[PASS] Found ${meetingRefsFound} meeting/committee references`);
  } else {
    notes.push(`[FAIL] Insufficient meeting references (found ${meetingRefsFound})`);
  }

  // Check expected answer notes (simplified keyword matching)
  for (const expectedNote of testCase.expectedAnswerNotes) {
    // Extract key concepts from the note
    const notePresent = checkNotePresence(expectedNote, response);
    if (notePresent) {
      score += 1;
      notes.push(`[PASS] ${expectedNote}`);
    } else {
      notes.push(`[FAIL] ${expectedNote}`);
    }
  }

  return { score, maxScore, notes };
}

/**
 * Simple heuristic to check if an expected concept is present in response
 */
function checkNotePresence(note: string, response: string): boolean {
  const lowerResponse = response.toLowerCase();
  const lowerNote = note.toLowerCase();

  // Extract keywords from the note
  const keywords = lowerNote
    .replace(/should|may|reference|mention|include|indicate/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 4);

  // Check if at least 30% of keywords are present
  const presentCount = keywords.filter((kw) => lowerResponse.includes(kw)).length;
  return presentCount / keywords.length >= 0.3;
}

// Export for use in other test files
export type { HistoricalTrendTestCase };
