// RAG (Retrieval Augmented Generation) service for chatbot

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { VectorStore } from './vector-store.js';
import { getSystemPrompt } from './system-prompt.js';
import type { ChatMessage, SearchResult } from './types.js';

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

    // Common London councillor names (current and recent)
    // This helps ensure we detect real councillor names vs generic words
    const councillorPatterns = [
      // Current councillors (2022-2026 term)
      /\b(josh\s+)?morgan\b/,
      /\b(shawn\s+)?lewis\b/,
      /\b(skylar\s+)?franke\b/,
      /\b(susan\s+)?stevenson\b/,
      /\b(hadleigh\s+)?mcalister\b/,
      /\b(corrine\s+)?rahman\b/,
      /\b(sam\s+)?trosow\b/,
      /\b(david\s+)?ferreira\b/,
      /\b(paul\s+)?(van\s+)?meerbergen\b/,
      /\b(steve\s+)?hillier\b/,
      /\b(elizabeth\s+)?peloza\b/,
      /\b(jerry\s+)?pribil\b/,
      /\b(peter\s+)?cuddy\b/,
      /\b(anna\s+)?hopkins\b/,
      /\b(steven\s+)?holder\b/,
      // Previous councillors
      /\b(ed\s+)?holder\b/,
      /\b(maureen\s+)?cassidy\b/,
      /\b(jesse\s+)?helmer\b/,
      /\b(phil\s+)?squire\b/,
      /\b(michael\s+)?van\s+holst\b/,
      /\b(arielle\s+)?kayabaga\b/,
      /\b(stephen\s+)?turner\b/,
    ];

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
    if (isCouncillorVotingQuery) {
      const recentOnly = !wantsHistoricalContext;
      console.log(`🗳️ Councillor voting query${councillorName ? ` for ${councillorName}` : ''} - using hybrid retrieval${recentOnly ? ' (RECENT ONLY - filtering out old data)' : ' (historical context requested)'}`);

      const queryEmbedding = await this.generateQueryEmbedding(query);

      // 1. Get semantically relevant results (topic-based)
      const semanticResults = await this.vectorStore.search(queryEmbedding, Math.floor(topK * 0.4));

      // 2. Get recent results to ensure we don't miss recent votes
      const recentResults = await this.vectorStore.getMostRecent(Math.floor(topK * 0.3));

      // 3. CRITICAL: Get recent news_coverage chunks which contain actual vote breakdowns
      // These are the chunks that say "Councillors who voted AGAINST: ..."
      const newsCoverageResults = await this.vectorStore.getRecentNewsCoverage(Math.floor(topK * 0.3), 6);
      console.log(`   News coverage search: ${newsCoverageResults.length} results with vote breakdowns`);

      // 4. If we have a councillor name, do additional targeted searches
      let councillorNameResults: SearchResult[] = [];
      let councillorTopicResults: SearchResult[] = [];
      if (councillorName) {
        // 4a. Search for the councillor name with voting keywords
        const nameQuery = `${councillorName} voted vote yeas nays absent council motion moved councillors who voted against`;
        const nameEmbedding = await this.generateQueryEmbedding(nameQuery);
        councillorNameResults = await this.vectorStore.search(nameEmbedding, Math.floor(topK * 0.3));
        console.log(`   Name-based search for "${councillorName}": ${councillorNameResults.length} results`);

        // 4b. Extract topic from original query and search for councillor + topic + action keywords
        // This helps find "Motion made by Lewis" + "cycling" + "BE REMOVED" chunks
        const topicKeywords = this.extractTopicKeywords(query);
        if (topicKeywords) {
          const topicQuery = `${councillorName} ${topicKeywords} motion moved vote removed approved rejected councillors who voted`;
          const topicEmbedding = await this.generateQueryEmbedding(topicQuery);
          councillorTopicResults = await this.vectorStore.search(topicEmbedding, Math.floor(topK * 0.3));
          console.log(`   Topic-based search for "${councillorName}" + "${topicKeywords}": ${councillorTopicResults.length} results`);
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

    // Strategy 4: Semantic search with optional meeting type filter
    // For topic-based queries like "housing decisions" or "budget discussions"
    const queryEmbedding = await this.generateQueryEmbedding(query);

    if (meetingTypeFilter) {
      // Use filtered semantic search
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

    // Default: pure semantic search
    const results = await this.vectorStore.search(queryEmbedding, topK);
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
