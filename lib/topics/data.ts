/**
 * Topic definitions
 *
 * Topics are derived from the synonym groups in rag-service.ts
 * Each topic groups related municipal policy areas
 */

import type { Topic } from "./types.js"

export const topics: Topic[] = [
  {
    name: "Transportation",
    slug: "transportation",
    description:
      "Transit, cycling infrastructure, parking, traffic, and pedestrian safety",
    keywords: [
      "transit",
      "bus",
      "brt",
      "rapid transit",
      "ltc",
      "london transit",
      "bike",
      "bicycle",
      "cycling",
      "bike lane",
      "active transportation",
      "scooter",
      "e-scooter",
      "micro-mobility",
      "parking",
      "traffic",
      "congestion",
      "pedestrian",
      "sidewalk",
      "crosswalk",
    ],
    icon: "bus",
    prefillQuestions: [
      "What's the status of the BRT rapid transit project?",
      "What bike lanes has council approved recently?",
      "What are the overnight parking rules?",
      "What has council discussed about traffic calming?",
    ],
  },
  {
    name: "Housing",
    slug: "housing",
    description:
      "Affordable housing, homelessness response, shelters, and housing policy",
    keywords: [
      "housing",
      "affordable housing",
      "social housing",
      "supportive housing",
      "lmch",
      "homeless",
      "homelessness",
      "shelter",
      "encampment",
      "wcsr",
      "whole of community",
      "hub",
      "aru",
      "additional residential unit",
      "secondary suite",
    ],
    icon: "home",
    prefillQuestions: [
      "What is council doing about homelessness?",
      "What affordable housing projects have been approved?",
      "What are the rules for basement apartments (ARUs)?",
      "How much funding has gone to homeless shelters?",
    ],
  },
  {
    name: "Public Safety",
    slug: "public-safety",
    description: "Police services, fire department, EMS, and bylaw enforcement",
    keywords: [
      "police",
      "lps",
      "london police",
      "law enforcement",
      "policing",
      "fire",
      "fire department",
      "firefighter",
      "lfd",
      "ambulance",
      "paramedic",
      "ems",
      "emergency services",
      "bylaw",
      "bylaw enforcement",
      "property standards",
    ],
    icon: "shield",
    prefillQuestions: [
      "What is the police budget this year?",
      "What has council discussed about community safety?",
      "How many new firefighters are being hired?",
      "What bylaw changes have been made recently?",
    ],
  },
  {
    name: "Climate & Environment",
    slug: "climate-environment",
    description:
      "Climate action, sustainability, trees, conservation, and environmental protection",
    keywords: [
      "climate",
      "environment",
      "greenhouse gas",
      "emissions",
      "net zero",
      "carbon",
      "ceap",
      "climate emergency",
      "sustainability",
      "tree",
      "urban forest",
      "conservation",
      "utrca",
      "wetland",
      "watershed",
    ],
    icon: "leaf",
    prefillQuestions: [
      "What is the Climate Emergency Action Plan?",
      "What has council done to reduce emissions?",
      "What tree protection policies exist?",
      "How is council addressing flooding and stormwater?",
    ],
  },
  {
    name: "Planning & Development",
    slug: "planning-development",
    description:
      "Zoning, development applications, heritage preservation, and urban planning",
    keywords: [
      "development",
      "zoning",
      "rezoning",
      "planning",
      "site plan",
      "official plan",
      "subdivision",
      "variance",
      "building permit",
      "density",
      "infill",
      "heritage",
      "heritage building",
      "olt",
      "ontario land tribunal",
      "brownfield",
    ],
    icon: "building",
    prefillQuestions: [
      "What major developments have been approved?",
      "What zoning changes have been made this year?",
      "How does council handle heritage buildings?",
      "What developments are going to the Ontario Land Tribunal?",
    ],
  },
  {
    name: "Budget & Taxes",
    slug: "budget-taxes",
    description: "City budget, property taxes, spending priorities, and fiscal policy",
    keywords: [
      "budget",
      "fiscal",
      "financial",
      "expenditure",
      "spending",
      "funding",
      "capital budget",
      "operating budget",
      "property tax",
      "tax",
      "tax levy",
      "mill rate",
      "assessment",
      "mpac",
    ],
    icon: "dollar-sign",
    prefillQuestions: [
      "What is the property tax increase this year?",
      "What are the biggest budget items?",
      "How much is the police budget vs other services?",
      "What capital projects are being funded?",
    ],
  },
  {
    name: "Infrastructure",
    slug: "infrastructure",
    description: "Roads, bridges, water systems, sewers, and city utilities",
    keywords: [
      "road",
      "roads",
      "street",
      "pavement",
      "pothole",
      "bridge",
      "water",
      "sewer",
      "stormwater",
      "drainage",
      "flooding",
      "water main",
      "wastewater",
      "garbage",
      "waste",
      "recycling",
      "landfill",
    ],
    icon: "tool",
    prefillQuestions: [
      "What road construction is planned?",
      "How is the city addressing flooding?",
      "What changes have been made to garbage collection?",
      "What infrastructure projects are in the capital budget?",
    ],
  },
  {
    name: "Parks & Recreation",
    slug: "parks-recreation",
    description: "Parks, trails, community centers, pools, arenas, and sports facilities",
    keywords: [
      "park",
      "parks",
      "green space",
      "parkland",
      "trail",
      "pathway",
      "thames valley parkway",
      "tvp",
      "recreation",
      "community center",
      "community centre",
      "pool",
      "swimming",
      "arena",
      "sports",
      "playground",
    ],
    icon: "tree",
    prefillQuestions: [
      "What new parks are being built?",
      "What trail expansions are planned?",
      "What recreation programs have been approved?",
      "What's happening with community centers?",
    ],
  },
  {
    name: "Social Services",
    slug: "social-services",
    description:
      "Mental health, addiction services, seniors programs, childcare, and accessibility",
    keywords: [
      "mental health",
      "addiction",
      "opioid",
      "overdose",
      "harm reduction",
      "safe injection",
      "senior",
      "seniors",
      "aging",
      "childcare",
      "daycare",
      "accessibility",
      "disability",
      "aoda",
      "food bank",
      "food security",
      "poverty",
      "social assistance",
    ],
    icon: "heart",
    prefillQuestions: [
      "What mental health services does the city support?",
      "What is council doing about the opioid crisis?",
      "What senior programs are available?",
      "How is the city improving accessibility?",
    ],
  },
  {
    name: "Economic Development",
    slug: "economic-development",
    description: "Downtown revitalization, jobs, business support, and tourism",
    keywords: [
      "downtown",
      "core area",
      "bia",
      "business improvement",
      "economic development",
      "economy",
      "jobs",
      "employment",
      "ledc",
      "london economic development",
      "tourism",
      "investment",
    ],
    icon: "briefcase",
    prefillQuestions: [
      "What is being done to revitalize downtown?",
      "What economic development initiatives are underway?",
      "What has council discussed about tourism?",
      "What support is available for local businesses?",
    ],
  },
]

/**
 * Get all topics
 */
export function getAllTopics(): Topic[] {
  return topics
}

/**
 * Get a topic by slug
 */
export function getTopicBySlug(slug: string): Topic | undefined {
  return topics.find((t) => t.slug === slug)
}

/**
 * Get a topic by keyword match
 * Returns the first topic that contains any of the provided keywords
 */
export function getTopicByKeyword(keyword: string): Topic | undefined {
  const lowerKeyword = keyword.toLowerCase()
  return topics.find((t) => t.keywords.some((k) => k.includes(lowerKeyword) || lowerKeyword.includes(k)))
}

/**
 * Detect topics mentioned in a query
 * Returns all topics that match keywords in the query
 */
export function detectTopicsInQuery(query: string): Topic[] {
  const lowerQuery = query.toLowerCase()
  return topics.filter((topic) =>
    topic.keywords.some((keyword) => lowerQuery.includes(keyword))
  )
}
