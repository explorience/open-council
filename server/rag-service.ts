// RAG (Retrieval Augmented Generation) service for chatbot

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { VectorStore } from './vector-store.js';
import { getSystemPrompt } from './system-prompt.js';
import type { ChatMessage, SearchResult } from './types.js';
import { getAllCouncillors } from '../lib/councillors/index.js';

/**
 * Metadata collected during chat for logging purposes
 */
export interface ChatMetadataCollector {
  topK?: number;
  contextChunksUsed?: number;
  llmProvider?: string;
  model?: string;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';

// Dynamic TOP_K values based on query complexity
const TOP_K_SIMPLE = 10;      // Single meeting, specific question
const TOP_K_MEDIUM = 30;      // Multiple meetings, specific topic
const TOP_K_COMPLEX = 80;     // Multi-year, broad policy tracking
const TOP_K_COMPREHENSIVE = 150; // Comprehensive historical analysis

export type LLMProvider = 'openai' | 'anthropic';

/**
 * Structured query analysis result
 * Extracts metadata from query to guide retrieval strategy
 */
interface QueryAnalysis {
  // Temporal
  isMostRecent: boolean;          // "last meeting", "most recent", "latest"
  specificMonth?: { month: number; year: number };  // "november 2025", "last month"
  yearFilter?: number;            // "in 2024"

  // Meeting type filter
  meetingTypeFilter?: string;     // "Budget", "Planning", "Council", etc.

  // Councillor voting record query
  isCouncillorVotingQuery: boolean;  // "How did [Name] vote on..."
  councillorName?: string;           // Extracted councillor name
  wantsHistoricalContext: boolean;   // Does user want historical/change-over-time analysis?

  // Complexity
  topK: number;
}

export class RAGService {
  private openai: OpenAI;
  private anthropic: Anthropic | null = null;
  private vectorStore: VectorStore;
  private provider: LLMProvider;

  constructor(
    openaiKey: string,
    anthropicKey: string | undefined,
    vectorStore: VectorStore,
    provider: LLMProvider = 'anthropic'
  ) {
    this.openai = new OpenAI({ apiKey: openaiKey });
    if (anthropicKey) {
      this.anthropic = new Anthropic({ apiKey: anthropicKey });
    }
    this.vectorStore = vectorStore;
    this.provider = provider;
  }

  /**
   * Analyze query complexity and determine optimal TOP_K
   *
   * Query classification:
   * - SIMPLE: Direct factual lookups (who, when, what specific thing)
   * - MEDIUM: Status updates, recent activity, moderate research
   * - COMPLEX: Why questions, multi-topic synthesis, controversial issues
   * - COMPREHENSIVE: Historical tracking, year-over-year analysis
   */
  private analyzeQueryComplexity(query: string): number {
    const lowerQuery = query.toLowerCase();

    // Patterns that indicate comprehensive/historical analysis
    const comprehensivePatterns = [
      /from \d{4} to \d{4}/,  // "from 2014 to 2025"
      /between \d{4} and \d{4}/,  // "between 2014 and 2025"
      /over (the )?(past|last) \d+ years/,  // "over the past 10 years"
      /throughout|historical|history|evolution|trend|track.*over/,
      /all.*since \d{4}/,  // "all decisions since 2014"
      /everything.*(about|on|regarding)/,  // "tell me everything about..."
    ];

    // Patterns that indicate complex multi-topic or analytical queries
    const complexPatterns = [
      /\d{4}-\d{4}/,  // "2014-2025"
      /compare|comparison|versus|vs\b/,
      /all (meetings|decisions|votes) (about|on|regarding)/,
      /comprehensive|complete|full (summary|overview|history)/,

      // Policy area + decision/funding questions (need lots of context)
      /(housing|homelessness|budget|planning|police|safety|climate|transit|brt|development) (policy|policies|decisions|funding|budget)/,

      // "Why" questions - need context to explain reasoning
      /why did (council|the city|councillors?)/,  // "why did council approve X"
      /why (is|are|was|were|does|do|did) (the )?council/,
      /why (is|are) (the city|london)/,
      /how come/,  // informal "why"

      // Voting analysis questions
      /how did councillors? vote/,  // voting record questions
      /how did .+ vote (on|for|against)/,  // "how did [Name] vote on X" - councillor specific
      /how (has|have) .+ voted/,  // "how has [Name] voted on X"
      /.+ voting record/,  // "[Name]'s voting record"
      /.+ vote on/,  // "[Name] vote on X"
      /who voted (for|against|yes|no)/,
      /was it unanimous/,
      /close vote|split vote|controversial vote/,

      // Questions seeking competing perspectives
      /what (alternatives|options|proposals)/,
      /who (opposed|supported|argued)/,
      /different perspectives|both sides/,
      /controversy|controversial|contentious|debate/,

      // Questions connecting different topics
      /fit with|reconcile|align with|consistent with/,
      /but (also|then|why)/,  // "approved X but rejected Y"
      /on one hand|on the other/,

      // Community concern questions that need broad context
      /what is (being done|happening|the city doing) about/,
      /crisis|emergency|problem|issue/,
      /homeless|homelessness|encampment/,  // Always complex - multi-faceted issue
      /affordable housing|housing crisis/,
      /downtown (safety|crime|issues)/,

      // Budget and tax questions (complex because of many factors)
      /property tax(es)?.*(increase|go up|rise|hike)/,
      /budget.*(increase|cut|change)/,
      /how (is|are) (the )?money (being )?(spent|allocated|used)/,
      /where (is|does) (the|my) (money|tax)/,

      // Police funding (sensitive topic needing full context)
      /police (budget|funding)/,
      /\$\d+.*(million|m)\b/,  // Specific dollar amounts suggest budget analysis

      // Skeptical/critical questions
      /actually|really|just/,  // "is the city actually building..."
      /i('ve| have) heard/,  // "I've heard that..."
      /is it true|is that true/,
    ];

    // Patterns that indicate medium complexity
    const mediumPatterns = [
      /in \d{4}/,  // "in 2024"
      /in (january|february|march|april|may|june|july|august|september|october|november|december)( \d{4})?/,
      /(january|february|march|april|may|june|july|august|september|october|november|december) \d{4}/,
      /meetings?.*(in|from|during|for) (january|february|march|april|may|june|july|august|september|october|november|december)/,
      /what (meetings?|happened).*(in|during)/,
      /(took place|occurred|held) in/,
      /last (year|month|quarter)/,
      /last\s+(\w+\s+)?meeting/,  // "last meeting", "last council meeting"
      /recent|latest|newest/,
      /most recent/,
      /multiple|several|various/,
      /all.*voted|voting record/,
      /this year|this month/,
      /lately|recently/,
      /what('s| is| has) (the )?status/,  // "what's the status of..."
      /what('s| is) being done/,
      /has council (voted|discussed|decided|approved)/,

      // Process questions - need some context but not comprehensive
      /how (do|can|should) i/,  // "how do I speak at a meeting"
      /how to (speak|object|participate|register|apply)/,
      /what (is|are) the (rules|process|procedure|steps)/,
      /can i|am i able to/,

      // Topic tracking questions
      /update|updates|progress/,
      /rapid transit|brt/,
      /climate (plan|action|emergency)/,
      /development.*(near|in) my/,
      /zoning (change|variance|application)/,
    ];

    // Check for comprehensive patterns first
    for (const pattern of comprehensivePatterns) {
      if (pattern.test(lowerQuery)) {
        console.log(`Query complexity: COMPREHENSIVE (TOP_K=${TOP_K_COMPREHENSIVE})`);
        return TOP_K_COMPREHENSIVE;
      }
    }

    // Check for complex patterns
    for (const pattern of complexPatterns) {
      if (pattern.test(lowerQuery)) {
        console.log(`Query complexity: COMPLEX (TOP_K=${TOP_K_COMPLEX})`);
        return TOP_K_COMPLEX;
      }
    }

    // Check for medium patterns
    for (const pattern of mediumPatterns) {
      if (pattern.test(lowerQuery)) {
        console.log(`Query complexity: MEDIUM (TOP_K=${TOP_K_MEDIUM})`);
        return TOP_K_MEDIUM;
      }
    }

    // Default to simple
    console.log(`Query complexity: SIMPLE (TOP_K=${TOP_K_SIMPLE})`);
    return TOP_K_SIMPLE;
  }

  /**
   * Generate embedding for a query
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    });

    return response.data[0].embedding;
  }

  /**
   * Unified query analyzer - extracts all relevant metadata from a query
   * This is the single source of truth for understanding user intent
   */
  private analyzeQuery(query: string): QueryAnalysis {
    const lowerQuery = query.toLowerCase();

    // 1. Check for councillor-specific voting query FIRST
    // This should override complexity to COMPREHENSIVE
    const councillorVoting = this.detectCouncillorVotingQuery(query);

    // 2. Determine complexity and TOP_K
    // If councillor voting query, force COMPREHENSIVE for full historical coverage
    const topK = councillorVoting.isCouncillorQuery
      ? TOP_K_COMPREHENSIVE
      : this.analyzeQueryComplexity(query);

    // 3. Check for "most recent" type queries
    const isMostRecent = this.detectMostRecentIntent(lowerQuery);

    // 4. Extract specific month/year if mentioned
    const specificMonth = this.extractSpecificMonth(lowerQuery);

    // 5. Extract year filter if just year mentioned
    const yearFilter = this.extractYearFilter(lowerQuery);

    // 6. Detect meeting type (committee, council, etc.)
    const meetingTypeFilter = this.detectMeetingType(lowerQuery);

    const analysis: QueryAnalysis = {
      isMostRecent,
      specificMonth: specificMonth || undefined,
      yearFilter: yearFilter || undefined,
      meetingTypeFilter,
      isCouncillorVotingQuery: councillorVoting.isCouncillorQuery,
      councillorName: councillorVoting.councillorName,
      wantsHistoricalContext: councillorVoting.wantsHistoricalContext,
      topK,
    };

    // Log what we detected
    const detected: string[] = [];
    if (councillorVoting.isCouncillorQuery) detected.push(`councillor:${councillorVoting.councillorName || 'unknown'}`);
    if (councillorVoting.wantsHistoricalContext) detected.push('historical');
    if (isMostRecent) detected.push('recent');
    if (specificMonth) detected.push(`month:${specificMonth.month + 1}/${specificMonth.year}`);
    if (yearFilter) detected.push(`year:${yearFilter}`);
    if (meetingTypeFilter) detected.push(`type:${meetingTypeFilter}`);

    if (detected.length > 0) {
      console.log(`🔎 Query analysis: ${detected.join(', ')}`);
    }

    return analysis;
  }

  /**
   * Detect if query wants the most recent/latest meetings
   */
  private detectMostRecentIntent(query: string): boolean {
    const recentPatterns = [
      /most recent|latest|newest/,
      /last\s+(\w+\s+)?meeting/,  // "last meeting", "last council meeting"
      /recent meeting/,
      /what.*happened.*recently/,
      /what('s| is| has) (the )?status/,  // status queries want recent
      /has council (voted|discussed|talked about|decided).*lately/,
      /what is (being done|happening|the city doing)/,
      /this year/,  // "what happened this year"
      /currently|current/,
      /lately|recently/,
    ];
    return recentPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Extract specific month/year from query
   */
  private extractSpecificMonth(query: string): { month: number; year: number } | null {
    const months: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    };

    // "this month"
    if (/this month|current month/.test(query)) {
      const now = new Date();
      return { month: now.getMonth(), year: now.getFullYear() };
    }

    // "last month"
    if (/last month|previous month/.test(query)) {
      const now = new Date();
      const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      return { month: lastMonth, year };
    }

    // "november 2025", "in november 2025"
    const monthYearPattern = /(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})/;
    const match = query.match(monthYearPattern);
    if (match) {
      return { month: months[match[1]], year: parseInt(match[2], 10) };
    }

    // Just month name without year - only if specifically asking about meetings in that month
    if (/meeting.*in\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(query) ||
        /in\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b.*meeting/.test(query)) {
      const monthMatch = query.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
      if (monthMatch) {
        return { month: months[monthMatch[1]], year: new Date().getFullYear() };
      }
    }

    return null;
  }

  /**
   * Extract year filter from query
   */
  private extractYearFilter(query: string): number | null {
    // "in 2024", "during 2023", "from 2024"
    const yearMatch = query.match(/\b(in|during|from|for)\s+(20\d{2})\b/);
    if (yearMatch) {
      return parseInt(yearMatch[2], 10);
    }
    return null;
  }

  /**
   * Detect specific meeting type/committee from query
   * Returns a filter string to match against meeting_title
   */
  private detectMeetingType(query: string): string | undefined {
    // Map of keywords to meeting title patterns
    // Order matters - more specific first
    const meetingTypes: Array<{ patterns: RegExp[]; filter: string }> = [
      // Specific committees - these have consistent naming
      {
        patterns: [/planning\s*(and\s*environment)?\s*committee/, /planning committee/],
        filter: 'Planning',
      },
      {
        patterns: [/budget\s*committee/],
        filter: 'Budget Committee',
      },
      {
        patterns: [/community\s*(and\s*)?(protective\s*)?services?\s*committee/, /cps\s*committee/],
        filter: 'Community',
      },
      {
        patterns: [/corporate\s*services?\s*committee/, /infrastructure\s*(and\s*)?corporate/, /ics\s*committee/],
        filter: 'Corporate Services',
      },
      {
        patterns: [/strategic\s*priorities/, /sppc/],
        filter: 'Strategic Priorities',
      },
      // Main council - titles vary: "Meeting of City Council" OR "Council Meeting"
      // Use simple "Council" filter but NOT for committee queries
      {
        patterns: [/(city\s+)?council\s+meeting/, /council\s+meeting/, /\bcouncil\b(?!\s*(committee|in))/],
        filter: 'Council',  // Simpler filter that matches both "Meeting of City Council" and "Council Meeting"
      },
    ];

    for (const { patterns, filter } of meetingTypes) {
      for (const pattern of patterns) {
        if (pattern.test(query)) {
          return filter;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract topic keywords from a voting query
   * For "how did Lewis vote on bike lanes" -> "bike lanes cycling"
   * For "Stevenson's voting record on e-scooters" -> "e-scooters scooter"
   */
  private extractTopicKeywords(query: string): string | null {
    const lowerQuery = query.toLowerCase();

    // Common topic patterns and their expanded keywords for better embedding match
    const topicExpansions: Record<string, string> = {
      'bike': 'bike bicycle cycling cycling network cycling infrastructure active transportation',
      'bicycle': 'bike bicycle cycling cycling network cycling infrastructure active transportation',
      'cycling': 'bike bicycle cycling cycling network cycling infrastructure active transportation mobility master plan',
      'bike lane': 'bike lane cycling infrastructure cycling network removed BE REMOVED mobility master plan',
      'scooter': 'scooter e-scooter electric scooter kick scooter electric kick scooter micro-mobility pilot program cargo bike voted against voted in favour councillors',
      'e-scooter': 'scooter e-scooter electric scooter kick scooter electric kick scooter micro-mobility pilot program cargo bike voted against voted in favour councillors',
      'kick scooter': 'scooter e-scooter electric scooter kick scooter electric kick scooter micro-mobility pilot program cargo bike voted against voted in favour councillors',
      'climate': 'climate environment CEAP climate emergency greenhouse gas emissions net zero',
      'housing': 'housing affordable housing social housing homelessness shelter supportive housing',
      'homeless': 'homeless homelessness shelter encampment supportive housing hub WCSR',
      'budget': 'budget tax levy property tax funding spending allocation',
      'tax': 'tax levy property tax budget increase decrease',
      'police': 'police LPS London Police Service public safety community safety',
      'transit': 'transit bus BRT rapid transit LTC London Transit',
      'development': 'development zoning planning site plan variance intensification',
    };

    // Try to find topic after common voting query patterns
    const topicPatterns = [
      /vote[ds]? (on|for|against) (.+?)(\?|$)/i,
      /voting record (on|for|about) (.+?)(\?|$)/i,
      /position on (.+?)(\?|$)/i,
      /support(ed|s)? (.+?)(\?|$)/i,
      /oppose[ds]? (.+?)(\?|$)/i,
    ];

    for (const pattern of topicPatterns) {
      const match = query.match(pattern);
      if (match) {
        const topic = match[2] || match[1];
        const cleanTopic = topic.trim().toLowerCase();

        // Check if we have an expansion for this topic
        for (const [key, expansion] of Object.entries(topicExpansions)) {
          if (cleanTopic.includes(key)) {
            return expansion;
          }
        }

        // Return the raw topic if no expansion found
        return cleanTopic;
      }
    }

    // Fallback: check for known topic keywords anywhere in query
    for (const [key, expansion] of Object.entries(topicExpansions)) {
      if (lowerQuery.includes(key)) {
        return expansion;
      }
    }

    return null;
  }

  /**
   * Normalize query for embedding generation by expanding known synonyms.
   * This ensures queries like "e-scooters" and "electric kick scooters" produce
   * similar embeddings by including all synonym variants in the query.
   *
   * Example: "how did Stevenson vote on e-scooters?" becomes:
   * "how did Stevenson vote on e-scooters scooter electric scooter kick scooter electric kick scooter?"
   */
  private normalizeQueryForEmbedding(query: string): string {
    const lowerQuery = query.toLowerCase();

    // Synonym groups - if any term in a group is found, append all related terms
    // This is separate from topicExpansions because we want JUST the synonyms,
    // not all the contextual keywords (which are better for topic-specific searches)
    // Comprehensive list covering London, Ontario municipal topics with acronyms
    const synonymGroups: string[][] = [
      // ===== TRANSPORTATION =====
      // Scooter/micro-mobility variants
      ['scooter', 'e-scooter', 'e-scooters', 'electric scooter', 'electric scooters', 'kick scooter', 'kick scooters', 'electric kick scooter', 'electric kick scooters', 'micro-mobility', 'micromobility', 'pmd', 'personal mobility device'],
      // Bike/cycling variants
      ['bike', 'bicycle', 'cycling', 'cycle', 'cyclist', 'biking', 'active transportation', 'bike lane', 'bike lanes', 'cycle track', 'protected bike lane', 'cycling infrastructure', 'cycling network', 'multi-use pathway', 'mup', 'bike share', 'bikeshare'],
      // Transit variants (LTC = London Transit Commission)
      ['transit', 'bus', 'brt', 'rapid transit', 'public transit', 'ltc', 'london transit', 'london transit commission', 'bus route', 'bus stop', 'transit hub', 'public transportation', 'mass transit', 'shift', 'east london link', 'wellington gateway'],
      // Parking variants
      ['parking', 'parking lot', 'parking garage', 'parking meter', 'parking enforcement', 'parking ticket', 'on-street parking', 'off-street parking', 'parking permit'],
      // Traffic variants
      ['traffic', 'congestion', 'traffic light', 'traffic signal', 'intersection', 'traffic calming', 'speed bump', 'speed hump', 'traffic study', 'gridlock'],
      // Pedestrian variants
      ['pedestrian', 'pedestrians', 'walking', 'walkability', 'crosswalk', 'crossing', 'pedestrian crossing', 'pedestrian safety', 'crossing guard', 'sidewalk', 'sidewalks', 'walkway', 'footpath'],

      // ===== HOUSING & HOMELESSNESS =====
      // Homeless/shelter variants (LMCH = London Middlesex Community Housing, WCSR = Whole of Community System Response)
      ['homeless', 'homelessness', 'unhoused', 'houseless', 'shelter', 'encampment', 'tent city', 'rough sleeping', 'unsheltered', 'centre of hope', 'salvation army', 'hub', 'wcsr', 'whole of community system response'],
      // Housing variants (LMCH, HAF = Housing Accelerator Fund, RGI = Rent-Geared-to-Income)
      ['housing', 'affordable housing', 'social housing', 'supportive housing', 'geared-to-income', 'rgi', 'subsidized housing', 'rent supplement', 'housing crisis', 'housing affordability', 'lmch', 'london middlesex community housing', 'public housing', 'co-op housing', 'transitional housing', 'haf', 'housing accelerator fund'],
      // Secondary dwelling units (ARU = Additional Residential Unit, ADU = Accessory Dwelling Unit)
      ['aru', 'additional residential unit', 'adu', 'accessory dwelling unit', 'secondary suite', 'basement apartment', 'granny flat', 'garden suite', 'laneway house', 'in-law suite'],

      // ===== PUBLIC SAFETY =====
      // Police variants (LPS = London Police Service, PSB = Police Services Board)
      ['police', 'lps', 'london police', 'london police service', 'law enforcement', 'cops', 'officers', 'policing', 'police budget', 'police funding', 'lpsb', 'police services board', 'psb', 'professional standards branch'],
      // Fire variants (LFD = London Fire Department)
      ['fire', 'fire department', 'fire services', 'firefighter', 'firefighters', 'fire station', 'fire hall', 'fire prevention', 'fire safety', 'lfd', 'london fire department', 'fire rescue'],
      // EMS/Paramedic variants (MLPS = Middlesex-London Paramedic Service)
      ['ambulance', 'paramedic', 'paramedics', 'ems', 'emergency medical', 'emergency services', 'mlps', 'middlesex-london paramedic service', 'first responders'],
      // Bylaw enforcement variants
      ['bylaw', 'by-law', 'bylaw enforcement', 'bylaw officer', 'municipal enforcement', 'noise bylaw', 'property standards', 'bylaw complaint'],

      // ===== ENVIRONMENT & CLIMATE =====
      // Climate variants (CEAP = Climate Emergency Action Plan, GHG = Greenhouse Gas)
      ['climate', 'environment', 'environmental', 'greenhouse', 'greenhouse gas', 'ghg', 'emissions', 'net zero', 'carbon', 'carbon neutral', 'climate emergency', 'ceap', 'climate emergency action plan', 'sustainability', 'sustainable', 'decarbonization', 'climate action', 'climate change', 'carbon footprint'],
      // Conservation variants (UTRCA = Upper Thames River Conservation Authority, ESA = Environmentally Significant Area)
      ['conservation', 'utrca', 'upper thames river conservation authority', 'thames river', 'conservation authority', 'esa', 'environmentally significant area', 'wetland', 'wetlands', 'watershed', 'floodplain'],
      // Trees/urban forest variants
      ['tree', 'trees', 'urban forest', 'urban forestry', 'tree planting', 'tree removal', 'tree preservation', 'canopy', 'tree canopy', 'street tree', 'boulevard tree'],

      // ===== PLANNING & DEVELOPMENT =====
      // Development/zoning variants (OPA = Official Plan Amendment, CIP = Community Improvement Plan, PPS = Provincial Planning Statement)
      ['development', 'zoning', 'rezoning', 'intensification', 'site plan', 'planning', 'urban planning', 'land use', 'official plan', 'opa', 'official plan amendment', 'secondary plan', 'subdivision', 'variance', 'minor variance', 'building permit', 'development charges', 'density', 'infill', 'redevelopment', 'cip', 'community improvement plan', 'pps', 'provincial planning statement'],
      // Planning tribunals (OLT = Ontario Land Tribunal, LPAT = Local Planning Appeal Tribunal, OMB = Ontario Municipal Board)
      ['olt', 'ontario land tribunal', 'lpat', 'local planning appeal tribunal', 'omb', 'ontario municipal board', 'planning appeal', 'tribunal'],
      // Heritage variants (ACO = Architectural Conservancy of Ontario)
      ['heritage', 'heritage building', 'heritage property', 'historical', 'historic', 'heritage conservation', 'heritage designation', 'heritage district', 'heritage register', 'aco', 'architectural conservancy'],
      // Brownfield variants
      ['brownfield', 'brownfields', 'contaminated', 'contaminated site', 'remediation', 'environmental cleanup'],

      // ===== CITY COMMITTEES & GOVERNANCE =====
      // Council committees (PEC, CWC, CPSC, CSC, SPPC)
      ['pec', 'planning and environment committee', 'cwc', 'civic works committee', 'cpsc', 'community and protective services committee', 'csc', 'corporate services committee', 'sppc', 'strategic priorities and policy committee', 'standing committee'],
      // Advisory committees
      ['awcac', 'animal welfare community advisory committee', 'esacac', 'environmental stewardship and action community advisory committee', 'itcac', 'integrated transportation community advisory committee', 'diacac', 'diversity inclusion and anti-oppression community advisory committee', 'tfac', 'trees and forests advisory committee', 'accac', 'accessibility community advisory committee'],
      // Council/governance variants (CAO = Chief Administrative Officer)
      ['council', 'city council', 'municipal council', 'councillor', 'councillors', 'councilor', 'councilors', 'ward', 'wards', 'elected official', 'mayor', 'city staff', 'administration', 'cao', 'chief administrative officer', 'city clerk'],
      // Public input variants (PPM = Public Participation Meeting)
      ['deputation', 'deputations', 'delegation', 'delegations', 'public participation', 'public meeting', 'ppm', 'public participation meeting', 'public input', 'public comment', 'consultation', 'public consultation', 'town hall', 'open house'],

      // ===== BUDGET & TAXES =====
      // Budget variants
      ['budget', 'budgeting', 'fiscal', 'financial', 'expenditure', 'spending', 'funding', 'capital budget', 'operating budget', 'multi-year budget'],
      // Tax variants (MPAC = Municipal Property Assessment Corporation, TIF/TIEG = Tax Increment Financing/Grant)
      ['property tax', 'tax', 'taxes', 'taxation', 'tax levy', 'levy', 'mill rate', 'tax rate', 'assessment', 'property assessment', 'mpac', 'municipal property assessment corporation', 'tif', 'tax increment financing', 'tieg', 'tax increment equivalent grant'],

      // ===== INFRASTRUCTURE =====
      // Roads/pavement variants
      ['road', 'roads', 'street', 'streets', 'pavement', 'paving', 'repaving', 'pothole', 'potholes', 'road repair', 'resurfacing', 'asphalt', 'road construction', 'road maintenance', 'roadway', 'arterial'],
      // Water/sewer infrastructure (SWM = Stormwater Management, CSO = Combined Sewer Overflow)
      ['water', 'sewer', 'stormwater', 'storm sewer', 'sanitary sewer', 'drainage', 'flooding', 'flood', 'flood control', 'water main', 'watermain', 'wastewater', 'sewage', 'swm', 'stormwater management', 'cso', 'combined sewer overflow'],
      // Bridge variants
      ['bridge', 'bridges', 'overpass', 'underpass', 'viaduct', 'bridge repair', 'pedestrian bridge'],

      // ===== WASTE & UTILITIES =====
      // Garbage/waste variants (W12A = London's landfill, MRF = Material Recovery Facility, IC&I = Industrial/Commercial/Institutional)
      ['garbage', 'trash', 'waste', 'solid waste', 'waste collection', 'garbage collection', 'curbside collection', 'waste management', 'landfill', 'w12a', 'dump', 'waste disposal', 'ici', 'ic&i', 'industrial commercial institutional'],
      // Recycling variants (MRF = Material Recovery Facility, RPRA = Resource Productivity and Recovery Authority)
      ['recycling', 'recycle', 'recyclable', 'recyclables', 'blue box', 'blue bin', 'recycling program', 'waste diversion', 'mrf', 'material recovery facility', 'rpra', 'resource productivity and recovery authority'],
      // Composting variants
      ['compost', 'composting', 'green bin', 'organic waste', 'organics', 'yard waste', 'leaf collection', 'food waste'],
      // Hydro/electricity variants (LDC = Local Distribution Company)
      ['hydro', 'electricity', 'electric', 'electrical', 'power', 'london hydro', 'utility', 'utilities', 'hydro pole', 'power outage', 'ldc', 'local distribution company'],
      // Gas variants
      ['gas', 'natural gas', 'enbridge', 'union gas', 'enbridge gas'],

      // ===== PARKS & RECREATION =====
      // Parks variants
      ['park', 'parks', 'green space', 'greenspace', 'open space', 'parkland', 'parkette', 'urban park', 'park maintenance'],
      // Trails variants (TVP = Thames Valley Parkway)
      ['trail', 'trails', 'pathway', 'pathways', 'multi-use trail', 'hiking trail', 'walking trail', 'tvp', 'thames valley parkway', 'recreational trail'],
      // Recreation variants
      ['recreation', 'rec', 'recreational', 'recreation center', 'recreation centre', 'community center', 'community centre', 'rec center', 'rec centre'],
      // Pools/arenas variants
      ['pool', 'pools', 'swimming pool', 'swimming', 'aquatic', 'aquatics', 'splash pad', 'arena', 'arenas', 'ice rink', 'rink', 'skating'],
      // Sports variants
      ['sports', 'sports field', 'soccer field', 'baseball diamond', 'tennis court', 'basketball court', 'athletic field', 'playground', 'playgrounds'],

      // ===== SOCIAL SERVICES =====
      // Mental health variants (CMHA = Canadian Mental Health Association, TVAMHS = Thames Valley Addiction & Mental Health Services)
      ['mental health', 'mental illness', 'psychiatric', 'counseling', 'counselling', 'crisis', 'mental health crisis', 'cmha', 'canadian mental health association', 'tvamhs', 'thames valley addiction and mental health services'],
      // Addiction variants (HART = Homelessness and Addiction Recovery Treatment, CTS = Consumption and Treatment Services)
      ['addiction', 'substance use', 'substance abuse', 'drug', 'drugs', 'opioid', 'opioids', 'overdose', 'fentanyl', 'harm reduction', 'safe injection', 'consumption site', 'cts', 'consumption and treatment services', 'safe supply', 'naloxone', 'hart', 'hart hub'],
      // Seniors variants
      ['senior', 'seniors', 'elderly', 'older adult', 'older adults', 'aging', 'retirement', 'retirement home', 'long-term care', 'ltc facility', 'nursing home', 'age-friendly'],
      // Childcare variants
      ['childcare', 'child care', 'daycare', 'day care', 'early childhood', 'early learning', 'preschool', 'pre-school', 'before and after school'],
      // Accessibility variants (AODA = Accessibility for Ontarians with Disabilities Act)
      ['accessibility', 'accessible', 'disability', 'disabilities', 'disabled', 'barrier-free', 'aoda', 'accessibility for ontarians with disabilities act', 'wheelchair', 'mobility aid', 'universal design', 'inclusive'],
      // Food security variants
      ['food bank', 'food banks', 'food security', 'food insecurity', 'hunger', 'meal program', 'community kitchen'],
      // Poverty/income support variants (OW = Ontario Works, ODSP = Ontario Disability Support Program)
      ['poverty', 'low income', 'low-income', 'social assistance', 'ontario works', 'ow', 'odsp', 'ontario disability support program', 'welfare', 'financial assistance', 'poverty reduction'],

      // ===== HEALTH & EDUCATION =====
      // Public health variants (MLHU = Middlesex-London Health Unit, HPPA = Health Protection and Promotion Act)
      ['public health', 'mlhu', 'middlesex-london health unit', 'health unit', 'vaccination', 'immunization', 'outbreak', 'epidemic', 'pandemic', 'covid', 'hppa', 'health protection and promotion act'],
      // Hospital variants (LHSC = London Health Sciences Centre, UH = University Hospital, VH = Victoria Hospital)
      ['hospital', 'hospitals', 'lhsc', 'london health sciences centre', 'london health sciences center', 'victoria hospital', 'vh', 'university hospital', 'uh', 'st josephs', "st joseph's", 'sjhc', 'medical', 'healthcare', 'health care', 'emergency room', 'er'],
      // University variants (UWO = University of Western Ontario)
      ['university', 'western', 'western university', 'uwo', 'university of western ontario', 'fanshawe', 'fanshawe college', 'post-secondary', 'college', 'campus', 'student', 'students'],
      // School board variants (TVDSB = Thames Valley District School Board, LDCSB = London District Catholic School Board)
      ['school', 'schools', 'school board', 'tvdsb', 'thames valley district school board', 'ldcsb', 'london district catholic school board', 'elementary school', 'high school', 'secondary school', 'public school', 'catholic school'],

      // ===== ECONOMIC DEVELOPMENT =====
      // Downtown variants (BIA = Business Improvement Area)
      ['downtown', 'core', 'core area', 'central business district', 'cbd', 'city center', 'city centre', 'urban core', 'downtown revitalization', 'bia', 'business improvement area'],
      // Economic development variants (LEDC = London Economic Development Corporation)
      ['economic development', 'economy', 'economic', 'job', 'jobs', 'employment', 'workforce', 'economic growth', 'investment', 'ledc', 'london economic development corporation'],
      // Tourism variants
      ['tourism', 'tourist', 'tourists', 'visitor', 'visitors', 'attraction', 'attractions', 'destination', 'hospitality', 'hotel', 'hotels'],

      // ===== NEIGHBOURHOODS =====
      // OEV variants (Old East Village)
      ['oev', 'old east village', 'old east', 'dundas street east'],
      // SoHo variants (South of Horton)
      ['soho', 'south of horton'],
      // Other neighbourhoods
      ['wortley', 'wortley village', 'old south', 'woodfield', 'blackfriars', 'byron', 'westmount', 'whitehills', 'masonville', 'argyle'],

      // ===== OTHER COMMON TOPICS =====
      // Animal variants
      ['animal', 'animals', 'pet', 'pets', 'dog', 'dogs', 'cat', 'cats', 'animal control', 'animal services', 'leash', 'off-leash', 'dog park', 'animal shelter', 'humane society'],
      // Cannabis variants
      ['cannabis', 'marijuana', 'pot', 'weed', 'dispensary', 'cannabis store', 'cannabis retail'],
      // Short-term rental variants (STR = Short-Term Rental)
      ['short-term rental', 'str', 'airbnb', 'vrbo', 'vacation rental', 'home sharing'],
      // Noise variants
      ['noise', 'loud', 'noise complaint', 'noise bylaw', 'noise pollution', 'quiet hours', 'noise exemption'],
      // Graffiti/vandalism variants
      ['graffiti', 'vandalism', 'tagging', 'street art', 'mural', 'murals', 'graffiti removal'],
      // Construction variants
      ['construction', 'building', 'construction site', 'construction project', 'construction noise', 'demolition', 'renovation'],
      // Permit variants (RFP = Request for Proposal)
      ['permit', 'permits', 'building permit', 'construction permit', 'demolition permit', 'permit application', 'rfp', 'request for proposal'],

      // ===== PROVINCIAL/MUNICIPAL ACRONYMS =====
      // Provincial ministries (MECP = Ministry of Environment, Conservation and Parks)
      ['mecp', 'ministry of environment', 'ministry of the environment conservation and parks', 'province', 'provincial', 'ontario'],
      // Municipal organizations (AMO = Association of Municipalities of Ontario, FCM = Federation of Canadian Municipalities)
      ['amo', 'association of municipalities of ontario', 'fcm', 'federation of canadian municipalities'],
    ];

    let normalizedQuery = query;
    const addedTerms = new Set<string>();

    for (const group of synonymGroups) {
      // Check if any term from this group appears in the query
      const foundTerm = group.find(term => lowerQuery.includes(term));

      if (foundTerm) {
        // Add all synonym variants that aren't already in the query
        for (const synonym of group) {
          if (!lowerQuery.includes(synonym) && !addedTerms.has(synonym)) {
            addedTerms.add(synonym);
          }
        }
      }
    }

    // Append all found synonyms to the query
    if (addedTerms.size > 0) {
      const synonymsToAdd = Array.from(addedTerms).join(' ');
      normalizedQuery = `${query} ${synonymsToAdd}`;
      console.log(`   📝 Query normalized: added synonyms [${synonymsToAdd}]`);
    }

    return normalizedQuery;
  }

  /**
   * Detect if the user is asking for historical context or changes over time
   * If true, we should NOT filter out old data
   */
  private detectHistoricalIntent(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    // Words/phrases that indicate the user wants historical context
    const historicalIndicators = [
      // Direct historical terms
      'historically',
      'history',
      'historical',
      'over time',
      'over the years',
      'through the years',
      'throughout',
      'in the past',
      'past votes',
      'past voting',
      'old votes',
      'previous votes',
      'earlier votes',

      // Change/evolution terms
      'changed',
      'change over',
      'changes in',
      'shift',
      'shifted',
      'shifting',
      'evolution',
      'evolved',
      'evolving',
      'transformation',
      'transformed',
      'flip-flop',
      'flip flop',
      'flipflop',
      'reversal',
      'reversed',
      'u-turn',
      'uturn',
      'u turn',
      '180',
      'turnaround',
      'turn around',

      // Comparison/tracking terms
      'track record',
      'voting record over',
      'voting history',
      'compare',
      'comparison',
      'compared to before',
      'different from before',
      'different than before',
      'vs earlier',
      'versus earlier',
      'pattern',
      'trend',
      'trajectory',
      'arc',
      'progression',
      'journey',

      // Time-span terms
      'always',
      'consistently',
      'never',
      'tenure',
      'career',
      'since elected',
      'since they started',
      'when first elected',
      'first term',
      'last term',
      'previous term',
      'full record',
      'complete record',
      'entire record',
      'comprehensive',
      'all votes',
      'every vote',

      // Temporal references to old periods
      'years ago',
      'long time',
      'decade',
      'all time',
      'back in',
      'back when',
      'used to',
      'previously',
      'before',
      'earlier',
      'originally',
      'initial position',
      'original position',
      'former position',
      'starting position',
    ];

    // Check for any historical indicator
    for (const indicator of historicalIndicators) {
      if (lowerQuery.includes(indicator)) {
        console.log(`📜 Historical intent detected: "${indicator}"`);
        return true;
      }
    }

    // Check for specific old year references (2019-2023)
    // If they mention a specific old year, they want historical data
    const oldYearPattern = /\b(2019|2020|2021|2022|2023)\b/;
    if (oldYearPattern.test(lowerQuery)) {
      console.log(`📜 Historical intent detected: specific old year mentioned`);
      return true;
    }

    // Check for year range patterns like "2019-2024" or "from 2019 to 2024"
    const yearRangePattern = /\b20\d{2}\s*(-|to)\s*20\d{2}\b/;
    if (yearRangePattern.test(lowerQuery)) {
      console.log(`📜 Historical intent detected: year range mentioned`);
      return true;
    }

    return false;
  }

  /**
   * Detect if this is a councillor-specific voting query
   * Returns the councillor name if found
   *
   * Patterns matched:
   * - "How did Susan Stevenson vote on X"
   * - "How has Shawn Lewis voted on bike lanes"
   * - "Susan Stevenson's voting record on climate"
   * - "What did Paul Van Meerbergen vote on"
   */
  private detectCouncillorVotingQuery(query: string): { isCouncillorQuery: boolean; councillorName?: string; wantsHistoricalContext: boolean } {
    const lowerQuery = query.toLowerCase();

    // First, check if the user is explicitly asking for historical/change-over-time context
    const wantsHistoricalContext = this.detectHistoricalIntent(lowerQuery);

    // Build councillor patterns dynamically from registry
    // This ensures we detect all verified councillors without hardcoding
    const councillorPatterns = getAllCouncillors().flatMap(({ info }) => {
      const patterns: RegExp[] = [];
      const displayName = info.displayName.toLowerCase();
      const nameParts = displayName.split(/\s+/);

      // Pattern for last name only (e.g., "morgan", "lewis")
      const lastName = nameParts[nameParts.length - 1];
      patterns.push(new RegExp(`\\b${lastName}\\b`));

      // Pattern for first + last name (e.g., "josh morgan")
      if (nameParts.length >= 2) {
        const firstName = nameParts[0];
        // Handle multi-word last names like "van holst", "van meerbergen"
        const lastNamePart = nameParts.slice(1).join('\\s+');
        patterns.push(new RegExp(`\\b${firstName}\\s+${lastNamePart}\\b`));
        // Also match with optional first name
        patterns.push(new RegExp(`\\b(${firstName}\\s+)?${lastNamePart}\\b`));
      }

      return patterns;
    });

    // Voting query patterns
    const votingPatterns = [
      /how did .+ vote/,
      /how has .+ voted/,
      /how have .+ voted/,
      /.+('s|s') voting record/,
      /what did .+ vote/,
      /did .+ vote (for|against|yes|no)/,
      /has .+ (ever )?voted/,
      /.+ (support|oppose|vote).*(on|for|against)/,
    ];

    // Check if query matches voting patterns
    const isVotingQuery = votingPatterns.some(pattern => pattern.test(lowerQuery));
    if (!isVotingQuery) {
      return { isCouncillorQuery: false, wantsHistoricalContext };
    }

    // Try to extract councillor name
    for (const pattern of councillorPatterns) {
      const match = lowerQuery.match(pattern);
      if (match) {
        // Capitalize the name properly
        const rawName = match[0];
        const capitalizedName = rawName.split(/\s+/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        console.log(`🎯 Detected councillor voting query for: ${capitalizedName}${wantsHistoricalContext ? ' (historical context requested)' : ''}`);
        return { isCouncillorQuery: true, councillorName: capitalizedName, wantsHistoricalContext };
      }
    }

    // Generic voting query pattern - might still be about a councillor
    // Use generic patterns to extract potential names
    const genericNamePattern = /how did ([a-z]+(?:\s+[a-z]+)?(?:\s+[a-z]+)?) vote/i;
    const genericMatch = query.match(genericNamePattern);
    if (genericMatch) {
      const potentialName = genericMatch[1];
      // Filter out common non-name words
      const nonNames = ['council', 'councillors', 'they', 'the', 'city', 'mayor', 'you'];
      if (!nonNames.includes(potentialName.toLowerCase())) {
        console.log(`🎯 Detected potential councillor voting query for: ${potentialName}${wantsHistoricalContext ? ' (historical context requested)' : ''}`);
        return { isCouncillorQuery: true, councillorName: potentialName, wantsHistoricalContext };
      }
    }

    return { isCouncillorQuery: false, wantsHistoricalContext };
  }

  /**
   * Retrieve relevant context from vector store
   * Uses unified query analysis to determine optimal retrieval strategy
   */
  async retrieveContext(query: string): Promise<SearchResult[]> {
    // Analyze query to extract all metadata
    const analysis = this.analyzeQuery(query);
    const { topK, isMostRecent, specificMonth, meetingTypeFilter, isCouncillorVotingQuery, councillorName, wantsHistoricalContext } = analysis;

    // Strategy 1: Specific month/year query (e.g., "meetings in november 2025")
    // Use date-range search, bypassing semantic similarity
    if (specificMonth) {
      console.log(`📆 Specific month query: ${specificMonth.month + 1}/${specificMonth.year}`);

      const dateResults = await this.vectorStore.searchByDateRange(
        specificMonth.month,
        specificMonth.year,
        200
      );

      if (dateResults.length > 0) {
        // If also filtering by meeting type, apply that filter
        let filtered = dateResults;
        if (meetingTypeFilter) {
          filtered = dateResults.filter(r =>
            r.metadata.meeting_title.includes(meetingTypeFilter)
          );
          console.log(`   Filtered to ${filtered.length} chunks for "${meetingTypeFilter}"`);
        }

        // Sort by date descending
        const sorted = filtered.sort((a, b) => {
          const dateA = new Date(a.metadata.meeting_date).getTime();
          const dateB = new Date(b.metadata.meeting_date).getTime();
          return dateB - dateA;
        });

        this.logUniqueMeetings(sorted);
        return sorted.slice(0, topK);
      } else {
        console.log(`   ⚠️ No meetings found in ${specificMonth.month + 1}/${specificMonth.year}`);
        return [];
      }
    }

    // Strategy 2: "Most recent" query (e.g., "last council meeting", "latest updates")
    // Bypass semantic search, query by date with optional meeting type filter
    if (isMostRecent) {
      console.log(`🕐 Most recent query${meetingTypeFilter ? ` (filtered: ${meetingTypeFilter})` : ''}`);

      const recentResults = await this.vectorStore.getMostRecent(topK * 3, meetingTypeFilter);

      if (recentResults.length > 0) {
        this.logUniqueMeetings(recentResults);
        return recentResults.slice(0, topK);
      }

      // If filtering by meeting type returned nothing, try without filter
      if (meetingTypeFilter) {
        console.log(`   No results with filter, trying without...`);
        const fallbackResults = await this.vectorStore.getMostRecent(topK * 3);
        if (fallbackResults.length > 0) {
          this.logUniqueMeetings(fallbackResults);
          return fallbackResults.slice(0, topK);
        }
      }
    }

    // Strategy 3: Councillor voting query - HYBRID retrieval
    // Combines semantic search for topic relevance with recent data to ensure temporal coverage
    // Also searches specifically for the councillor's name to find their votes even when absent
    // CRITICAL: Also includes news_coverage chunks which contain vote breakdowns
    // This prevents bias toward older, more verbose content
    // NEW: Uses hybrid search (vector + BM25) for better councillor name matching
    if (isCouncillorVotingQuery) {
      const recentOnly = !wantsHistoricalContext;
      console.log(`🗳️ Councillor voting query${councillorName ? ` for ${councillorName}` : ''} - using hybrid retrieval${recentOnly ? ' (RECENT ONLY - filtering out old data)' : ' (historical context requested)'}`);

      // CRITICAL: Normalize query to include synonym variants before embedding generation
      // This ensures "e-scooters" and "electric kick scooters" produce similar embeddings
      const normalizedQuery = this.normalizeQueryForEmbedding(query);
      const queryEmbedding = await this.generateQueryEmbedding(normalizedQuery);

      // 1. HYBRID SEARCH: Combine vector similarity with BM25 keyword matching
      // This significantly improves matching on councillor names (proper nouns)
      // and specific terms like "Cooling By-law" that pure semantic search misses
      const hybridQuery = councillorName
        ? `${councillorName} ${normalizedQuery} voted vote yea nay motion passed failed`
        : `${normalizedQuery} voted vote councillor motion passed failed`;
      const semanticResults = await this.vectorStore.hybridSearch(
        queryEmbedding,
        hybridQuery,
        Math.floor(topK * 0.4),
        0.6  // Weight toward keyword matching for councillor names
      );
      console.log(`   Hybrid search: ${semanticResults.length} results (vector + BM25)`);

      // 2. Get recent results to ensure we don't miss recent votes
      const recentResults = await this.vectorStore.getMostRecent(Math.floor(topK * 0.3));

      // 3. CRITICAL: Get recent news_coverage chunks which contain actual vote breakdowns
      // These are the chunks that say "Councillors who voted AGAINST: ..."
      const newsCoverageResults = await this.vectorStore.getRecentNewsCoverage(Math.floor(topK * 0.3), 6);
      console.log(`   News coverage search: ${newsCoverageResults.length} results with vote breakdowns`);

      // 4. If we have a councillor name, do additional targeted searches using HYBRID
      let councillorNameResults: SearchResult[] = [];
      let councillorTopicResults: SearchResult[] = [];
      if (councillorName) {
        // 4a. Search for the councillor name with voting keywords - use HYBRID for exact name matching
        const nameQuery = `${councillorName} voted vote yeas nays absent council motion moved councillors who voted against`;
        const nameEmbedding = await this.generateQueryEmbedding(nameQuery);
        councillorNameResults = await this.vectorStore.hybridSearch(
          nameEmbedding,
          nameQuery,
          Math.floor(topK * 0.3),
          0.7  // High keyword weight - councillor names are exact matches
        );
        console.log(`   Name-based hybrid search for "${councillorName}": ${councillorNameResults.length} results`);

        // 4b. Extract topic from original query and search for councillor + topic + action keywords
        // This helps find "Motion made by Lewis" + "cycling" + "BE REMOVED" chunks
        const topicKeywords = this.extractTopicKeywords(query);
        if (topicKeywords) {
          const topicQuery = `${councillorName} ${topicKeywords} motion moved vote removed approved rejected councillors who voted`;
          const topicEmbedding = await this.generateQueryEmbedding(topicQuery);
          councillorTopicResults = await this.vectorStore.hybridSearch(
            topicEmbedding,
            topicQuery,
            Math.floor(topK * 0.3),
            0.5  // Balanced for topic + name combination
          );
          console.log(`   Topic-based hybrid search for "${councillorName}" + "${topicKeywords}": ${councillorTopicResults.length} results`);
        }
      }

      // Combine and deduplicate results, prioritizing news_coverage and recency
      const seenIds = new Set<string>();
      const combinedResults: SearchResult[] = [];

      // Helper to add results with deduplication
      const addResults = (results: SearchResult[]) => {
        for (const result of results) {
          const id = `${result.metadata.meeting_date}-${result.metadata.item_number}-${result.text.substring(0, 50)}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            combinedResults.push(result);
          }
        }
      };

      // Add in order: news_coverage FIRST (has vote breakdowns), then recent, then semantic, then name-based, then topic-based
      addResults(newsCoverageResults);  // CRITICAL: These contain "Councillors who voted AGAINST: ..."
      addResults(recentResults);
      addResults(semanticResults);
      addResults(councillorNameResults);
      addResults(councillorTopicResults);

      // Sort by date descending so recent votes appear first in context
      const sorted = combinedResults.sort((a, b) => {
        const dateA = new Date(a.metadata.meeting_date).getTime();
        const dateB = new Date(b.metadata.meeting_date).getTime();
        return dateB - dateA;
      });

      this.logUniqueMeetings(sorted);
      console.log(`   Combined: ${newsCoverageResults.length} news_coverage + ${recentResults.length} recent + ${semanticResults.length} semantic + ${councillorNameResults.length} name + ${councillorTopicResults.length} topic = ${sorted.length} unique chunks`);

      // CRITICAL: Filter out old data for councillor voting queries UNLESS user explicitly asked for historical context
      // This prevents the model from elaborating on old votes when the user just wants current position
      let finalResults = sorted;
      if (recentOnly) {
        // Filter to only include chunks from the last 2 years
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const cutoffTime = twoYearsAgo.getTime();

        finalResults = sorted.filter(chunk => {
          const chunkDate = new Date(chunk.metadata.meeting_date).getTime();
          return chunkDate >= cutoffTime;
        });

        console.log(`   🕐 Filtered to recent data (last 2 years): ${finalResults.length} chunks (removed ${sorted.length - finalResults.length} old chunks)`);
      }

      // DEBUG: Log first 10 chunks to see what context the model receives
      console.log(`\n📋 DEBUG - First 10 chunks being sent to model:`);
      finalResults.slice(0, 10).forEach((chunk, i) => {
        const preview = chunk.text.substring(0, 150).replace(/\n/g, ' ');
        console.log(`   ${i + 1}. [${chunk.metadata.meeting_date}] ${chunk.metadata.chunk_type} - ${chunk.metadata.meeting_title}`);
        console.log(`      "${preview}..."`);
      });
      console.log('');

      // Log chunk type breakdown for debugging
      const chunkTypeCounts: Record<string, number> = {};
      for (const chunk of finalResults) {
        const type = chunk.metadata.chunk_type;
        chunkTypeCounts[type] = (chunkTypeCounts[type] || 0) + 1;
      }
      console.log(`   📊 Chunk type breakdown: ${Object.entries(chunkTypeCounts).map(([t, c]) => `${t}:${c}`).join(', ')}`);

      return finalResults.slice(0, topK);
    }

    // Strategy 4: Hybrid search with optional meeting type filter
    // For topic-based queries like "housing decisions" or "budget discussions"
    // Uses hybrid search (vector + BM25) to catch both semantic concepts and specific terms
    // Normalize query to include synonym variants for better embedding match
    const normalizedQuery = this.normalizeQueryForEmbedding(query);
    const queryEmbedding = await this.generateQueryEmbedding(normalizedQuery);

    if (meetingTypeFilter) {
      // Use filtered semantic search (hybrid not yet supported with filters)
      const filteredResults = await this.vectorStore.searchWithFilter(
        queryEmbedding,
        topK,
        meetingTypeFilter
      );

      if (filteredResults.length > 0) {
        this.logUniqueMeetings(filteredResults);
        return filteredResults;
      }

      // Fallback to unfiltered if no results
      console.log(`   No results with filter "${meetingTypeFilter}", using unfiltered search`);
    }

    // Default: hybrid search combining vector + BM25
    // Use balanced weight (0.5) for general queries - both semantic and keyword matching matter
    console.log(`🔀 Using hybrid search for general query`);
    const results = await this.vectorStore.hybridSearch(queryEmbedding, query, topK, 0.5);
    return results;
  }

  /**
   * Helper to log unique meetings in results
   */
  private logUniqueMeetings(results: SearchResult[]): void {
    const seenMeetings = new Set<string>();
    for (const result of results) {
      seenMeetings.add(result.metadata.meeting_title);
    }
    const dates = results.map(r => r.metadata.meeting_date).sort();
    if (dates.length > 0) {
      console.log(`   Found ${results.length} chunks from ${seenMeetings.size} meetings (${dates[0]} to ${dates[dates.length - 1]})`);
    }
  }

  /**
   * Build context string from search results
   */
  private buildContextString(results: SearchResult[]): string {
    if (results.length === 0) {
      return 'No relevant information found in the city council meeting records.';
    }

    return results
      .map((result, idx) => {
        const meta = result.metadata;

        // Convert file_path to internal Quartz URL
        // e.g., "data/2024-09/2024-09-24 Council.json" -> "/2024-09/2024-09-24-Council"
        const internalUrl = meta.file_path
          .replace('data/', '/')
          .replace('.json', '')
          .replace(/ /g, '-');

        // Add warning for transcript-only data (no official vote records)
        const transcriptWarning = meta.has_official_minutes === false
          ? `\n⚠️ **TRANSCRIPT ONLY - NO VOTE RECORDS:** This meeting only has transcript data. DO NOT state how individual councillors voted - you can only report what they SAID. If someone "agreed with colleagues" who opposed something, report that, but don't claim to know their actual vote.`
          : '';

        return `
## Context ${idx + 1}
**Meeting:** ${meta.meeting_title} (${meta.meeting_date})
**Type:** ${meta.chunk_type}${meta.item_title ? ` - ${meta.item_title}` : ''}
**Internal Minutes:** ${internalUrl}${meta.meeting_url ? `\n**City Website:** ${meta.meeting_url}` : ''}${transcriptWarning}

${result.text}
---`;
      })
      .join('\n');
  }

  /**
   * Chat with streaming using OpenAI
   */
  async *chatStreamOpenAI(
    message: string,
    history: ChatMessage[] = [],
    metadataCollector?: ChatMetadataCollector
  ): AsyncGenerator<string, void, unknown> {
    // Retrieve relevant context
    const results = await this.retrieveContext(message);
    const context = this.buildContextString(results);
    const systemPrompt = getSystemPrompt(context);

    // Log context size for debugging token limits
    const contextChars = context.length;
    const systemPromptChars = systemPrompt.length;
    const historyChars = history.reduce((sum, msg) => sum + msg.content.length, 0);
    const messageChars = message.length;
    const totalChars = systemPromptChars + historyChars + messageChars;
    // Rough estimate: ~4 chars per token for English text
    const estimatedTokens = Math.ceil(totalChars / 4);

    console.log(`📊 Token estimate for request:`);
    console.log(`   Context: ${contextChars.toLocaleString()} chars`);
    console.log(`   System prompt (with context): ${systemPromptChars.toLocaleString()} chars`);
    console.log(`   History: ${historyChars.toLocaleString()} chars (${history.length} messages)`);
    console.log(`   User message: ${messageChars.toLocaleString()} chars`);
    console.log(`   Total: ~${estimatedTokens.toLocaleString()} tokens (estimated)`);
    console.log(`   Model limit: 128,000 tokens (gpt-4o)`);

    // Populate metadata for logging
    if (metadataCollector) {
      const analysis = this.analyzeQuery(message);
      metadataCollector.topK = analysis.topK;
      metadataCollector.contextChunksUsed = results.length;
      metadataCollector.llmProvider = 'openai';
      metadataCollector.model = 'gpt-4o';
    }

    // Build messages array
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: 'user', content: message },
    ];

    // Stream response
    try {
      const stream = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        stream: true,
        temperature: 0.4,  // Lower for more focused, consistent responses
        max_tokens: 4000,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          yield content;
        }
      }
    } catch (error: any) {
      console.error('❌ OpenAI API Error:', error?.message || error);
      console.error('   Status:', error?.status);
      console.error('   Type:', error?.type);
      console.error('   Code:', error?.code);
      throw error;
    }
  }

  /**
   * Chat with streaming using Anthropic Claude
   */
  async *chatStreamAnthropic(
    message: string,
    history: ChatMessage[] = [],
    metadataCollector?: ChatMetadataCollector
  ): AsyncGenerator<string, void, unknown> {
    if (!this.anthropic) {
      throw new Error('Anthropic API key not configured');
    }

    // Retrieve relevant context
    const results = await this.retrieveContext(message);
    const context = this.buildContextString(results);
    const systemPrompt = getSystemPrompt(context);

    // Populate metadata for logging
    if (metadataCollector) {
      const analysis = this.analyzeQuery(message);
      metadataCollector.topK = analysis.topK;
      metadataCollector.contextChunksUsed = results.length;
      metadataCollector.llmProvider = 'anthropic';
      metadataCollector.model = 'claude-sonnet-4-5-20250929';
    }

    // Build messages array
    const messages: Anthropic.MessageParam[] = [
      ...history.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: 'user', content: message },
    ];

    // Stream response
    const stream = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      temperature: 0.4,  // Lower for more focused, consistent responses
      system: systemPrompt,
      messages,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  /**
   * Main chat method that uses configured provider
   */
  async *chat(
    message: string,
    history: ChatMessage[] = [],
    metadataCollector?: ChatMetadataCollector
  ): AsyncGenerator<string, void, unknown> {
    if (this.provider === 'openai') {
      yield* this.chatStreamOpenAI(message, history, metadataCollector);
    } else {
      yield* this.chatStreamAnthropic(message, history, metadataCollector);
    }
  }

  /**
   * Get context without generating a response (for debugging)
   */
  async getRelevantContext(query: string): Promise<SearchResult[]> {
    return await this.retrieveContext(query);
  }
}
