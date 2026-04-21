/**
 * Synonym groups for query expansion in London Ontario municipal context.
 *
 * Each group is a list of equivalent or closely related terms. When any term
 * from a group is detected in a user query, all other terms in the group are
 * appended to the query before embedding. This bridges vocabulary mismatches
 * between everyday language ("high school") and formal document language
 * ("secondary school").
 *
 * Guidelines for adding entries:
 * - Group terms that appear as genuine synonyms or acronym expansions in council documents
 * - Keep groups focused: prefer more, narrower groups over fewer, broader ones
 * - Add acronyms alongside their full forms so both directions resolve
 * - Comments should note the relevant acronyms and their expansions
 */
export const SYNONYM_GROUPS: string[][] = [
  // ===== TRANSPORTATION =====
  // Scooter/micro-mobility variants
  [
    "scooter",
    "e-scooter",
    "e-scooters",
    "electric scooter",
    "electric scooters",
    "kick scooter",
    "kick scooters",
    "electric kick scooter",
    "electric kick scooters",
    "micro-mobility",
    "micromobility",
    "pmd",
    "personal mobility device",
  ],
  // Bike/cycling variants
  [
    "bike",
    "bicycle",
    "cycling",
    "cycle",
    "cyclist",
    "biking",
    "active transportation",
    "bike lane",
    "bike lanes",
    "cycle track",
    "protected bike lane",
    "cycling infrastructure",
    "cycling network",
    "multi-use pathway",
    "mup",
    "bike share",
    "bikeshare",
  ],
  // Transit variants (LTC = London Transit Commission)
  [
    "transit",
    "bus",
    "brt",
    "rapid transit",
    "public transit",
    "ltc",
    "london transit",
    "london transit commission",
    "bus route",
    "bus stop",
    "transit hub",
    "public transportation",
    "mass transit",
    "transit pass",
    "transit card",
    "shift",
    "east london link",
    "wellington gateway",
  ],
  // Parking variants
  [
    "parking",
    "parking lot",
    "parking garage",
    "parking meter",
    "parking enforcement",
    "parking ticket",
    "on-street parking",
    "off-street parking",
    "parking permit",
  ],
  // Traffic variants
  [
    "traffic",
    "congestion",
    "traffic light",
    "traffic signal",
    "intersection",
    "traffic calming",
    "speed bump",
    "speed hump",
    "traffic study",
    "gridlock",
  ],
  // Pedestrian variants
  [
    "pedestrian",
    "pedestrians",
    "walking",
    "walkability",
    "crosswalk",
    "crossing",
    "pedestrian crossing",
    "pedestrian safety",
    "crossing guard",
    "sidewalk",
    "sidewalks",
    "walkway",
    "footpath",
  ],

  // ===== HOUSING & HOMELESSNESS =====
  // Homeless/shelter variants (LMCH = London Middlesex Community Housing, WCSR = Whole of Community System Response)
  [
    "homeless",
    "homelessness",
    "unhoused",
    "houseless",
    "experiencing homelessness",
    "people experiencing homelessness",
    "shelter",
    "encampment",
    "tent city",
    "rough sleeping",
    "unsheltered",
    "centre of hope",
    "salvation army",
    "hub",
    "wcsr",
    "whole of community system response",
  ],
  // Housing variants (LMCH, HAF = Housing Accelerator Fund, RGI = Rent-Geared-to-Income)
  [
    "housing",
    "affordable housing",
    "social housing",
    "supportive housing",
    "geared-to-income",
    "rgi",
    "subsidized housing",
    "rent supplement",
    "housing crisis",
    "housing affordability",
    "lmch",
    "london middlesex community housing",
    "public housing",
    "co-op housing",
    "transitional housing",
    "haf",
    "housing accelerator fund",
  ],
  // Secondary dwelling units (ARU = Additional Residential Unit, ADU = Accessory Dwelling Unit)
  [
    "aru",
    "additional residential unit",
    "adu",
    "accessory dwelling unit",
    "secondary suite",
    "basement apartment",
    "granny flat",
    "garden suite",
    "laneway house",
    "in-law suite",
  ],

  // ===== PUBLIC SAFETY =====
  // Police variants (LPS = London Police Service, PSB = Police Services Board)
  [
    "police",
    "lps",
    "london police",
    "london police service",
    "law enforcement",
    "cops",
    "officers",
    "policing",
    "police budget",
    "police funding",
    "lpsb",
    "police services board",
    "psb",
    "professional standards branch",
  ],
  // Fire variants (LFD = London Fire Department)
  [
    "fire",
    "fire department",
    "fire services",
    "firefighter",
    "firefighters",
    "fire station",
    "fire hall",
    "fire prevention",
    "fire safety",
    "lfd",
    "london fire department",
    "fire rescue",
  ],
  // EMS/Paramedic variants (MLPS = Middlesex-London Paramedic Service)
  [
    "ambulance",
    "paramedic",
    "paramedics",
    "ems",
    "emergency medical",
    "emergency services",
    "mlps",
    "middlesex-london paramedic service",
    "first responders",
  ],
  // Bylaw enforcement variants
  [
    "bylaw",
    "by-law",
    "bylaw enforcement",
    "bylaw officer",
    "municipal enforcement",
    "noise bylaw",
    "property standards",
    "bylaw complaint",
  ],

  // ===== ENVIRONMENT & CLIMATE =====
  // Climate variants (CEAP = Climate Emergency Action Plan, GHG = Greenhouse Gas)
  [
    "climate",
    "environment",
    "environmental",
    "greenhouse",
    "greenhouse gas",
    "ghg",
    "emissions",
    "net zero",
    "carbon",
    "carbon neutral",
    "climate emergency",
    "ceap",
    "climate emergency action plan",
    "sustainability",
    "sustainable",
    "decarbonization",
    "climate action",
    "climate change",
    "carbon footprint",
  ],
  // Conservation variants (UTRCA = Upper Thames River Conservation Authority, ESA = Environmentally Significant Area)
  [
    "conservation",
    "utrca",
    "upper thames river conservation authority",
    "thames river",
    "conservation authority",
    "esa",
    "environmentally significant area",
    "wetland",
    "wetlands",
    "watershed",
    "floodplain",
  ],
  // Trees/urban forest variants
  [
    "tree",
    "trees",
    "urban forest",
    "urban forestry",
    "tree planting",
    "tree removal",
    "tree preservation",
    "canopy",
    "tree canopy",
    "street tree",
    "boulevard tree",
  ],

  // ===== PLANNING & DEVELOPMENT =====
  // Development/zoning variants (OPA = Official Plan Amendment, CIP = Community Improvement Plan, PPS = Provincial Planning Statement)
  [
    "development",
    "zoning",
    "rezoning",
    "intensification",
    "site plan",
    "planning",
    "urban planning",
    "land use",
    "official plan",
    "opa",
    "official plan amendment",
    "secondary plan",
    "subdivision",
    "variance",
    "minor variance",
    "building permit",
    "development charges",
    "density",
    "infill",
    "redevelopment",
    "cip",
    "community improvement plan",
    "pps",
    "provincial planning statement",
  ],
  // Planning tribunals (OLT = Ontario Land Tribunal, LPAT = Local Planning Appeal Tribunal, OMB = Ontario Municipal Board)
  [
    "olt",
    "ontario land tribunal",
    "lpat",
    "local planning appeal tribunal",
    "omb",
    "ontario municipal board",
    "planning appeal",
    "tribunal",
  ],
  // Heritage variants (ACO = Architectural Conservancy of Ontario)
  [
    "heritage",
    "heritage building",
    "heritage property",
    "historical",
    "historic",
    "heritage conservation",
    "heritage designation",
    "heritage district",
    "heritage register",
    "aco",
    "architectural conservancy",
  ],
  // Brownfield variants
  [
    "brownfield",
    "brownfields",
    "contaminated",
    "contaminated site",
    "remediation",
    "environmental cleanup",
  ],

  // ===== CITY COMMITTEES & GOVERNANCE =====
  // Council committees (PEC, CWC, CPSC, CSC, SPPC)
  [
    "pec",
    "planning and environment committee",
    "cwc",
    "civic works committee",
    "cpsc",
    "community and protective services committee",
    "csc",
    "corporate services committee",
    "sppc",
    "strategic priorities and policy committee",
    "standing committee",
  ],
  // Advisory committees
  [
    "awcac",
    "animal welfare community advisory committee",
    "esacac",
    "environmental stewardship and action community advisory committee",
    "itcac",
    "integrated transportation community advisory committee",
    "diacac",
    "diversity inclusion and anti-oppression community advisory committee",
    "tfac",
    "trees and forests advisory committee",
    "accac",
    "accessibility community advisory committee",
  ],
  // Council/governance variants (CAO = Chief Administrative Officer)
  [
    "council",
    "city council",
    "municipal council",
    "councillor",
    "councillors",
    "councilor",
    "councilors",
    "ward",
    "wards",
    "elected official",
    "mayor",
    "city staff",
    "administration",
    "cao",
    "chief administrative officer",
    "city clerk",
  ],
  // Public input variants (PPM = Public Participation Meeting)
  [
    "deputation",
    "deputations",
    "delegation",
    "delegations",
    "public participation",
    "public meeting",
    "ppm",
    "public participation meeting",
    "public input",
    "public comment",
    "consultation",
    "public consultation",
    "town hall",
    "open house",
  ],

  // ===== BUDGET & TAXES =====
  // Budget variants
  [
    "budget",
    "budgeting",
    "fiscal",
    "financial",
    "expenditure",
    "spending",
    "funding",
    "capital budget",
    "operating budget",
    "multi-year budget",
  ],
  // Tax variants (MPAC = Municipal Property Assessment Corporation, TIF/TIEG = Tax Increment Financing/Grant)
  [
    "property tax",
    "tax",
    "taxes",
    "taxation",
    "tax levy",
    "levy",
    "mill rate",
    "tax rate",
    "assessment",
    "property assessment",
    "mpac",
    "municipal property assessment corporation",
    "tif",
    "tax increment financing",
    "tieg",
    "tax increment equivalent grant",
  ],

  // ===== INFRASTRUCTURE =====
  // Roads/pavement variants
  [
    "road",
    "roads",
    "street",
    "streets",
    "pavement",
    "paving",
    "repaving",
    "pothole",
    "potholes",
    "road repair",
    "resurfacing",
    "asphalt",
    "road construction",
    "road maintenance",
    "roadway",
    "arterial",
  ],
  // Water/sewer infrastructure (SWM = Stormwater Management, CSO = Combined Sewer Overflow)
  [
    "water",
    "sewer",
    "stormwater",
    "storm sewer",
    "sanitary sewer",
    "drainage",
    "flooding",
    "flood",
    "flood control",
    "water main",
    "watermain",
    "wastewater",
    "sewage",
    "swm",
    "stormwater management",
    "cso",
    "combined sewer overflow",
  ],
  // Bridge variants
  [
    "bridge",
    "bridges",
    "overpass",
    "underpass",
    "viaduct",
    "bridge repair",
    "pedestrian bridge",
  ],

  // ===== WASTE & UTILITIES =====
  // Garbage/waste variants (W12A = London's landfill, MRF = Material Recovery Facility, IC&I = Industrial/Commercial/Institutional)
  [
    "garbage",
    "trash",
    "waste",
    "solid waste",
    "waste collection",
    "garbage collection",
    "curbside collection",
    "waste management",
    "landfill",
    "w12a",
    "dump",
    "waste disposal",
    "ici",
    "ic&i",
    "industrial commercial institutional",
  ],
  // Recycling variants (MRF = Material Recovery Facility, RPRA = Resource Productivity and Recovery Authority)
  [
    "recycling",
    "recycle",
    "recyclable",
    "recyclables",
    "blue box",
    "blue bin",
    "recycling program",
    "waste diversion",
    "mrf",
    "material recovery facility",
    "rpra",
    "resource productivity and recovery authority",
  ],
  // Composting variants
  [
    "compost",
    "composting",
    "green bin",
    "organic waste",
    "organics",
    "yard waste",
    "leaf collection",
    "food waste",
  ],
  // Hydro/electricity variants (LDC = Local Distribution Company)
  [
    "hydro",
    "electricity",
    "electric",
    "electrical",
    "power",
    "london hydro",
    "utility",
    "utilities",
    "hydro pole",
    "power outage",
    "ldc",
    "local distribution company",
  ],
  // Gas variants
  ["gas", "natural gas", "enbridge", "union gas", "enbridge gas"],

  // ===== PARKS & RECREATION =====
  // Parks variants
  [
    "park",
    "parks",
    "green space",
    "greenspace",
    "open space",
    "parkland",
    "parkette",
    "urban park",
    "park maintenance",
  ],
  // Trails variants (TVP = Thames Valley Parkway)
  [
    "trail",
    "trails",
    "pathway",
    "pathways",
    "multi-use trail",
    "hiking trail",
    "walking trail",
    "tvp",
    "thames valley parkway",
    "recreational trail",
  ],
  // Recreation variants
  // Note: bare 'rec' is intentionally excluded — it is a substring of common words
  // ("recently", "recommendation", "record", "receive", "recovery") and would cause
  // false-positive expansions. Use 'recreation' or 'rec centre' as triggers instead.
  [
    "recreation",
    "recreational",
    "recreation center",
    "recreation centre",
    "rec center",
    "rec centre",
  ],
  // Pools/arenas variants (MURC = Multi-Use Recreation Complex)
  [
    "pool",
    "pools",
    "swimming pool",
    "swimming",
    "aquatic",
    "aquatics",
    "splash pad",
    "arena",
    "arenas",
    "ice rink",
    "rink",
    "skating",
    "murc",
    "multi-use recreation complex",
    "multi-use recreational complex",
  ],
  // Sports variants
  [
    "sports",
    "sports field",
    "soccer field",
    "baseball diamond",
    "tennis court",
    "basketball court",
    "athletic field",
    "playground",
    "playgrounds",
  ],

  // ===== SOCIAL SERVICES =====
  // Mental health variants (CMHA = Canadian Mental Health Association, TVAMHS = Thames Valley Addiction & Mental Health Services)
  [
    "mental health",
    "mental illness",
    "psychiatric",
    "counseling",
    "counselling",
    "crisis",
    "mental health crisis",
    "cmha",
    "canadian mental health association",
    "tvamhs",
    "thames valley addiction and mental health services",
  ],
  // Addiction variants (HART = Homelessness and Addiction Recovery Treatment, CTS = Consumption and Treatment Services)
  [
    "addiction",
    "substance use",
    "substance abuse",
    "drug",
    "drugs",
    "opioid",
    "opioids",
    "overdose",
    "fentanyl",
    "harm reduction",
    "safe injection",
    "consumption site",
    "cts",
    "consumption and treatment services",
    "safe supply",
    "naloxone",
    "hart",
    "hart hub",
  ],
  // Seniors variants
  [
    "senior",
    "seniors",
    "elderly",
    "older adult",
    "older adults",
    "aging",
    "retirement",
    "retirement home",
    "long-term care",
    "ltc facility",
    "nursing home",
    "age-friendly",
  ],
  // Childcare variants
  [
    "childcare",
    "child care",
    "daycare",
    "day care",
    "early childhood",
    "early learning",
    "preschool",
    "pre-school",
    "before and after school",
  ],
  // Accessibility variants (AODA = Accessibility for Ontarians with Disabilities Act)
  [
    "accessibility",
    "accessible",
    "disability",
    "disabilities",
    "disabled",
    "barrier-free",
    "aoda",
    "accessibility for ontarians with disabilities act",
    "wheelchair",
    "mobility aid",
    "universal design",
    "inclusive",
  ],
  // Food security variants
  [
    "food bank",
    "food banks",
    "food security",
    "food insecurity",
    "hunger",
    "meal program",
    "community kitchen",
  ],
  // Poverty/income support variants (OW = Ontario Works, ODSP = Ontario Disability Support Program)
  // Note: bare 'ow' is intentionally excluded — it is a substring of extremely common words
  // ("know", "now", "how", "downtown", "growth", "below") and would cause massive false-positive
  // expansions. Use 'ontario works' as the trigger instead.
  [
    "poverty",
    "low income",
    "low-income",
    "social assistance",
    "ontario works",
    "odsp",
    "ontario disability support program",
    "welfare",
    "financial assistance",
    "poverty reduction",
  ],

  // ===== HEALTH & EDUCATION =====
  // Public health variants (MLHU = Middlesex-London Health Unit, HPPA = Health Protection and Promotion Act)
  [
    "public health",
    "mlhu",
    "middlesex-london health unit",
    "health unit",
    "vaccination",
    "immunization",
    "outbreak",
    "epidemic",
    "pandemic",
    "covid",
    "hppa",
    "health protection and promotion act",
  ],
  // Hospital variants (LHSC = London Health Sciences Centre, UH = University Hospital, VH = Victoria Hospital)
  // Note: bare 'er' is intentionally excluded — it is a substring of virtually every English sentence
  // ("other", "after", "water", "over", "her", "there") and would cause catastrophic false-positive
  // expansions. Use 'emergency room' as the trigger instead.
  [
    "hospital",
    "hospitals",
    "lhsc",
    "london health sciences centre",
    "london health sciences center",
    "victoria hospital",
    "vh",
    "university hospital",
    "uh",
    "st josephs",
    "st joseph's",
    "sjhc",
    "medical",
    "healthcare",
    "health care",
    "emergency room",
  ],
  // University variants (UWO = University of Western Ontario)
  [
    "university",
    "western",
    "western university",
    "uwo",
    "university of western ontario",
    "fanshawe",
    "fanshawe college",
    "post-secondary",
    "college",
    "campus",
    "student",
    "students",
  ],
  // School board variants (TVDSB = Thames Valley District School Board, LDCSB = London District Catholic School Board)
  // "high school" and "secondary school" are in the same group so either query finds both
  [
    "school",
    "schools",
    "school board",
    "tvdsb",
    "thames valley district school board",
    "ldcsb",
    "london district catholic school board",
    "elementary school",
    "high school",
    "secondary school",
    "public school",
    "catholic school",
  ],

  // ===== ECONOMIC DEVELOPMENT =====
  // Downtown variants (BIA = Business Improvement Area)
  [
    "downtown",
    "core",
    "core area",
    "central business district",
    "cbd",
    "city center",
    "city centre",
    "urban core",
    "downtown revitalization",
    "bia",
    "business improvement area",
  ],
  // Economic development variants (LEDC = London Economic Development Corporation)
  [
    "economic development",
    "economy",
    "economic",
    "job",
    "jobs",
    "employment",
    "workforce",
    "economic growth",
    "investment",
    "ledc",
    "london economic development corporation",
  ],
  // Tourism variants
  [
    "tourism",
    "tourist",
    "tourists",
    "visitor",
    "visitors",
    "attraction",
    "attractions",
    "destination",
    "hospitality",
    "hotel",
    "hotels",
  ],

  // ===== NEIGHBOURHOODS =====
  // OEV variants (Old East Village)
  ["oev", "old east village", "old east", "dundas street east"],
  // SoHo variants (South of Horton)
  ["soho", "south of horton"],
  // Other neighbourhoods
  [
    "wortley",
    "wortley village",
    "old south",
    "woodfield",
    "blackfriars",
    "byron",
    "westmount",
    "whitehills",
    "masonville",
    "argyle",
  ],

  // ===== OTHER COMMON TOPICS =====
  // Animal variants
  [
    "animal",
    "animals",
    "pet",
    "pets",
    "dog",
    "dogs",
    "cat",
    "cats",
    "animal control",
    "animal services",
    "leash",
    "off-leash",
    "dog park",
    "animal shelter",
    "humane society",
  ],
  // Cannabis variants
  [
    "cannabis",
    "marijuana",
    "pot",
    "weed",
    "dispensary",
    "cannabis store",
    "cannabis retail",
  ],
  // Short-term rental variants (STR = Short-Term Rental)
  // Note: bare 'str' is intentionally excluded — it is a substring of extremely common
  // words ("street", "strategy", "district", "infrastructure") and would cause massive
  // false-positive expansions. Use the full phrase 'short-term rental' as the trigger.
  ["short-term rental", "airbnb", "vrbo", "vacation rental", "home sharing"],
  // Noise variants
  [
    "noise",
    "loud",
    "noise complaint",
    "noise bylaw",
    "noise pollution",
    "quiet hours",
    "noise exemption",
  ],
  // Graffiti/vandalism variants
  [
    "graffiti",
    "vandalism",
    "tagging",
    "street art",
    "mural",
    "murals",
    "graffiti removal",
  ],
  // Construction variants
  [
    "construction",
    "building",
    "construction site",
    "construction project",
    "construction noise",
    "demolition",
    "renovation",
  ],
  // Permit variants (RFP = Request for Proposal)
  [
    "permit",
    "permits",
    "building permit",
    "construction permit",
    "demolition permit",
    "permit application",
    "rfp",
    "request for proposal",
  ],

  // ===== PROVINCIAL/MUNICIPAL ACRONYMS =====
  // Provincial ministries (MECP = Ministry of Environment, Conservation and Parks)
  [
    "mecp",
    "ministry of environment",
    "ministry of the environment conservation and parks",
    "province",
    "provincial",
    "ontario",
  ],
  // Municipal organizations (AMO = Association of Municipalities of Ontario, FCM = Federation of Canadian Municipalities)
  [
    "amo",
    "association of municipalities of ontario",
    "fcm",
    "federation of canadian municipalities",
  ],

  // ===== ELECTIONS =====
  // PA Day / Election Day variants (motion to have Professional Activity Day on Election Day)
  [
    "pa day",
    "professional activity day",
    "election day",
    "voting day",
    "october 26",
    "election day off",
    "school pa day",
    "2026 municipal election",
    "school board election",
    "2026 elections update",
    "voting location",
    "vote tabulator",
  ],

  // ===== VOTE PATTERNS =====
  // Close vote patterns (normalize 7-8, 8-7, etc. as equivalent)
  [
    "7-8",
    "8-7",
    "7 to 8",
    "8 to 7",
    "close vote",
    "narrow margin",
    "one vote",
    "single vote margin",
  ],
  ["8-6", "6-8", "8 to 6", "6 to 8"],
  ["9-6", "6-9", "9 to 6", "6 to 9"],
  ["10-5", "5-10", "10 to 5", "5 to 10"],
  // Mayor in minority patterns
  [
    "mayor in minority",
    "mayor voted against",
    "mayor lost",
    "mayor on losing side",
    "morgan voted nay",
    "morgan voted against",
  ],
];

/**
 * Expand a query by appending synonyms for any recognized terms.
 *
 * For each synonym group, if any term from the group appears in the query,
 * all other terms in the group are appended. This bridges the vocabulary gap
 * between colloquial language and formal document terminology.
 *
 * Example:
 *   "high school transit pilot"
 *   → "high school transit pilot secondary school school schools school board ... bus brt ..."
 *
 * The expanded query is used for both vector embedding (semantic search) and
 * BM25 full-text search so synonym matching works across both retrieval paths.
 *
 * The result is capped at MAX_EXPANDED_CHARS characters (~8000 tokens) to stay
 * within the text-embedding-3-small model limit (8191 tokens).
 */

// text-embedding-3-small has an 8191 token limit; ~4 chars/token → ~32 000 chars max.
// We cap at 24 000 chars to leave a comfortable safety margin.
const MAX_EXPANDED_CHARS = 24_000;

export function expandQueryWithSynonyms(query: string): string {
  const lowerQuery = query.toLowerCase();
  const addedTerms = new Set<string>();

  for (const group of SYNONYM_GROUPS) {
    // Check if any term from this group appears in the query
    const foundTerm = group.find((term) => lowerQuery.includes(term));

    if (foundTerm) {
      // Add all synonym variants that aren't already in the query
      for (const synonym of group) {
        if (!lowerQuery.includes(synonym) && !addedTerms.has(synonym)) {
          addedTerms.add(synonym);
        }
      }
    }
  }

  if (addedTerms.size === 0) {
    return query;
  }

  const synonymsToAdd = Array.from(addedTerms).join(" ");
  const expanded = `${query} ${synonymsToAdd}`;

  // Guard against exceeding embedding model token limit
  if (expanded.length > MAX_EXPANDED_CHARS) {
    console.log(
      `   ⚠️ Expanded query too long (${expanded.length} chars), truncating to ${MAX_EXPANDED_CHARS}`,
    );
    return expanded.slice(0, MAX_EXPANDED_CHARS);
  }

  console.log(`   Query expanded with synonyms: [${synonymsToAdd}]`);
  return expanded;
}
