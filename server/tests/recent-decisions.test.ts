/**
 * Test cases for recent council decisions (December 2025 and late November 2025)
 *
 * These test cases are based on verified data from the meeting JSON files in the data/ directory.
 * Each test includes a question that a user might ask and the verified correct answer
 * based on the actual meeting transcripts and news coverage.
 *
 * Data sources:
 * - /data/2025-12/2025-12-16-Council.json
 * - /data/2025-12/2025-12-09-Strategic Priorities and Policy Committee.json
 * - /data/2025-12/2025-12-01-Community and Protective Services Committee.json
 * - /data/2025-11/2025-11-25-Council.json
 * - /data/2025-11/2025-11-26-Council.json
 */

import test, { describe } from "node:test";
import assert from "node:assert";

interface TestCase {
  question: string;
  expectedAnswer: string;
  meetingDate: string;
  meetingType: string;
  keyTopics: string[];
}

/**
 * December 16, 2025 Council Meeting Test Cases
 * Source: /data/2025-12/2025-12-16-Council.json
 */
export const december16CouncilTestCases: TestCase[] = [
  {
    question: "What decisions were made at the December 16, 2025 council meeting?",
    expectedAnswer: `Key decisions from the December 16, 2025 Council meeting include:
1. Conservation Authority Amalgamation: Council voted against (4-8) a motion opposing the provincial proposal to amalgamate conservation authorities across Ontario. The motion was brought by Councillor Frank.
2. 1164-1170 Richmond Street Development: Council voted (10-2) to refuse a 21-story development application. Staff indicated a 15-story version within policy framework could be approved if resubmitted.
3. Urban Growth Boundary Review: Council approved the final urban growth boundary expansion (9-3 on main motion, 7-5 on Deputy Mayor Lewis's additions), despite concerns about First Nations consultation.
4. Committee of Adjustment Meetings: Council approved (12-0) video recording of Committee of Adjustment meetings and posting them on YouTube, with staff to report back on live streaming feasibility.
5. State of Emergency Request: Council voted (10-2) in favor of asking the province to declare a state of emergency related to the homelessness crisis.`,
    meetingDate: "2025-12-16",
    meetingType: "Council",
    keyTopics: [
      "conservation authority amalgamation",
      "1164-1170 Richmond Street",
      "urban growth boundary",
      "committee of adjustment",
      "state of emergency"
    ]
  },
  {
    question: "Did council approve the 21-story development at 1164-1170 Richmond Street?",
    expectedAnswer: `No, council refused the 21-story development application for 1164-1170 Richmond Street by a vote of 10-2 at the December 16, 2025 meeting.

The staff report had identified a "path to approval" for a 15-story version that would comply with the policy framework. Councillor Stevenson attempted a referral to consider approving 15 stories, but this failed 1-2-11. Deputy Mayor Lewis noted he would support a 15-story application if resubmitted properly.

The site is currently approved for up to 15 stories under the existing planning framework, and staff indicated the applicant could submit a new application at that height.`,
    meetingDate: "2025-12-16",
    meetingType: "Council",
    keyTopics: ["1164-1170 Richmond Street", "zoning", "development", "height", "refusal"]
  },
  {
    question: "What was the vote on the conservation authority amalgamation motion?",
    expectedAnswer: `The motion opposing the provincial proposal to amalgamate conservation authorities failed by a vote of 4-8 at the December 16, 2025 council meeting.

Councillor Frank brought the motion requesting council support a resolution opposing the province's proposed amalgamation of conservation authorities. The motion was amended to include references to Kettle Creek and Lower Thames Conservation Authorities in addition to Upper Thames.

Those in favor argued for maintaining local control and expertise over watersheds. Those opposed, including Deputy Mayor Lewis and Mayor Morgan, cited frustrations with the current conservation authority system, including an 8-year delay on floodplain mapping updates. Mayor Morgan indicated he would prefer to have discussions with other municipal mayors before taking a position.`,
    meetingDate: "2025-12-16",
    meetingType: "Council",
    keyTopics: [
      "conservation authority",
      "amalgamation",
      "Upper Thames",
      "Kettle Creek",
      "Lower Thames"
    ]
  },
  {
    question: "Was the urban growth boundary expansion approved?",
    expectedAnswer: `Yes, the urban growth boundary expansion was approved at the December 16, 2025 council meeting, though with some divided votes.

Deputy Mayor Lewis's additions (clauses I and II) passed 7-5. The balance of the clauses passed 9-3. Councillor Frank and Councillor Trosow voted against the motion.

Councillor Trosow raised concerns about First Nations consultation, referencing a letter requesting further consultation, and attempted to move council into closed session to discuss solicitor-client privilege regarding the duty to consult. This motion failed 5-7.

Mayor Morgan addressed these concerns, stating he had spoken with the Chief of Chippewas of the Thames who was primarily concerned about protecting lands within the expansion area. Morgan noted that nothing in the decision precludes indigenous communities from engaging about bringing lands into the boundary for indigenous purposes in the future.`,
    meetingDate: "2025-12-16",
    meetingType: "Council",
    keyTopics: [
      "urban growth boundary",
      "First Nations",
      "consultation",
      "Chippewas of the Thames"
    ]
  },
  {
    question: "Who was recognized at the December 16, 2025 council meeting?",
    expectedAnswer: `At the December 16, 2025 council meeting, Councillor Pribble recognized Alfredo Kachai, who was appointed to the Order of Canada. Alfredo is described as an immigrant refugee who came to London and has been bringing joy to the community through Sunfest for over 30 years. His events bring over 100,000 people to Sunfest and over 40 bands each year.

The national anthem was performed by Rebecca Bertie, a choirster with Annabelle and Royal Conservatory trained pianist and classical flutist who performs emo rock, punk, and indie folk music.`,
    meetingDate: "2025-12-16",
    meetingType: "Council",
    keyTopics: ["Alfredo Kachai", "Order of Canada", "Sunfest", "recognition"]
  }
];

/**
 * December 9, 2025 Strategic Priorities and Policy Committee Test Cases
 * Source: /data/2025-12/2025-12-09-Strategic Priorities and Policy Committee.json
 */
export const december9SPPCTestCases: TestCase[] = [
  {
    question: "What was discussed at the December 9, 2025 SPPC meeting about the micromodular shelter site?",
    expectedAnswer: `The December 9, 2025 Strategic Priorities and Policy Committee meeting focused on the micromodular shelter site update for the Wilton Grove location.

Key concerns raised by delegations included:
1. Location concerns - the site is at the edge of the city beside Highway 401
2. The contract was awarded to Xpera, a private security firm with no experience in the homelessness sector
3. Concerns about relying on resource-strapped charities to supplement what the operator cannot provide
4. Transportation access for residents
5. Emergency services response times
6. Isolation from community services and supports

Staff provided updates on:
- LTC transit - a bus stop exists about 180 meters from the entrance, with potential for additional stop in spring
- Xpera has committed to providing dedicated transportation services for residents
- A community partners meeting with Xpera was scheduled for December 18, 2025
- Emergency services (police, fire, EMS) have been engaged since the project started

Councillor Trosow moved an amendment requesting reports on transit, emergency services, and community service provider engagement. The contract is for 16 months, with seven million dollars allocated for the temporary solution.`,
    meetingDate: "2025-12-09",
    meetingType: "Strategic Priorities and Policy Committee",
    keyTopics: [
      "micromodular shelter",
      "Wilton Grove",
      "Xpera",
      "homelessness",
      "transportation"
    ]
  },
  {
    question: "What concerns were raised about the Xpera contract for the homeless shelter?",
    expectedAnswer: `Several concerns were raised about the Xpera contract for operating the Wilton Grove micromodular shelter site at the December 9, 2025 SPPC meeting:

1. Lack of sector expertise: Delegations noted Xpera's strengths are in logistics and security, not supportive housing, trauma-informed practice, or community building.

2. Reliance on charities: The expectation that other agencies would fill gaps in what the operator cannot provide was concerning given their already stretched capacities.

3. Safety concerns: Speakers highlighted the need for expertise in overdose response, safety planning, cultural understanding for indigenous populations, and stabilization support.

4. Contract cost concerns: One delegation noted that Xpera's federal contracts have historically included amendments increasing contract value beyond original awards (citing a Quebec housing contract that increased from $12.6M to $22.4M, a 78% rise).

5. Ownership change: Xpera was acquired by Weathervane Investments in May 2025, raising questions about organizational continuity.

6. Location isolation: The site's location beside the 401 highway removes residents from community services and support networks.

Staff responded that Xpera has committed to providing transportation services and that a community partners meeting was scheduled for December 18th to coordinate with local service providers.`,
    meetingDate: "2025-12-09",
    meetingType: "Strategic Priorities and Policy Committee",
    keyTopics: [
      "Xpera",
      "micromodular shelter",
      "security contractor",
      "homelessness services"
    ]
  }
];

/**
 * November 25-26, 2025 Council Meeting Test Cases
 * Source: /data/2025-11/2025-11-25-Council.json and /data/2025-11/2025-11-26-Council.json
 */
export const novemberCouncilTestCases: TestCase[] = [
  {
    question: "What happened with the e-scooter pilot at the November 25, 2025 council meeting?",
    expectedAnswer: `At the November 25, 2025 council meeting, council voted 8-7 to extend the e-scooter pilot program for another six months (until May 26, 2026).

Deputy Mayor Lewis and Councillor Raman spoke against extending the pilot, citing:
- Lack of helmet use
- E-scooters being operated by children under 16
- Use on roads with speed limits greater than 50 km/h
- Difficulty reporting violations (residents were told to follow e-scooters home to identify the owner)
- Time for province to step up with proper regulation, insurance, and licensing

Councillor Frank led the push to keep the pilot going, arguing many residents use e-scooters to get to work and school.

The pilot includes specific rules: no riders under 16, no sidewalk riding, no roads over 50 km/h speed limit, max speed of 24 km/h, and no passengers or cargo. The city opted into the provincial pilot in 2023 for personal use only, barring rental companies.`,
    meetingDate: "2025-11-25",
    meetingType: "Council",
    keyTopics: [
      "e-scooter",
      "pilot program",
      "electric scooter",
      "transportation"
    ]
  },
  {
    question: "What recognitions were made at the November 25, 2025 council meeting?",
    expectedAnswer: `Three community members were recognized at the November 25, 2025 council meeting:

1. Martin Withernshaw - Recognized by Deputy Mayor Lewis for his passing. Martin was a community leader who arrived in London over 40 years ago and fought for LGBTQ+ inclusivity. He served as president of Pride London, was a founding member of the Rainbow Optimus Club (first LGBTQ+ Optimus Club in the world), and was Grand Marshal for the 2019 Pride Parade. He also received the Chamber of Commerce President Award, Small Business Achievement Award, and Queen Elizabeth II Diamond Jubilee Medal.

2. Barry Allen Wells - Recognized by Councillor Trosow for his passing at age 71. Wells was a journalist who wrote for The Scene magazine, often under the pseudonym "Butch McClarty." He was a passionate advocate for Labatt Park, co-founded Friends of Labatt Park, and was instrumental in having the park declared a provincial heritage site. He was recognized on the Mayor's Honours List in 2006.

3. William "Bill" Brady - Recognized by Mayor Morgan for his passing at age 94. Brady was a broadcaster, journalist, and community leader, described as "one of the most recognizable voices in London." He served as chair of University Hospital Board, received an honorary doctorate from Western University, and was appointed a Member of the Order of Canada. He was named to the Mayor's Honours List in 2024.

The council also acknowledged Councillor Raman's birthday.`,
    meetingDate: "2025-11-25",
    meetingType: "Council",
    keyTopics: [
      "Martin Withernshaw",
      "Barry Allen Wells",
      "Bill Brady",
      "recognition",
      "Pride London",
      "Labatt Park"
    ]
  },
  {
    question: "What was decided about the Housing Stability Bank at the November 26, 2025 budget meeting?",
    expectedAnswer: `At the November 26, 2025 special council meeting on the budget, council unanimously (14-0) approved an amendment to fund the Housing Stability Bank program with $250,000 for 2026.

The amendment, brought by Councillor McAllister and seconded by Mayor Morgan, sources the funding from the Community Investment Reserve Fund (not the property tax levy). The motion specified that future funding can be brought forward for debate in the 2027 budget update.

Key points from the discussion:
- The Salvation Army operates this program and is currently oversubscribed
- Councillor Raman noted changes from the Ontario Energy Board freed up some dollars for electricity arrears support
- Deputy Mayor Lewis stated he would support this as a one-time measure from the reserve fund but would not support permanent expansion on the property tax levy
- Councillor Trosow supported it, citing concerns about expected increases in rent default evictions due to new provincial legislation
- Mayor Morgan praised Councillor McAllister's approach of listening to colleagues and using the reserve fund rather than the tax levy

The program is proactive, helping to keep people housed rather than addressing homelessness after the fact.`,
    meetingDate: "2025-11-26",
    meetingType: "Council",
    keyTopics: [
      "Housing Stability Bank",
      "budget",
      "Salvation Army",
      "housing",
      "reserve fund"
    ]
  },
  {
    question: "What was the 2026 property tax increase approved by council?",
    expectedAnswer: `London City Council approved a 3.4% property tax increase for 2026 at the November 26, 2025 special council meeting on the municipal budget.

This was part of the multi-year budget update process. Council made amendments including:
- Funding the Housing Stability Bank program with $250,000 from the Community Investment Reserve Fund (passed 14-0)
- Various other amendments as part of the Budget Committee's sixth report

The meeting was specifically convened to finalize the 2026 annual budget update. Mayor Morgan thanked staff and all civic departments for months of preparation work on the budget.`,
    meetingDate: "2025-11-26",
    meetingType: "Council",
    keyTopics: ["budget", "property tax", "2026", "tax increase"]
  },
  {
    question: "What happened with the renoviction bylaw at the November 2025 meetings?",
    expectedAnswer: `A proposal to explore strengthening London's renoviction bylaw failed on a tie vote at the November 2025 Community and Protective Services Committee meeting.

The motion to explore closing loopholes in the bylaw failed despite pleas from several tenants facing eviction. Councillor Trosow and Councillor Ferreira voted in favor, while Councillors Pribil and Peloza voted against.

Key concerns raised:
- The current bylaw focuses only on "renovictions" (evictions tied to renovations)
- Landlords can issue N13 notices not tied to renovations to avoid the licensing process
- One speaker noted landlords can "come back and do it again and again" using different tactics

London's renoviction bylaw requires landlords planning major renovation work to apply for a $600 licence within seven days of serving an N13 eviction notice. Seven licences have been issued so far. Violations can result in penalties from $1,000 to $5,000.`,
    meetingDate: "2025-11-25",
    meetingType: "Council",
    keyTopics: ["renoviction", "bylaw", "tenants", "eviction", "N13"]
  }
];

/**
 * December 1, 2025 Community and Protective Services Committee Test Cases
 * Source: /data/2025-12/2025-12-01-Community and Protective Services Committee.json
 */
export const december1CPSCTestCases: TestCase[] = [
  {
    question: "What was discussed about 122 Baseline Road at the December 1, 2025 CPSC meeting?",
    expectedAnswer: `The December 1, 2025 Community and Protective Services Committee meeting included significant discussion about 122 Baseline Road, a 61-unit affordable housing building that has experienced operational challenges.

Key points discussed:
1. Capital repairs: $700,000 is being allocated from the Capital Infrastructure Gap Reserve Fund to address building damage and unit rehabilitation
2. Tenant mix: The building currently houses high-needs individuals who transitioned from the temporary trailers at Fanshawe Golf Course. Staff noted this tenant selection process occurred under the federal Rapid Housing Initiative's requirements.
3. Re-tenanting strategy: Some tenants may be moved to upcoming highly supportive housing projects including Elmwood (opening late January/early February 2026) and Hill Street (fall/late 2026)
4. Future approach: Staff indicated the building will focus on tenants where "income is the greatest barrier with low supportive needs" going forward, aligning with the Sylvan Street model
5. Operating costs: Increased costs for security and staffing will be balanced by rent increases

Staff emphasized that for the vast majority of tenants, the transition from temporary trailers to apartment units was successful. The challenges affect a small number of units but have had significant impacts. Mr. Dickens noted that what was learned was that on-site services were insufficient and they've been working to adjust.`,
    meetingDate: "2025-12-01",
    meetingType: "Community and Protective Services Committee",
    keyTopics: [
      "122 Baseline Road",
      "affordable housing",
      "tenant placement",
      "Rapid Housing Initiative"
    ]
  },
  {
    question: "What demolitions were discussed at the December 1, 2025 meeting?",
    expectedAnswer: `The December 1, 2025 Community and Protective Services Committee discussed demolition orders for dilapidated properties:

1. Dundas Street property:
   - The property owner had applied for a demolition permit in 2019 (approximately 6 years ago) but never proceeded
   - Staff are seeking council authority to proceed with demolition if the owner continues to not act
   - All costs would be added to the property owner's tax account
   - Councillor Trosow asked about recovering nuisance damages from the owner for harm caused to adjacent property owners and the neighborhood
   - Staff confirmed the owner would be responsible for all enforcement costs

2. 76 Commissioners Road East:
   - Currently under a zoning application for development
   - Councillor Frank asked how demolition would impact the pending application
   - Staff indicated the demolition would bring the property into compliance and would not impact the zoning application
   - The applicant can demolish on their own before the city proceeds
   - Councillor Frank noted many complaints about people entering and starting fires, requiring regular EMS services`,
    meetingDate: "2025-12-01",
    meetingType: "Community and Protective Services Committee",
    keyTopics: [
      "demolition",
      "Dundas Street",
      "76 Commissioners Road East",
      "property standards"
    ]
  }
];

// Combine all test cases
export const allRecentDecisionsTestCases: TestCase[] = [
  ...december16CouncilTestCases,
  ...december9SPPCTestCases,
  ...novemberCouncilTestCases,
  ...december1CPSCTestCases
];

describe("Recent Council Decisions Test Cases", () => {
  describe("December 16, 2025 Council Meeting", () => {
    test("should have test cases for major decisions", () => {
      assert.ok(december16CouncilTestCases.length >= 4, "Should have at least 4 test cases for December 16 council");
    });

    test("should include conservation authority amalgamation vote", () => {
      const caTest = december16CouncilTestCases.find(tc =>
        tc.keyTopics.includes("conservation authority amalgamation")
      );
      assert.ok(caTest, "Should have test case for conservation authority amalgamation");
      assert.ok(caTest!.expectedAnswer.includes("4-8"), "Should include the vote count");
    });

    test("should include Richmond Street development decision", () => {
      const devTest = december16CouncilTestCases.find(tc =>
        tc.keyTopics.includes("1164-1170 Richmond Street")
      );
      assert.ok(devTest, "Should have test case for Richmond Street development");
      assert.ok(devTest!.expectedAnswer.includes("10-2"), "Should include the vote count");
    });

    test("should include urban growth boundary decision", () => {
      const ugbTest = december16CouncilTestCases.find(tc =>
        tc.keyTopics.includes("urban growth boundary")
      );
      assert.ok(ugbTest, "Should have test case for urban growth boundary");
    });
  });

  describe("December 9, 2025 SPPC Meeting", () => {
    test("should have test cases for micromodular shelter site", () => {
      const shelterTests = december9SPPCTestCases.filter(tc =>
        tc.keyTopics.includes("micromodular shelter")
      );
      assert.ok(shelterTests.length >= 1, "Should have test cases for micromodular shelter");
    });

    test("should include Xpera contract concerns", () => {
      const xperaTest = december9SPPCTestCases.find(tc =>
        tc.keyTopics.includes("Xpera")
      );
      assert.ok(xperaTest, "Should have test case for Xpera concerns");
      assert.ok(xperaTest!.expectedAnswer.includes("security"), "Should mention security");
    });
  });

  describe("November 2025 Council Meetings", () => {
    test("should have test cases for e-scooter pilot", () => {
      const escooterTest = novemberCouncilTestCases.find(tc =>
        tc.keyTopics.includes("e-scooter")
      );
      assert.ok(escooterTest, "Should have test case for e-scooter pilot");
      assert.ok(escooterTest!.expectedAnswer.includes("8-7"), "Should include the vote count");
    });

    test("should include Housing Stability Bank decision", () => {
      const hsbTest = novemberCouncilTestCases.find(tc =>
        tc.keyTopics.includes("Housing Stability Bank")
      );
      assert.ok(hsbTest, "Should have test case for Housing Stability Bank");
      assert.ok(hsbTest!.expectedAnswer.includes("$250,000"), "Should include the funding amount");
    });

    test("should include property tax increase", () => {
      const taxTest = novemberCouncilTestCases.find(tc =>
        tc.keyTopics.includes("property tax")
      );
      assert.ok(taxTest, "Should have test case for property tax");
      assert.ok(taxTest!.expectedAnswer.includes("3.4%"), "Should include the tax increase percentage");
    });

    test("should include recognitions", () => {
      const recogTest = novemberCouncilTestCases.find(tc =>
        tc.keyTopics.includes("recognition")
      );
      assert.ok(recogTest, "Should have test case for recognitions");
      assert.ok(recogTest!.expectedAnswer.includes("Martin Withernshaw"), "Should include Martin Withernshaw");
      assert.ok(recogTest!.expectedAnswer.includes("Bill Brady"), "Should include Bill Brady");
    });
  });

  describe("December 1, 2025 CPSC Meeting", () => {
    test("should have test cases for 122 Baseline Road", () => {
      const baselineTest = december1CPSCTestCases.find(tc =>
        tc.keyTopics.includes("122 Baseline Road")
      );
      assert.ok(baselineTest, "Should have test case for 122 Baseline Road");
      assert.ok(baselineTest!.expectedAnswer.includes("$700,000"), "Should include the funding amount");
    });

    test("should include demolition discussions", () => {
      const demolitionTest = december1CPSCTestCases.find(tc =>
        tc.keyTopics.includes("demolition")
      );
      assert.ok(demolitionTest, "Should have test case for demolitions");
    });
  });

  describe("All Test Cases", () => {
    test("should have comprehensive coverage of recent decisions", () => {
      assert.ok(allRecentDecisionsTestCases.length >= 10,
        `Should have at least 10 test cases, found ${allRecentDecisionsTestCases.length}`);
    });

    test("all test cases should have required fields", () => {
      for (const tc of allRecentDecisionsTestCases) {
        assert.ok(tc.question.length > 10, "Question should be meaningful");
        assert.ok(tc.expectedAnswer.length > 50, "Expected answer should be detailed");
        assert.ok(tc.meetingDate.match(/^\d{4}-\d{2}-\d{2}$/), "Meeting date should be in YYYY-MM-DD format");
        assert.ok(tc.meetingType.length > 0, "Meeting type should be specified");
        assert.ok(tc.keyTopics.length > 0, "Should have at least one key topic");
      }
    });

    test("should cover both Council and Committee meetings", () => {
      const councilTests = allRecentDecisionsTestCases.filter(tc =>
        tc.meetingType === "Council"
      );
      const committeeTests = allRecentDecisionsTestCases.filter(tc =>
        tc.meetingType.includes("Committee")
      );

      assert.ok(councilTests.length >= 3, "Should have Council meeting test cases");
      assert.ok(committeeTests.length >= 2, "Should have Committee meeting test cases");
    });

    test("should cover December 2025 and November 2025", () => {
      const decemberTests = allRecentDecisionsTestCases.filter(tc =>
        tc.meetingDate.startsWith("2025-12")
      );
      const novemberTests = allRecentDecisionsTestCases.filter(tc =>
        tc.meetingDate.startsWith("2025-11")
      );

      assert.ok(decemberTests.length >= 4, "Should have December 2025 test cases");
      assert.ok(novemberTests.length >= 3, "Should have November 2025 test cases");
    });
  });
});
