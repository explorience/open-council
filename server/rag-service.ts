// RAG (Retrieval Augmented Generation) service for chatbot

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { VectorStore } from './vector-store.js';
import { getStaticSystemPrompt, getContextBlock, getSystemPrompt } from './system-prompt.js';
import type { ChatMessage, SearchResult, ChatSource } from './types.js';
import { getAllCouncillors, isCurrentCouncillor, getCurrentCouncillors } from '../lib/councillors/index.js';
import { voteLookupService } from './vote-lookup.js';
import { councillorStatsLookupService } from './councillor-stats-lookup.js';
import { detectTopicsInQuery } from '../lib/topics/index.js';
import { detectMultiHopVoteQuery, executeMultiHopQuery, formatMultiHopContext } from './vote-query-engine.js';
import { expandQueryWithSynonyms } from './synonyms.js';

/**
 * Metadata collected during chat for logging purposes
 */
export interface ChatMetadataCollector {
  topK?: number;
  contextChunksUsed?: number;
  llmProvider?: string;
  model?: string;
  sources?: ChatSource[];
  detectedTopics?: string[];
  usedStructuredData?: boolean;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';

// Dynamic TOP_K values based on query complexity
// Increased for llama-3.3-70b (128K context) - more context = better accuracy
const TOP_K_SIMPLE = 20;      // Single meeting, specific question
const TOP_K_MEDIUM = 60;      // Multiple meetings, specific topic
const TOP_K_COMPLEX = 150;    // Multi-year, broad policy tracking
const TOP_K_COMPREHENSIVE = 250; // Comprehensive historical analysis

export type LLMProvider = 'openai' | 'anthropic' | 'openrouter';

// OpenRouter model options - cheaper alternatives to Claude Sonnet
// See: https://openrouter.ai/models
export const OPENROUTER_MODELS = {
  // Claude alternatives (Anthropic via OpenRouter)
  'claude-3-haiku': 'anthropic/claude-3-haiku',
  'claude-3.5-haiku': 'anthropic/claude-3.5-haiku',
  'claude-sonnet-4': 'anthropic/claude-sonnet-4',
  'claude-sonnet-4.5': 'anthropic/claude-sonnet-4.5',

  // Google models (best value - 100% accuracy, cheapest)
  'gemini-2.5-flash-lite': 'google/gemini-2.5-flash-lite',
  'gemini-2.0-flash': 'google/gemini-2.0-flash-001',
  'gemini-2.5-flash': 'google/gemini-2.5-flash',

  // Google models - Gemini 3.x (latest, best accuracy)
  'gemini-3-flash': 'google/gemini-3-flash-preview',
  'gemini-3.1-flash-lite': 'google/gemini-3.1-flash-lite-preview',

  // OpenAI alternatives
  'gpt-4o-mini': 'openai/gpt-4o-mini',

  // Meta Llama 4 (open source, 1M context)
  'llama-4-maverick': 'meta-llama/llama-4-maverick',
  'llama-4-scout': 'meta-llama/llama-4-scout',

  // Qwen 3.x (Alibaba, strong benchmarks)
  'qwen-3.6-plus': 'qwen/qwen3.6-plus:free',
  'qwen-3.5-flash': 'qwen/qwen3.5-flash-02-23',

  // Open source models (legacy)
  'llama-3.3-70b': 'meta-llama/llama-3.3-70b-instruct',
  'qwen-72b': 'qwen/qwen-2.5-72b-instruct',
  'deepseek-chat': 'deepseek/deepseek-chat',
  'mistral-large': 'mistralai/mistral-large-2411',
  'command-r': 'cohere/command-r-08-2024',
} as const;

export type OpenRouterModel = keyof typeof OPENROUTER_MODELS;

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

  // Motion outcome query (did X pass/fail?)
  isMotionOutcomeQuery: boolean;     // "Did the X motion pass?"
  motionKeywords?: string[];         // Keywords to search for the motion

  // Vote count query (how many voted X?)
  isVoteCountQuery: boolean;         // "How many voted against X?"

  // Close vote query (what close votes on date X?)
  isCloseVoteQuery: boolean;         // "What close votes happened on..."
  closeVoteDate?: string;            // Date in YYYY-MM-DD format

  // Mayor minority query (where Mayor was outvoted)
  isMayorMinorityQuery: boolean;     // "Has Mayor ever been in minority?"

  // Alignment/pattern query
  isAlignmentQuery: boolean;         // "Who votes with the Mayor?"
  alignmentQueryType?: 'mayor-allies' | 'mayor-opposition' | 'lone-dissenter' | 'swing-voters' | 'councillor-profile' | 'voting-bloc';
  alignmentCouncillorSlug?: string;  // For councillor-specific alignment queries

  // Multi-hop vote query (cross-referencing multiple votes)
  isMultiHopQuery: boolean;          // "Find councillors who voted X on A and Y on B"
  multiHopQuery?: import('./vote-query-engine.js').MultiHopQuery;

  // Complexity
  topK: number;
}

export class RAGService {
  private openai: OpenAI;
  private anthropic: Anthropic | null = null;
  private openrouter: OpenAI | null = null;  // OpenRouter uses OpenAI-compatible API
  private vectorStore: VectorStore;
  private provider: LLMProvider;
  private openrouterModel: OpenRouterModel = 'claude-3.5-haiku';  // Default model
  private voteLookupInitialized = false;
  private councillorStatsInitialized = false;

  constructor(
    openaiKey: string,
    anthropicKey: string | undefined,
    vectorStore: VectorStore,
    provider: LLMProvider = 'anthropic',
    openrouterKey?: string,
    openrouterModel?: OpenRouterModel
  ) {
    this.openai = new OpenAI({ apiKey: openaiKey });
    if (anthropicKey) {
      this.anthropic = new Anthropic({ apiKey: anthropicKey });
    }
    if (openrouterKey) {
      this.openrouter = new OpenAI({
        apiKey: openrouterKey,
        baseURL: 'https://openrouter.ai/api/v1',
      });
    }
    if (openrouterModel) {
      this.openrouterModel = openrouterModel;
    }
    this.vectorStore = vectorStore;
    this.provider = provider;

    // Initialize vote lookup and councillor stats services asynchronously
    this.initializeServices();
  }

  /**
   * Initialize the vote lookup and councillor stats services for structured data access
   */
  private async initializeServices(): Promise<void> {
    try {
      await voteLookupService.initialize();
      this.voteLookupInitialized = true;
    } catch (error) {
      console.error('Failed to initialize vote lookup service:', error);
    }

    try {
      await councillorStatsLookupService.initialize();
      this.councillorStatsInitialized = true;
    } catch (error) {
      console.error('Failed to initialize councillor stats service:', error);
    }
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

    // 1. Detect ALL query types FIRST before determining TOP_K
    const councillorVoting = this.detectCouncillorVotingQuery(query);
    const isMostRecent = this.detectMostRecentIntent(lowerQuery);
    const specificMonth = this.extractSpecificMonth(lowerQuery);
    const yearFilter = this.extractYearFilter(lowerQuery);
    const meetingTypeFilter = this.detectMeetingType(lowerQuery);
    const motionOutcome = this.detectMotionOutcomeQuery(query);
    const voteCount = this.detectVoteCountQuery(query);
    const closeVote = this.detectCloseVoteQuery(query);
    const mayorMinority = this.detectMayorMinorityQuery(query);
    const alignment = this.detectAlignmentQuery(query);
    const multiHop = detectMultiHopVoteQuery(query);

    // 2. Smart TOP_K selection based on query type and available structured data
    // Key insight: queries with structured data fallbacks need less RAG context
    let topK: number;

    if (councillorVoting.isCouncillorQuery) {
      if (councillorVoting.wantsHistoricalContext) {
        // Historical analysis ("voting record over time") - capped to avoid context overflow
        topK = TOP_K_COMPLEX;
        console.log(`Query complexity: COUNCILLOR HISTORICAL (TOP_K=${TOP_K_COMPLEX})`);
      } else {
        // Simple vote lookup - structured vote data provides accuracy,
        // only need moderate context for narrative
        topK = TOP_K_MEDIUM;
        console.log(`Query complexity: COUNCILLOR SIMPLE (TOP_K=${TOP_K_MEDIUM}) - using structured vote lookup`);
      }
    } else if (alignment.isAlignmentQuery) {
      // Alignment queries use pre-computed councillor stats,
      // only need light context for supporting narrative
      topK = TOP_K_MEDIUM;
      console.log(`Query complexity: ALIGNMENT (TOP_K=${TOP_K_MEDIUM}) - using councillor stats`);
    } else if (motionOutcome.isMotionOutcome || voteCount.isVoteCount || closeVote.isCloseVote) {
      // Vote/motion queries use structured vote lookup for accuracy,
      // moderate context for meeting narrative
      topK = TOP_K_MEDIUM;
      console.log(`Query complexity: VOTE LOOKUP (TOP_K=${TOP_K_MEDIUM}) - using structured data`);
    } else {
      // Default: use pattern-based complexity analysis
      topK = this.analyzeQueryComplexity(query);
    }

    const analysis: QueryAnalysis = {
      isMostRecent,
      specificMonth: specificMonth || undefined,
      yearFilter: yearFilter || undefined,
      meetingTypeFilter,
      isCouncillorVotingQuery: councillorVoting.isCouncillorQuery,
      councillorName: councillorVoting.councillorName,
      wantsHistoricalContext: councillorVoting.wantsHistoricalContext,
      isMotionOutcomeQuery: motionOutcome.isMotionOutcome,
      motionKeywords: motionOutcome.motionKeywords || voteCount.motionKeywords,
      isVoteCountQuery: voteCount.isVoteCount,
      isCloseVoteQuery: closeVote.isCloseVote,
      closeVoteDate: closeVote.date,
      isMayorMinorityQuery: mayorMinority,
      isAlignmentQuery: alignment.isAlignmentQuery,
      alignmentQueryType: alignment.alignmentQueryType,
      alignmentCouncillorSlug: alignment.alignmentCouncillorSlug,
      isMultiHopQuery: multiHop.isMultiHop,
      multiHopQuery: multiHop.isMultiHop ? multiHop : undefined,
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
    if (alignment.isAlignmentQuery) detected.push(`alignment:${alignment.alignmentQueryType || 'general'}`);
    if (multiHop.isMultiHop) detected.push(`multi-hop:${multiHop.criteria.length} criteria`);

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
   * Convert a councillor name to their slug for vote data lookup
   * e.g., "Stevenson" -> "s-stevenson", "Van Meerbergen" -> "p-van-meerbergen"
   */
  private councillorNameToSlug(name: string): string | null {
    const lowerName = name.toLowerCase().trim();

    // Map of name variations to slugs
    const nameToSlugMap: Record<string, string> = {
      'stevenson': 's-stevenson',
      's. stevenson': 's-stevenson',
      'susan stevenson': 's-stevenson',
      'van meerbergen': 'p-van-meerbergen',
      'p. van meerbergen': 'p-van-meerbergen',
      'paul van meerbergen': 'p-van-meerbergen',
      'trosow': 's-trosow',
      's. trosow': 's-trosow',
      'sam trosow': 's-trosow',
      'morgan': 'j-morgan',
      'j. morgan': 'j-morgan',
      'josh morgan': 'j-morgan',
      'lewis': 's-lewis',
      's. lewis': 's-lewis',
      'shawn lewis': 's-lewis',
      'franke': 's-franke',
      's. franke': 's-franke',
      'skylar franke': 's-franke',
      'hopkins': 'a-hopkins',
      'a. hopkins': 'a-hopkins',
      'anna hopkins': 'a-hopkins',
      'peloza': 'e-peloza',
      'e. peloza': 'e-peloza',
      'elizabeth peloza': 'e-peloza',
      'ferreira': 'd-ferreira',
      'd. ferreira': 'd-ferreira',
      'david ferreira': 'd-ferreira',
      'rahman': 'c-rahman',
      'c. rahman': 'c-rahman',
      'corrine rahman': 'c-rahman',
      'mcalister': 'h-mcalister',
      'h. mcalister': 'h-mcalister',
      'hadleigh mcalister': 'h-mcalister',
      'cuddy': 'p-cuddy',
      'p. cuddy': 'p-cuddy',
      'peter cuddy': 'p-cuddy',
      'pribil': 'j-pribil',
      'j. pribil': 'j-pribil',
      'jerry pribil': 'j-pribil',
      'lehman': 's-lehman',
      's. lehman': 's-lehman',
      'steve lehman': 's-lehman',
      'hillier': 's-hillier',
      's. hillier': 's-hillier',
      'susan hillier': 's-hillier',
      'helmer': 'j-helmer',
      'j. helmer': 'j-helmer',
      'jesse helmer': 'j-helmer',
    };

    // Check direct match
    if (nameToSlugMap[lowerName]) {
      return nameToSlugMap[lowerName];
    }

    // Check partial match (last name only)
    for (const [key, slug] of Object.entries(nameToSlugMap)) {
      if (key.endsWith(lowerName) || lowerName.endsWith(key.split(' ').pop() || '')) {
        return slug;
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
   *
   * Delegates to expandQueryWithSynonyms() from server/synonyms.ts which holds
   * the centralized synonym map for the London Ontario municipal context.
   */
  private normalizeQueryForEmbedding(query: string): string {
    return expandQueryWithSynonyms(query);
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
      'throughout the years',
      'throughout history',
      'throughout',
      'this term',
      'current term',
      'most recent term',
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
      'changed stance',
      'changed position',
      'switched',
      'gone from',
      'went from',
      'moved from',
      'come around',
      'came around',
      'softened',
      'hardened',
      'moderated',
      'radicalized',

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

      // Broad summary / overall characterization terms
      'overall',
      'in general',
      'generally',
      'on the whole',
      'big picture',
      'sum up',
      'summary of',
      'summarize',
      'overview',
      'gist',
      'broad strokes',
      'stance on',
      'where do they stand',
      'where does he stand',
      'where does she stand',
      'position on',
      'how do they lean',
      'how does he lean',
      'how does she lean',
      'leaning',
      'what kind of',
      'what type of',
      'what sort of',

      // Time-span terms
      'always',
      'consistently',
      'never',
      'tenure',
      'career',
      'since elected',
      'since they started',
      'since taking office',
      'since being elected',
      'since joining council',
      'since they joined',
      'when first elected',
      'when they started',
      'first term',
      'last term',
      'previous term',
      'full term',
      'entire term',
      'whole term',
      'full record',
      'complete record',
      'entire record',
      'comprehensive',
      'all votes',
      'every vote',
      'all their votes',
      'every time',
      'time and again',
      'repeatedly',
      'again and again',
      'time after time',
      'across meetings',
      'across votes',
      'across the board',

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
      'from day one',
      'from the start',
      'from the beginning',
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
      /.+ voting record/,  // Also match without possessive: "peter cuddy voting record"
      /what did .+ vote/,
      /did .+ vote (for|against|yes|no)/,
      /has .+ (ever )?voted/,
      /.+ (support|oppose|vote).*(on|for|against)/,
      // Additional patterns for prediction/analysis queries
      /what predicts.*(vote|voting)/,
      /how will .+ vote/,
      /.+ voting (pattern|behavior|tendency|tendencies)/,
      /who.*(opposition|bloc|coalition|majority)/,
      /(progressive|conservative|fiscal).*(councillor|bloc|group)/,
      // Overall record / characterization patterns
      /gist of .+ vot/,                       // "gist of X's voting"
      /overall .+ vot/,                        // "overall X voting record"
      /what kind of (councillor|council member|representative) is/,
      /what type of (councillor|council member|representative) is/,
      /what sort of (councillor|council member|representative) is/,
      /.+ voting (stance|position|history)/,   // "X's voting stance"
      /record of .+ (as|on)/,                  // "record of X as councillor"
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
   * Detect if this is a motion outcome query (did X pass/fail?)
   * Returns keywords to search for the motion
   *
   * Patterns matched:
   * - "Did the Cooling By-law pass?"
   * - "Was the diaper motion approved?"
   * - "Did the Urban Growth Boundary fail?"
   */
  private detectMotionOutcomeQuery(query: string): { isMotionOutcome: boolean; motionKeywords?: string[] } {
    const lowerQuery = query.toLowerCase();

    // Check for specific known motions FIRST (before general patterns)
    // This ensures motions with short keywords like "PA Day" are properly detected
    const knownMotions: { pattern: RegExp; keywords: string[] }[] = [
      { pattern: /diaper|menstrual|green bin.*waste/i, keywords: ['diaper', 'menstrual', 'green', 'bin'] },
      { pattern: /cooling by-?law/i, keywords: ['cooling', 'bylaw', 'maximum', 'temperature'] },
      { pattern: /urban growth boundary/i, keywords: ['urban', 'growth', 'boundary'] },
      { pattern: /warming cent(er|re)/i, keywords: ['warming', 'centre', 'framework'] },
      { pattern: /bike.*parking|bicycle.*parking/i, keywords: ['bike', 'parking', 'implementation'] },
      { pattern: /e-?scooter|kick scooter/i, keywords: ['scooter', 'electric', 'kick', 'pilot'] },
      // PA Day motion - match various phrasings (2026 Municipal Election PA Day on Voting Day)
      { pattern: /pa day/i, keywords: ['professional', 'activity', 'day', 'pa', 'day', 'election', 'voting', 'october', '2026', 'municipal'] },
      { pattern: /integrity commissioner/i, keywords: ['integrity', 'commissioner', 'code', 'conduct'] },
      { pattern: /ridout.*development|ridout.*street|550 ridout/i, keywords: ['ridout', 'development', 'kent', 'street', '550'] },
      { pattern: /oev.*bia|old east village.*bia|oev.*reimburs/i, keywords: ['oev', 'bia', 'reimbursement', 'cleaning', 'graffiti'] },
      { pattern: /telus|municipal access agreement/i, keywords: ['telus', 'municipal', 'access', 'agreement'] },
      { pattern: /housing stability/i, keywords: ['housing', 'stability', 'report'] },
      { pattern: /bill\s*(?:no\.?\s*)?\d+/i, keywords: [] },  // handled separately below - extract bill number
      { pattern: /extend.*(?:meeting|session|past\s*(?:6|six))/i, keywords: ['extend', 'meeting', 'past', '6pm'] },
      { pattern: /parking.*(?:study|amendment|minimum)/i, keywords: ['parking', 'study', 'amendment', 'minimum'] },
      { pattern: /peloza.*(?:appoint|committee|icsc)|icsc.*(?:appoint)/i, keywords: ['peloza', 'appointment', 'infrastructure', 'corporate'] },
    ];

    for (const { pattern, keywords } of knownMotions) {
      if (pattern.test(lowerQuery) && /(pass|fail|approved|rejected|result|vote|outcome|margin|close|motion)/i.test(lowerQuery)) {
        // Special handling for bill number pattern: extract the bill number from query
        let resolvedKeywords = keywords;
        if (keywords.length === 0) {
          const billMatch = query.match(/bill\s*(?:no\.?\s*)?(\d+)/i);
          resolvedKeywords = billMatch ? ['bill', billMatch[1]] : ['bill'];
        }
        console.log(`📋 Detected motion outcome query (known motion): "${resolvedKeywords.join(' ')}"`);
        return { isMotionOutcome: true, motionKeywords: resolvedKeywords };
      }
    }

    // General patterns that indicate motion outcome query
    const outcomePatterns = [
      /did (?:the )?(.+?) (pass|fail|get approved|get rejected|succeed|motion pass|motion fail)/i,
      /was (?:the )?(.+?) (approved|rejected|passed|defeated|carried|lost)/i,
      /(?:the )?(.+?) (pass|fail|get approved|approved|rejected)\??$/i,
      /what (?:was|happened to) (?:the )?(.+?) (?:vote|motion|by-?law)/i,
      /result of (?:the )?(.+?) vote/i,
    ];

    for (const pattern of outcomePatterns) {
      const match = query.match(pattern);
      if (match) {
        // Extract keywords from the motion description
        const motionDesc = match[1];
        const keywords = motionDesc
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, ' ')
          .split(/\s+/)
          .filter(k => k.length > 2 && !['the', 'and', 'for', 'was', 'did', 'get', 'motion'].includes(k));

        if (keywords.length > 0) {
          console.log(`📋 Detected motion outcome query for: "${keywords.join(' ')}"`);
          return { isMotionOutcome: true, motionKeywords: keywords };
        }
      }
    }

    return { isMotionOutcome: false };
  }

  /**
   * Detect if this is a vote count query (how many voted X?)
   *
   * Patterns matched:
   * - "How many councillors voted against X?"
   * - "Who voted for the Cooling By-law?"
   * - "How many voted no on X?"
   * - "What was the vote count on X?"
   */
  private detectVoteCountQuery(query: string): { isVoteCount: boolean; motionKeywords?: string[] } {
    // Patterns for vote count queries
    const countPatterns = [
      /how many (?:councillors? )?voted (for|against|yes|no|yea|nay) (?:the )?(.+)/i,
      /who voted (for|against|yes|no|yea|nay) (?:the )?(.+)/i,
      /(?:vote|tally) count (?:on|for) (?:the )?(.+)/i,
      /what was the (?:final )?vote (?:count|breakdown|tally) (?:on|for) (?:the )?(.+)/i,
      /how (?:close|tight) was the (?:vote (?:on )?)?(.+)/i,
      /was (?:the )?(.+) (?:vote )?unanimous/i,
    ];

    for (const pattern of countPatterns) {
      const match = query.match(pattern);
      if (match) {
        // Get the motion description (last capture group usually)
        const motionDesc = match[match.length - 1] || match[1];
        const keywords = motionDesc
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, ' ')
          .split(/\s+/)
          .filter(k => k.length > 2 && !['the', 'and', 'for', 'was', 'vote', 'motion', 'on'].includes(k));

        if (keywords.length > 0) {
          console.log(`🔢 Detected vote count query for: "${keywords.join(' ')}"`);
          return { isVoteCount: true, motionKeywords: keywords };
        }
      }
    }

    return { isVoteCount: false };
  }

  /**
   * Detect if this is a close vote query with a specific date
   *
   * Patterns matched:
   * - "What close votes happened on October 14, 2025?"
   * - "Were there any close votes at the October 14 meeting?"
   * - "What was the closest vote on October 14, 2025?"
   */
  private detectCloseVoteQuery(query: string): { isCloseVote: boolean; date?: string } {
    const lowerQuery = query.toLowerCase();

    // Check for close vote keywords
    const closeVotePatterns = [
      /close vote/,
      /closest vote/,
      /tight vote/,
      /narrow vote/,
      /split vote/,
      /how close/,
      /narrow margin/,
      /7.?8|8.?7|6.?9|9.?6/,  // Common close vote margins
      /divides? council/,      // "What divides council evenly?"
      /evenly (split|divided)/, // "evenly split/divided"
      /most (contentious|divisive|controversial)/,  // "most contentious vote"
      /most divided/,
      /split (the )?council/,
      /council (is |was )?(most )?(divided|split)/,
    ];

    const hasCloseVoteKeyword = closeVotePatterns.some(p => p.test(lowerQuery));
    if (!hasCloseVoteKeyword) {
      return { isCloseVote: false };
    }

    // Try to extract a specific date
    // Patterns: "October 14, 2025", "October 14 2025", "2025-10-14"
    const months: Record<string, string> = {
      'january': '01', 'february': '02', 'march': '03', 'april': '04',
      'may': '05', 'june': '06', 'july': '07', 'august': '08',
      'september': '09', 'october': '10', 'november': '11', 'december': '12'
    };

    // Match "October 14, 2025" or "October 14 2025"
    const monthDayYearPattern = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s*(\d{4})/i;
    const match = query.match(monthDayYearPattern);
    if (match) {
      const month = months[match[1].toLowerCase()];
      const day = match[2].padStart(2, '0');
      const year = match[3];
      const date = `${year}-${month}-${day}`;
      console.log(`📊 Detected close vote query for date: ${date}`);
      return { isCloseVote: true, date };
    }

    // Match ISO format "2025-10-14"
    const isoDatePattern = /(\d{4})-(\d{2})-(\d{2})/;
    const isoMatch = query.match(isoDatePattern);
    if (isoMatch) {
      const date = isoMatch[0];
      console.log(`📊 Detected close vote query for date: ${date}`);
      return { isCloseVote: true, date };
    }

    // Has close vote keywords but no specific date
    return { isCloseVote: true };
  }

  /**
   * Detect if this is a query about the Mayor being in the minority
   * e.g., "Has the Mayor ever lost a vote?", "Was Morgan ever outvoted?"
   */
  private detectMayorMinorityQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    const mayorMinorityPatterns = [
      /mayor.*(minority|lost|outvoted|losing side|voted against)/,
      /morgan.*(minority|lost|outvoted|losing side)/,
      /(minority|lost|outvoted|losing side).*mayor/,
      /has.*(mayor|morgan).*ever.*(lost|minority|outvoted)/,
      /was.*(mayor|morgan).*in.*(the )?minority/,
      /vote.*(where|when).*mayor.*(lost|minority)/,
      /7-8.*mayor|8-7.*mayor.*nay|mayor.*nay.*8-7/,
    ];

    return mayorMinorityPatterns.some(p => p.test(lowerQuery));
  }

  /**
   * Detect if a query mentions ANY vote-related terms (catch-all)
   * Used as a fallback to route queries to structured vote lookup even when
   * specific detectors (motion outcome, vote count, councillor voting) don't fire.
   *
   * Matches:
   * - vote/voted/voting/ballot
   * - pass/fail/approve/reject/defeat/carry near a topic
   * - yea/nay/dissent/oppose/support/favour/favor/against
   * - bill/motion/amendment/by-law/bylaw
   * - unanimous/split/divided/controversial
   * - councillor name + any of the above
   * - vote count patterns like "11-4", "14-1", "15-0"
   */
  private detectAnyVoteQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    const voteTermPatterns = [
      // Core vote terms
      /\bvote[ds]?\b|\bvoting\b|\bballot\b/,
      // Outcome terms
      /\bpass(?:ed)?\b|\bfail(?:ed)?\b|\bapprove[ds]?\b|\bapproval\b|\breject(?:ed)?\b|\bdefeat(?:ed)?\b|\bcarr(?:ied|y)\b/,
      // Position/side terms
      /\byea\b|\bnay\b|\bdissent(?:ed)?\b|\boppos(?:e[ds]?|ing)\b|\bsupport(?:ed|s)?\b|\bfavou?r(?:ed|s)?\b|\bagainst\b/,
      // Document/motion types
      /\bbill\b|\bmotion\b|\bamendment\b|\bby-?law\b|\bbylaw\b/,
      // Consensus terms
      /\bunanimous(?:ly)?\b|\bsplit\b|\bdivided\b|\bcontroversial\b/,
      // Vote count patterns like "11-4", "14-1", "15-0"
      /\b\d{1,2}-\d{1,2}\b/,
    ];

    return voteTermPatterns.some(p => p.test(lowerQuery));
  }

  /**
   * Extract meaningful search keywords from a vote-related query.
   * Strips stop words and vote-related terms themselves, keeping nouns/proper nouns
   * and date terms as the signal for structured vote lookup.
   */
  private extractVoteKeywords(query: string): string[] {
    const lowerQuery = query.toLowerCase();

    // Words to strip: stop words + vote-related terms that are too generic
    const stopWords = new Set([
      // English stop words
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'about', 'against', 'between', 'out', 'off', 'over', 'under', 'again',
      'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'than',
      'too', 'very', 'just', 'but', 'and', 'or', 'nor', 'so', 'yet', 'it',
      'its', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
      'my', 'your', 'his', 'her', 'our', 'their', 'me', 'him', 'us', 'them',
      'i', 'we', 'you', 'he', 'she', 'they', 'any', 'not', 'no', 'up',
      // Vote-related terms (too generic as keywords)
      'vote', 'voted', 'voting', 'votes', 'ballot',
      'pass', 'passed', 'fail', 'failed', 'approve', 'approved', 'reject', 'rejected',
      'defeat', 'defeated', 'carry', 'carried',
      'yea', 'nay', 'dissent', 'oppose', 'opposed', 'support', 'favour', 'favor',
      'unanimous', 'split', 'divided', 'controversial',
      'motion', 'result', 'outcome', 'count', 'breakdown', 'tally',
      'councillor', 'councillors', 'council', 'mayor',
      'did', 'does', 'get', 'got', 'go', 'went', 'happen', 'happened',
    ]);

    // Extract date terms (keep these as keywords)
    const datePatterns = [
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/gi,
      /\b(20\d{2})\b/g,
      /\b\d{4}-\d{2}-\d{2}\b/g,
    ];

    const dateTerms: string[] = [];
    for (const datePattern of datePatterns) {
      const matches = lowerQuery.match(datePattern);
      if (matches) dateTerms.push(...matches);
    }

    // Tokenize and filter
    const tokens = lowerQuery
      .replace(/[^\w\s-]/g, ' ')   // remove punctuation except hyphens
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ');

    const keywords = tokens.filter(token => {
      if (!token || token.length < 3) return false;
      if (stopWords.has(token)) return false;
      // Skip pure numbers (unless they look like vote counts)
      if (/^\d+$/.test(token) && token.length < 4) return false;
      return true;
    });

    // Combine with date terms and deduplicate
    const all = [...new Set([...keywords, ...dateTerms])];

    // Limit to most useful keywords (first 8)
    return all.slice(0, 8);
  }

  /**
   * Detect if this is an alignment/pattern query
   *
   * Patterns matched:
   * - "Who votes with the Mayor?"
   * - "Who tends to be the lone dissenter?"
   * - "Is Hillier supportive of the Mayor?"
   * - "Who are the swing voters?"
   * - "Which councillors form the core of the majority?"
   */
  private detectAlignmentQuery(query: string): {
    isAlignmentQuery: boolean;
    alignmentQueryType?: 'mayor-allies' | 'mayor-opposition' | 'lone-dissenter' | 'swing-voters' | 'councillor-profile' | 'voting-bloc';
    alignmentCouncillorSlug?: string;
  } {
    const lowerQuery = query.toLowerCase();

    // Mayor allies patterns
    const mayorAlliesPatterns = [
      /who (usually |typically |often |generally )?(votes?|aligns?) with (the )?mayor/i,
      /who (supports?|backs?|follows?) (the )?mayor/i,
      /mayor'?s? (allies|supporters|voting bloc)/i,
      /councillors? (that|who) (vote|align) with (the )?mayor/i,
      /votes? (most )?often with (the )?mayor/i,
    ];

    for (const pattern of mayorAlliesPatterns) {
      if (pattern.test(lowerQuery)) {
        console.log(`🤝 Detected alignment query: mayor-allies`);
        return { isAlignmentQuery: true, alignmentQueryType: 'mayor-allies' };
      }
    }

    // Mayor opposition patterns
    const mayorOppositionPatterns = [
      /who (usually |typically |often |generally )?(votes?|disagrees?) against (the )?mayor/i,
      /who (opposes?|challenges?) (the )?mayor/i,
      /mayor'?s? (opposition|opponents|critics)/i,
      /councillors? (that|who) (vote|disagree) (against |with )(the )?mayor/i,
      /votes? (most )?against (the )?mayor/i,
      /least (often )?(with|aligned with) (the )?mayor/i,
    ];

    for (const pattern of mayorOppositionPatterns) {
      if (pattern.test(lowerQuery)) {
        console.log(`🤝 Detected alignment query: mayor-opposition`);
        return { isAlignmentQuery: true, alignmentQueryType: 'mayor-opposition' };
      }
    }

    // Lone dissenter patterns
    const loneDissentPatterns = [
      /lone dissenter/i,
      /votes? alone/i,
      /who (tends? to |usually |often )?dissent/i,
      /most (nay|no) votes/i,
      /votes? against (the )?majority/i,
      /independent (vote|voting|voice)/i,
      /goes? against (the )?grain/i,
      /contrarian/i,
    ];

    for (const pattern of loneDissentPatterns) {
      if (pattern.test(lowerQuery)) {
        console.log(`🤝 Detected alignment query: lone-dissenter`);
        return { isAlignmentQuery: true, alignmentQueryType: 'lone-dissenter' };
      }
    }

    // Swing voter patterns
    const swingVoterPatterns = [
      /swing (voter|councillor|vote)/i,
      /centrist/i,
      /moderate/i,
      /votes? (both ways|unpredictably)/i,
      /independent (minded|thinking)/i,
      /(who|which councillors?) (are|is) (in )?the (middle|center|centre)/i,
      /most variable voting/i,
      /votes? (on |based on )?(the )?(individual )?issue/i,
    ];

    for (const pattern of swingVoterPatterns) {
      if (pattern.test(lowerQuery)) {
        console.log(`🤝 Detected alignment query: swing-voters`);
        return { isAlignmentQuery: true, alignmentQueryType: 'swing-voters' };
      }
    }

    // Voting bloc / majority coalition patterns
    const votingBlocPatterns = [
      /voting bloc/i,
      /(core|main) (of|voting) (the )?(majority|coalition)/i,
      /majority (bloc|coalition|group)/i,
      /who (forms?|makes? up) (the )?(majority|coalition)/i,
      /reliable (majority|votes?)/i,
      /consistent (majority|coalition)/i,
      /broken? with (his|her|their) (usual )?(bloc|group|coalition)/i,
    ];

    for (const pattern of votingBlocPatterns) {
      if (pattern.test(lowerQuery)) {
        console.log(`🤝 Detected alignment query: voting-bloc`);
        return { isAlignmentQuery: true, alignmentQueryType: 'voting-bloc' };
      }
    }

    // Councillor-specific alignment patterns (e.g., "Is Hillier supportive of the Mayor?")
    const councillorAlignmentPatterns = [
      /is (\w+) (generally |usually |typically )?(supportive|aligned|close) (of|with|to) (the )?mayor/i,
      /does (\w+) (generally |usually |typically )?(support|back|align with|vote with) (the )?mayor/i,
      /(\w+)'?s? (alignment|relationship) (with|to) (the )?mayor/i,
      /how (does|did) (\w+) (typically |usually |generally )?(vote|align)/i,
      /(\w+)'?s? voting (pattern|record|history)/i,
      /who does (\w+) (vote|align) with/i,
      /what predicts (how )?(\w+)'?s? vote/i,
    ];

    for (const pattern of councillorAlignmentPatterns) {
      const match = query.match(pattern);
      if (match) {
        // Try to extract councillor name
        const potentialName = match[1] || match[2];
        if (potentialName && !['the', 'council', 'city', 'how'].includes(potentialName.toLowerCase())) {
          const slug = this.councillorNameToSlug(potentialName);
          if (slug) {
            console.log(`🤝 Detected alignment query: councillor-profile for ${potentialName} (${slug})`);
            return { isAlignmentQuery: true, alignmentQueryType: 'councillor-profile', alignmentCouncillorSlug: slug };
          }
        }
      }
    }

    return { isAlignmentQuery: false };
  }

  /**
   * Retrieve relevant context from vector store
   * Uses unified query analysis to determine optimal retrieval strategy
   */
  async retrieveContext(query: string): Promise<SearchResult[]> {
    // Analyze query to extract all metadata
    const analysis = this.analyzeQuery(query);
    const { topK, isMostRecent, specificMonth, meetingTypeFilter, isCouncillorVotingQuery, councillorName, wantsHistoricalContext, isMotionOutcomeQuery, isVoteCountQuery, motionKeywords, isCloseVoteQuery, closeVoteDate, isMayorMinorityQuery, isAlignmentQuery, alignmentQueryType, alignmentCouncillorSlug, isMultiHopQuery, multiHopQuery } = analysis;

    // Strategy 1: Specific month/year query (e.g., "meetings in november 2025")
    // Use date-range search, bypassing semantic similarity
    if (specificMonth) {
      console.log(`📆 Specific month query: ${specificMonth.month + 1}/${specificMonth.year}`);

      // If this is also a motion/vote query, call vote lookup FIRST for verified data
      if ((isMotionOutcomeQuery || isVoteCountQuery) && motionKeywords && motionKeywords.length > 0) {
        console.log(`📊 Motion/vote query with date filter - using structured vote lookup for: "${motionKeywords.join(' ')}"`);

        let verifiedVoteContext = '';
        if (this.voteLookupInitialized) {
          const motionResults = voteLookupService.findAllMotionVotes(motionKeywords);
          if (motionResults.length > 0) {
            verifiedVoteContext = voteLookupService.formatAllMotionVotesForContext(motionResults);
            console.log(`   ✅ Found VERIFIED motion vote breakdown: ${motionResults.length} motion(s)`);
          } else {
            console.log(`   ⚠️ No matching motion found in structured vote data`);
          }
        }
        // Store verified context for later inclusion
        (this as any)._verifiedVoteContext = verifiedVoteContext;
      }

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
    // Skip if this is a councillor voting query - let Strategy 4 handle those even when "most recent" is detected
    if (isMostRecent && !isCouncillorVotingQuery) {
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

    // Strategy 3: Motion outcome or vote count query
    // Uses structured vote data for VERIFIED accuracy on "did X pass?" and "how many voted against X?" queries
    // Skip if this is a multi-hop query (handled by Strategy 3.8)
    if ((isMotionOutcomeQuery || isVoteCountQuery) && motionKeywords && motionKeywords.length > 0 && !isMultiHopQuery) {
      console.log(`📊 Motion/vote query detected - using structured vote lookup for: "${motionKeywords.join(' ')}"`);

      let verifiedVoteContext = '';
      if (this.voteLookupInitialized) {
        const motionResults = voteLookupService.findAllMotionVotes(motionKeywords);
        if (motionResults.length > 0) {
          verifiedVoteContext = voteLookupService.formatAllMotionVotesForContext(motionResults);
          console.log(`   ✅ Found VERIFIED motion vote breakdown: ${motionResults.length} motion(s)`);
        } else {
          console.log(`   ⚠️ No matching motion found in structured vote data`);
        }
      }

      // Store verified context for later inclusion
      (this as any)._verifiedVoteContext = verifiedVoteContext;

      // Also do semantic search to get additional context about the motion
      const normalizedQuery = this.normalizeQueryForEmbedding(query);
      const queryEmbedding = await this.generateQueryEmbedding(normalizedQuery);

      // Use hybrid search with high keyword weight to find exact motion text
      const hybridQuery = `${motionKeywords.join(' ')} motion vote passed failed councillors yea nay`;
      const results = await this.vectorStore.hybridSearch(
        queryEmbedding,
        hybridQuery,
        topK,
        0.6  // Weight toward keyword matching for motion names
      );

      // Also get news coverage which often has vote breakdowns
      const newsResults = await this.vectorStore.getRecentNewsCoverage(Math.floor(topK * 0.3), 12);

      // Combine and dedupe
      const seenIds = new Set<string>();
      const combined: SearchResult[] = [];

      for (const result of [...newsResults, ...results]) {
        const id = `${result.metadata.meeting_date}-${result.metadata.item_number}-${result.text.substring(0, 50)}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          combined.push(result);
        }
      }

      // Sort by date descending
      combined.sort((a, b) => new Date(b.metadata.meeting_date).getTime() - new Date(a.metadata.meeting_date).getTime());

      this.logUniqueMeetings(combined);
      return combined.slice(0, topK);
    }

    // Strategy 3.5: Close vote query with specific date
    // Uses structured vote data to find all close votes on a given date
    if (isCloseVoteQuery && closeVoteDate) {
      console.log(`📊 Close vote query for date: ${closeVoteDate}`);

      let verifiedVoteContext = '';
      if (this.voteLookupInitialized) {
        const closeVotes = voteLookupService.findCloseVotesByDate(closeVoteDate);
        if (closeVotes.length > 0) {
          verifiedVoteContext = voteLookupService.formatCloseVotesForContext(closeVotes);
          console.log(`   ✅ Found ${closeVotes.length} close votes on ${closeVoteDate}`);
        } else {
          console.log(`   ⚠️ No close votes found on ${closeVoteDate}`);
        }
      }

      // Store verified context for later inclusion
      (this as any)._verifiedVoteContext = verifiedVoteContext;

      // Also do semantic search to get additional context
      const normalizedQuery = this.normalizeQueryForEmbedding(query);
      const queryEmbedding = await this.generateQueryEmbedding(normalizedQuery);

      // Search for content from that date
      const results = await this.vectorStore.hybridSearch(
        queryEmbedding,
        `${closeVoteDate} close vote 7-8 narrow margin councillors yea nay`,
        topK,
        0.5
      );

      this.logUniqueMeetings(results);
      return results;
    }

    // Strategy 3.6: Close vote query WITHOUT specific date
    // Finds all close votes across recent meetings
    if (isCloseVoteQuery && !closeVoteDate) {
      console.log(`📊 General close vote query (no specific date) - finding all close votes`);

      let verifiedVoteContext = '';
      if (this.voteLookupInitialized) {
        const closeVotes = voteLookupService.findAllCloseVotes(2, 10, 24); // margin <=2, top 10, last 24 months
        if (closeVotes.length > 0) {
          verifiedVoteContext = voteLookupService.formatCloseVotesForContext(closeVotes);
          console.log(`   ✅ Found ${closeVotes.length} close votes across all dates`);
        } else {
          console.log(`   ⚠️ No close votes found`);
        }
      }

      // Store verified context for later inclusion
      (this as any)._verifiedVoteContext = verifiedVoteContext;

      // Also do semantic search to get additional context
      const normalizedQuery = this.normalizeQueryForEmbedding(query);
      const queryEmbedding = await this.generateQueryEmbedding(normalizedQuery);

      const results = await this.vectorStore.hybridSearch(
        queryEmbedding,
        `close vote 7-8 8-7 narrow margin contentious divisive split council`,
        topK,
        0.5
      );

      this.logUniqueMeetings(results);
      return results;
    }

    // Strategy 3.65: Mayor minority query (votes where Mayor was outvoted)
    // Uses structured vote data to find votes where Mayor Morgan was in the minority
    if (isMayorMinorityQuery) {
      console.log(`📊 Mayor minority query - finding votes where Mayor was outvoted`);

      let verifiedVoteContext = '';
      if (this.voteLookupInitialized) {
        const mayorMinorityVotes = voteLookupService.findVotesWhereMayorInMinority(5, 24);
        if (mayorMinorityVotes.length > 0) {
          verifiedVoteContext = voteLookupService.formatMayorMinorityVotesForContext(mayorMinorityVotes);
          console.log(`   ✅ Found ${mayorMinorityVotes.length} votes where Mayor was in minority`);
        } else {
          console.log(`   ⚠️ No votes found where Mayor was in minority`);
        }
      }

      // Store verified context for later inclusion
      (this as any)._verifiedVoteContext = verifiedVoteContext;

      // Also do semantic search to get additional context
      const normalizedQuery = this.normalizeQueryForEmbedding(query);
      const queryEmbedding = await this.generateQueryEmbedding(normalizedQuery);

      const results = await this.vectorStore.hybridSearch(
        queryEmbedding,
        `mayor morgan minority outvoted lost vote 7-8 8-7 narrow margin`,
        topK,
        0.5
      );

      this.logUniqueMeetings(results);
      return results;
    }

    // Strategy 3.7: Alignment/pattern query
    // Uses pre-computed councillor alignment data for verified accuracy
    if (isAlignmentQuery && this.councillorStatsInitialized) {
      console.log(`🤝 Alignment query detected - using councillor stats lookup (type: ${alignmentQueryType})`);

      let verifiedAlignmentContext = '';

      switch (alignmentQueryType) {
        case 'mayor-allies':
          verifiedAlignmentContext = councillorStatsLookupService.formatMayorAlignmentForContext();
          console.log(`   ✅ Loaded Mayor alignment data (allies and opposition)`);
          break;

        case 'mayor-opposition':
          verifiedAlignmentContext = councillorStatsLookupService.formatMayorAlignmentForContext();
          console.log(`   ✅ Loaded Mayor alignment data (allies and opposition)`);
          break;

        case 'lone-dissenter':
          verifiedAlignmentContext = councillorStatsLookupService.formatLoneDissentersForContext();
          console.log(`   ✅ Loaded lone dissenter data`);
          break;

        case 'swing-voters':
          verifiedAlignmentContext = councillorStatsLookupService.formatSwingVotersForContext();
          console.log(`   ✅ Loaded swing voter data`);
          break;

        case 'councillor-profile':
          if (alignmentCouncillorSlug) {
            // Use the richer record format which includes dissent rate, budget voting, notable dissents
            verifiedAlignmentContext = councillorStatsLookupService.formatCouncillorRecordForContext(alignmentCouncillorSlug);
            // Fall back to alignment-only if record format returns empty
            if (!verifiedAlignmentContext) {
              verifiedAlignmentContext = councillorStatsLookupService.formatCouncillorAlignmentForContext(alignmentCouncillorSlug);
            }
            console.log(`   ✅ Loaded councillor record profile for ${alignmentCouncillorSlug}`);
          }
          break;

        case 'voting-bloc':
          // For voting bloc queries, provide both Mayor alignment and swing voter data
          verifiedAlignmentContext = councillorStatsLookupService.formatMayorAlignmentForContext() +
            '\n' + councillorStatsLookupService.formatSwingVotersForContext();
          console.log(`   ✅ Loaded voting bloc data (Mayor alignment + swing voters)`);
          break;
      }

      // Store verified context for later inclusion
      (this as any)._verifiedVoteContext = verifiedAlignmentContext;

      // Also do semantic search to get additional context from meeting records
      const normalizedQuery = this.normalizeQueryForEmbedding(query);
      const queryEmbedding = await this.generateQueryEmbedding(normalizedQuery);

      const results = await this.vectorStore.hybridSearch(
        queryEmbedding,
        `councillor alignment vote voting pattern bloc majority ${query}`,
        topK,
        0.5
      );

      this.logUniqueMeetings(results);
      return results;
    }

    // Strategy 3.8: Multi-hop vote query
    // Cross-references multiple votes to find councillors matching all criteria
    // e.g., "Find councillors who voted NAY on Cooling, YEA on Warming Centre, NAY on diaper waste"
    if (isMultiHopQuery && multiHopQuery) {
      console.log(`🔀 Multi-hop vote query detected - ${multiHopQuery.criteria.length} criteria, operation: ${multiHopQuery.operation}`);

      const multiHopResult = await executeMultiHopQuery(multiHopQuery);

      if (multiHopResult.success) {
        const multiHopContext = formatMultiHopContext(multiHopResult, multiHopQuery);
        console.log(`   ✅ Multi-hop query found ${multiHopResult.councillors.length} matching councillor(s)`);

        // Store multi-hop context for later inclusion
        (this as any)._verifiedVoteContext = multiHopContext;

        // Also do semantic search to get additional context about the motions
        const normalizedQuery = this.normalizeQueryForEmbedding(query);
        const queryEmbedding = await this.generateQueryEmbedding(normalizedQuery);

        // Build keyword query from all criteria
        const allKeywords = multiHopQuery.criteria.flatMap(c => c.motionKeywords);
        const hybridQuery = `${allKeywords.join(' ')} vote motion councillor passed failed`;
        const results = await this.vectorStore.hybridSearch(
          queryEmbedding,
          hybridQuery,
          topK,
          0.5
        );

        this.logUniqueMeetings(results);
        return results;
      } else {
        console.log(`   ⚠️ Multi-hop query found no matching councillors`);
        // Still store the result summary
        (this as any)._verifiedVoteContext = formatMultiHopContext(multiHopResult, multiHopQuery);
      }
    }

    // Strategy 4: Councillor voting query - HYBRID retrieval
    // Combines semantic search for topic relevance with recent data to ensure temporal coverage
    // Also searches specifically for the councillor's name to find their votes even when absent
    // CRITICAL: Also includes news_coverage chunks which contain vote breakdowns
    // This prevents bias toward older, more verbose content
    // NEW: Uses hybrid search (vector + BM25) for better councillor name matching
    // NEW: Uses structured vote data for VERIFIED accuracy
    if (isCouncillorVotingQuery) {
      const recentOnly = !wantsHistoricalContext;
      console.log(`🗳️ Councillor voting query${councillorName ? ` for ${councillorName}` : ''} - using hybrid retrieval${recentOnly ? ' (RECENT ONLY - filtering out old data)' : ' (historical context requested)'}`);

      // NEW: Try structured vote lookup FIRST for verified accuracy
      let verifiedVoteContext = '';
      if (this.voteLookupInitialized) {
        const topicKeywords = this.extractTopicKeywords(query)?.split(' ').filter(k => k.length > 2) || [];

        if (councillorName && topicKeywords.length > 0) {
          // Looking for a specific councillor's vote on a topic
          const councillorSlug = this.councillorNameToSlug(councillorName);
          if (councillorSlug) {
            const voteResult = voteLookupService.findCouncillorVote(councillorSlug, topicKeywords);
            if (voteResult) {
              verifiedVoteContext = voteLookupService.formatVoteForContext(voteResult);
              console.log(`   ✅ Found VERIFIED vote record for ${councillorName}`);
            }
          }
        } else if (topicKeywords.length > 0) {
          // Looking for all votes on a motion (who voted for/against)
          const motionResults = voteLookupService.findAllMotionVotes(topicKeywords);
          if (motionResults.length > 0) {
            verifiedVoteContext = voteLookupService.formatAllMotionVotesForContext(motionResults);
            console.log(`   ✅ Found VERIFIED motion vote breakdown`);
          }
        }
      }

      // Inject councillor stats profile for overall record grounding
      // This gives the LLM hard numbers (dissent rate, budget voting, notable dissents)
      // to prevent vague positive summaries
      if (this.councillorStatsInitialized && councillorName) {
        const councillorSlug = this.councillorNameToSlug(councillorName);
        if (councillorSlug) {
          const statsContext = councillorStatsLookupService.formatCouncillorRecordForContext(councillorSlug);
          if (statsContext) {
            verifiedVoteContext = verifiedVoteContext
              ? verifiedVoteContext + '\n\n' + statsContext
              : statsContext;
            console.log(`   📊 Injected councillor stats profile for ${councillorName}`);
          }
        }
      }

      // Store verified context for later inclusion
      (this as any)._verifiedVoteContext = verifiedVoteContext;

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
        wantsHistoricalContext ? Math.floor(topK * 0.5) : Math.floor(topK * 0.4),
        0.6  // Weight toward keyword matching for councillor names
      );
      console.log(`   Hybrid search: ${semanticResults.length} results (vector + BM25)`);

      // 2. Get recent results to ensure we don't miss recent votes
      const recentResults = await this.vectorStore.getMostRecent(Math.floor(topK * 0.3));

      // 3. Get news_coverage chunks which contain actual vote breakdowns
      // These are the chunks that say "Councillors who voted AGAINST: ..."
      // For historical queries, expand to full available range (180 months) to get temporal spread
      const newsCoverageMonths = wantsHistoricalContext ? 180 : 6;
      const newsCoverageResults = await this.vectorStore.getRecentNewsCoverage(Math.floor(topK * 0.3), newsCoverageMonths);
      console.log(`   News coverage search: ${newsCoverageResults.length} results with vote breakdowns (${newsCoverageMonths} months)`);

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

      // 5. For historical queries, also search older date ranges to get temporal spread
      // This ensures we don't just get recent results when the user wants overall record
      let historicalSpreadResults: SearchResult[] = [];
      if (wantsHistoricalContext && councillorName) {
        const currentYear = new Date().getFullYear();
        // Search across multiple years for this councillor's voting activity
        for (let year = currentYear - 4; year <= currentYear - 1; year++) {
          for (const month of [1, 6]) { // Sample Jan and Jun of each year
            const yearResults = await this.vectorStore.searchByDateRange(month, year, 10);
            // Filter to only chunks mentioning this councillor
            const councillorChunks = yearResults.filter(r =>
              r.text.toLowerCase().includes(councillorName!.toLowerCase().split(' ').pop()!)
            );
            historicalSpreadResults.push(...councillorChunks.slice(0, 3));
          }
        }
        console.log(`   Historical spread search: ${historicalSpreadResults.length} results across ${currentYear - 4}-${currentYear - 1}`);
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

      // Add in order: news_coverage FIRST (has vote breakdowns), then recent, then semantic, then name-based, then topic-based, then historical spread
      addResults(newsCoverageResults);  // CRITICAL: These contain "Councillors who voted AGAINST: ..."
      addResults(recentResults);
      addResults(semanticResults);
      addResults(councillorNameResults);
      addResults(councillorTopicResults);
      if (historicalSpreadResults.length > 0) {
        addResults(historicalSpreadResults);
      }

      // Sort by date descending so recent votes appear first in context
      const sorted = combinedResults.sort((a, b) => {
        const dateA = new Date(a.metadata.meeting_date).getTime();
        const dateB = new Date(b.metadata.meeting_date).getTime();
        return dateB - dateA;
      });

      this.logUniqueMeetings(sorted);
      console.log(`   Combined: ${newsCoverageResults.length} news_coverage + ${recentResults.length} recent + ${semanticResults.length} semantic + ${councillorNameResults.length} name + ${councillorTopicResults.length} topic + ${historicalSpreadResults.length} historical = ${sorted.length} unique chunks`);

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

    // Strategy 3.9: Catch-all vote query
    // If the query mentions any vote-related terms and wasn't caught by specific detectors above,
    // try the structured vote lookup anyway before falling back to pure semantic search.
    // This catches queries like "did the integrity commissioner motion pass?" that slip through
    // the rigid regex patterns in detectMotionOutcomeQuery.
    {
      let catchAllVoteContext = '';
      if (this.detectAnyVoteQuery(query) && !isMotionOutcomeQuery && !isVoteCountQuery && !isCouncillorVotingQuery && !isCloseVoteQuery && !isMayorMinorityQuery && !isAlignmentQuery) {
        const keywords = this.extractVoteKeywords(query);
        if (keywords.length > 0 && this.voteLookupInitialized) {
          console.log(`🔍 Catch-all vote query: trying structured lookup for keywords "${keywords.join(' ')}"`);
          const motionResults = voteLookupService.findAllMotionVotes(keywords);
          if (motionResults.length > 0) {
            catchAllVoteContext = voteLookupService.formatAllMotionVotesForContext(motionResults);
            console.log(`   ✅ Catch-all found VERIFIED motion vote breakdown: ${motionResults.length} motion(s)`);
          } else {
            console.log(`   ⚠️ Catch-all: no matching motion found in structured data`);
          }
        }
      }
      if (catchAllVoteContext) {
        (this as any)._verifiedVoteContext = catchAllVoteContext;
      }
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
    // Pass normalizedQuery (with synonyms appended) to the BM25 path so that, e.g.,
    // "high school transit pilot" also matches documents containing "secondary school transit".
    console.log(`🔀 Using hybrid search for general query`);
    const results = await this.vectorStore.hybridSearch(queryEmbedding, normalizedQuery, topK, 0.5);

    // Councillor validation: detect if we got stale data
    // If all councillors mentioned in results are former (not current), re-search with recency filter
    const councillorNames = this.extractCouncillorNamesFromResults(results);
    if (councillorNames.length > 0) {
      const { current, former } = this.categorizeCouncillors(councillorNames);

      if (former.length > 0 && current.length === 0) {
        console.log(`⚠️ All councillors in results are FORMER: ${former.join(', ')}`);
        console.log(`   Re-searching with recency filter (last 2 years)...`);

        // Re-search with date filter (last 2 years only)
        const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
        const recentResults = await this.vectorStore.searchByDateRangeWithVector(
          queryEmbedding,
          twoYearsAgo,
          new Date(),
          topK
        );

        if (recentResults.length >= 3) {
          console.log(`   ✅ Found ${recentResults.length} recent results after recency re-search`);
          return recentResults;
        } else {
          console.log(`   ⚠️ Recency re-search found only ${recentResults.length} results, using original results`);
        }
      } else if (current.length > 0) {
        console.log(`   ✅ Results contain current councillors: ${current.join(', ')}`);
      }
    }

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
   * Extract councillor names from search results
   * Looks for patterns like "Councillor Morgan" or "Mayor Lewis"
   */
  private extractCouncillorNamesFromResults(results: SearchResult[]): string[] {
    const names = new Set<string>();
    const namePattern = /(?:Councillor|Mayor)\s+([A-Z]\.\s*)?([A-Z][a-z]+)/g;

    for (const r of results) {
      const matches = r.text.matchAll(namePattern);
      for (const m of matches) {
        names.add(m[2]); // Last name
      }
    }
    return Array.from(names);
  }

  /**
   * Categorize councillor names as current or former
   * Uses the councillor registry to determine status
   */
  private categorizeCouncillors(names: string[]): { current: string[], former: string[] } {
    // Build list of current councillor last names
    const currentCouncillorsData = getCurrentCouncillors();
    const currentLastNames = new Set<string>();

    for (const { info } of currentCouncillorsData) {
      // Extract last name from displayName (e.g., "Josh Morgan" -> "morgan")
      const parts = info.displayName.split(' ');
      if (parts.length > 0) {
        const lastName = parts[parts.length - 1].toLowerCase();
        currentLastNames.add(lastName);
      }
    }

    const current: string[] = [];
    const former: string[] = [];

    for (const name of names) {
      if (currentLastNames.has(name.toLowerCase())) {
        current.push(name);
      } else {
        // Only mark as former if it's in the councillor registry at all
        // This avoids false positives from non-councillor names
        const allCouncillors = getAllCouncillors();
        const isKnownCouncillor = allCouncillors.some(({ info }) => {
          const parts = info.displayName.split(' ');
          const lastName = parts[parts.length - 1].toLowerCase();
          return lastName === name.toLowerCase();
        });
        if (isKnownCouncillor) {
          former.push(name);
        }
      }
    }

    return { current, former };
  }

  /**
   * Extract unique sources from search results for display in chat UI
   */
  private extractSources(results: SearchResult[]): ChatSource[] {
    const sourceMap = new Map<string, ChatSource>();

    for (const result of results) {
      const meta = result.metadata;
      const key = `${meta.meeting_title}-${meta.meeting_date}`;

      if (!sourceMap.has(key)) {
        // Convert file_path to internal Quartz URL
        // Handle both relative (data/...) and absolute (/usr/src/app/data/...) paths
        const dataIndex = meta.file_path.indexOf('data/');
        const relativePath = dataIndex !== -1 ? meta.file_path.substring(dataIndex) : meta.file_path;
        const internalUrl = '/months/' + relativePath
          .replace('data/', '')
          .replace('.json', '')
          .replace(/ /g, '-');

        sourceMap.set(key, {
          title: meta.meeting_title,
          date: meta.meeting_date,
          url: internalUrl,
          type: meta.meeting_type,
        });
      }
    }

    // Sort by date descending (most recent first)
    return Array.from(sourceMap.values()).sort((a, b) =>
      b.date.localeCompare(a.date)
    );
  }

  /**
   * Build context string from search results
   * Prepends verified vote data if available for higher accuracy
   */
  private buildContextString(results: SearchResult[]): string {
    // Check for verified vote context from structured data lookup
    const verifiedVoteContext = (this as any)._verifiedVoteContext || '';
    // Clear it after use
    (this as any)._verifiedVoteContext = '';
    // Track whether structured data was used (for response validation)
    if (verifiedVoteContext) {
      (this as any)._usedStructuredData = true;
    }

    if (results.length === 0 && !verifiedVoteContext) {
      return 'No relevant information found in the city council meeting records.';
    }

    const chunksContext = results
      .map((result, idx) => {
        const meta = result.metadata;

        // Convert file_path to internal Quartz URL
        // e.g., "data/2024-09/2024-09-24 Council.json" -> "/months/2024-09/2024-09-24-Council"
        // Handle both relative and absolute paths (server may store full path)
        const dataIdx = meta.file_path.indexOf('data/');
        const relPath = dataIdx !== -1 ? meta.file_path.substring(dataIdx) : meta.file_path;
        const internalUrl = '/months/' + relPath
          .replace('data/', '')
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

    // Prepend verified vote context if available (highest priority data)
    if (verifiedVoteContext) {
      return verifiedVoteContext + '\n\n---\n\n# Additional Context from Meeting Records\n\n' + chunksContext;
    }

    return chunksContext;
  }

  /**
   * Chat with streaming using OpenAI
   */
  async *chatStreamOpenAI(
    message: string,
    history: ChatMessage[] = [],
    metadataCollector?: ChatMetadataCollector
  ): AsyncGenerator<string, void, unknown> {
    // Retrieve relevant context with truncation
    const rawResults = await this.retrieveContext(message);
    const results = this.truncateContextToFit(rawResults, 'gpt-4o');
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
      metadataCollector.sources = this.extractSources(results);
      // Detect topics in the query
      const detectedTopics = detectTopicsInQuery(message);
      metadataCollector.detectedTopics = detectedTopics.map(t => t.name);
      // Track whether structured data was used (set by buildContextString)
      if ((this as any)._usedStructuredData) {
        metadataCollector.usedStructuredData = true;
        (this as any)._usedStructuredData = false;
      }
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

    // Retrieve relevant context with truncation
    const rawResults = await this.retrieveContext(message);
    const results = this.truncateContextToFit(rawResults, 'claude-sonnet-4-5-20250929');
    const context = this.buildContextString(results);

    // Split system prompt for caching:
    // - Static instructions: cached (same across all queries, ~4K tokens)
    // - Dynamic context: NOT cached (changes per query)
    const staticInstructions = getStaticSystemPrompt();
    const dynamicContext = getContextBlock(context);

    // Populate metadata for logging
    if (metadataCollector) {
      const analysis = this.analyzeQuery(message);
      metadataCollector.topK = analysis.topK;
      metadataCollector.contextChunksUsed = results.length;
      metadataCollector.llmProvider = 'anthropic';
      metadataCollector.model = 'claude-sonnet-4-5-20250929';
      metadataCollector.sources = this.extractSources(results);
      // Detect topics in the query
      const detectedTopics = detectTopicsInQuery(message);
      metadataCollector.detectedTopics = detectedTopics.map(t => t.name);
      // Track whether structured data was used (set by buildContextString)
      if ((this as any)._usedStructuredData) {
        metadataCollector.usedStructuredData = true;
        (this as any)._usedStructuredData = false;
      }
    }

    // Build messages array
    const messages: Anthropic.MessageParam[] = [
      ...history.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: 'user', content: message },
    ];

    // Stream response with prompt caching enabled
    // See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
    // Two system blocks:
    // 1. Static instructions WITH cache_control - cached for 5 min, saves ~90% on ~4K tokens
    // 2. Dynamic context WITHOUT cache_control - changes per query, not cached
    const stream = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      temperature: 0.4,  // Lower for more focused, consistent responses
      system: [
        {
          type: 'text',
          text: staticInstructions,
          cache_control: { type: 'ephemeral' }
        },
        {
          type: 'text',
          text: dynamicContext,
          // No cache_control - this changes per query
        }
      ],
      messages,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
      // Log cache statistics from final message event
      if (event.type === 'message_delta' && event.usage) {
        const usage = event.usage as { output_tokens: number };
        console.log(`📊 Anthropic usage: output_tokens=${usage.output_tokens}`);
      }
      if (event.type === 'message_start' && event.message?.usage) {
        const usage = event.message.usage as {
          input_tokens: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
        const cacheCreated = usage.cache_creation_input_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const regularInput = usage.input_tokens - cacheCreated - cacheRead;
        console.log(`📊 Anthropic usage: input_tokens=${usage.input_tokens} (regular=${regularInput}, cache_created=${cacheCreated}, cache_read=${cacheRead})`);
        if (cacheRead > 0) {
          console.log(`   ✅ CACHE HIT: ${cacheRead} tokens read from cache (90% cost savings on these tokens)`);
        } else if (cacheCreated > 0) {
          console.log(`   📝 CACHE MISS: ${cacheCreated} tokens written to cache (will be cached for 5 min)`);
        }
      }
    }
  }

  /**
   * Chat with streaming using OpenRouter
   * OpenRouter provides a unified API to access multiple LLM providers at lower cost
   */
  async *chatStreamOpenRouter(
    message: string,
    history: ChatMessage[] = [],
    metadataCollector?: ChatMetadataCollector
  ): AsyncGenerator<string, void, unknown> {
    if (!this.openrouter) {
      throw new Error('OpenRouter API key not configured');
    }

    // Retrieve relevant context with truncation
    const rawResults = await this.retrieveContext(message);
    const modelId = OPENROUTER_MODELS[this.openrouterModel];
    const results = this.truncateContextToFit(rawResults, modelId);
    const context = this.buildContextString(results);
    const systemPrompt = getSystemPrompt(context);

    // Populate metadata for logging
    if (metadataCollector) {
      const analysis = this.analyzeQuery(message);
      metadataCollector.topK = analysis.topK;
      metadataCollector.contextChunksUsed = results.length;
      metadataCollector.llmProvider = 'openrouter';
      metadataCollector.model = modelId;
      metadataCollector.sources = this.extractSources(results);
      const detectedTopics = detectTopicsInQuery(message);
      metadataCollector.detectedTopics = detectedTopics.map(t => t.name);
      // Track whether structured data was used (set by buildContextString)
      if ((this as any)._usedStructuredData) {
        metadataCollector.usedStructuredData = true;
        (this as any)._usedStructuredData = false;
      }
    }

    // Build messages array
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: message },
    ];

    console.log(`📤 OpenRouter request: model=${modelId}, messages=${messages.length}`);

    try {
      const stream = await this.openrouter.chat.completions.create({
        model: modelId,
        messages,
        max_tokens: 4000,
        temperature: 0.4,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }
    } catch (error) {
      const err = error as { message?: string; status?: number; code?: string };
      console.error('OpenRouter API error:', err?.message);
      console.error('   Status:', err?.status);
      console.error('   Code:', err?.code);
      throw error;
    }
  }

  /**
   * Set the OpenRouter model to use
   */
  setOpenRouterModel(model: OpenRouterModel): void {
    this.openrouterModel = model;
    console.log(`🔄 OpenRouter model set to: ${model} (${OPENROUTER_MODELS[model]})`);
  }

  /**
   * Get the current OpenRouter model
   */
  getOpenRouterModel(): OpenRouterModel {
    return this.openrouterModel;
  }

  // Smart routing constants
  private static readonly SIMPLE_MODEL: OpenRouterModel = 'gemini-3-flash';
  private static readonly COMPLEX_MODEL: OpenRouterModel = 'gemini-3-flash';  // was claude-sonnet-4 ($0.17-0.46/query); gemini-3-flash costs ~$0.02/query
  private static readonly COMPLEXITY_THRESHOLD = 150; // TOP_K >= 150 → complex model

  // Context budget per model (in characters, ~4 chars per token)
  // Leave room for system prompt (~4K tokens) + history + response
  private static readonly MODEL_CONTEXT_BUDGETS: Record<string, number> = {
    // OpenAI
    'gpt-4o': 400_000,                        // 128K tokens → ~100K usable
    // Anthropic direct
    'claude-sonnet-4-5-20250929': 600_000,     // 200K tokens → ~150K usable
    // OpenRouter models
    'meta-llama/llama-3.3-70b-instruct': 480_000,  // 128K tokens → ~120K usable
    'anthropic/claude-sonnet-4': 600_000,
    'anthropic/claude-sonnet-4.5': 600_000,
    'anthropic/claude-3-haiku': 600_000,
    'anthropic/claude-3.5-haiku': 600_000,
    'google/gemini-2.5-flash-lite': 400_000,
    'google/gemini-2.0-flash-001': 400_000,
    'google/gemini-2.5-flash': 400_000,
    'openai/gpt-4o-mini': 400_000,
    'qwen/qwen-2.5-72b-instruct': 400_000,
    'deepseek/deepseek-chat': 400_000,
    'mistralai/mistral-large-2411': 400_000,
    'cohere/command-r-08-2024': 400_000,
  'google/gemini-3-flash-preview': 800_000,       // 1M tokens → ~200K usable
  'google/gemini-3.1-flash-lite-preview': 800_000,
  'meta-llama/llama-4-maverick': 800_000,           // 1M tokens
  'meta-llama/llama-4-scout': 260_000,              // 328K tokens
  'qwen/qwen3.6-plus:free': 800_000,               // 1M tokens
  'qwen/qwen3.5-flash-02-23': 800_000,             // 1M tokens
  };

  /**
   * Truncate context chunks to fit within model's context budget
   */
  private truncateContextToFit(results: SearchResult[], modelId: string): SearchResult[] {
    const budget = RAGService.MODEL_CONTEXT_BUDGETS[modelId] || 400_000;
    let totalChars = 0;
    const truncated: SearchResult[] = [];

    for (const result of results) {
      const chunkSize = result.text.length + 200; // ~200 chars metadata overhead per chunk
      if (totalChars + chunkSize > budget) {
        console.log(`⚠️ Context truncated: using ${truncated.length}/${results.length} chunks to fit ${modelId} budget (${budget.toLocaleString()} chars)`);
        break;
      }
      totalChars += chunkSize;
      truncated.push(result);
    }

    return truncated;
  }

  /**
   * Main chat method that uses configured provider
   * Smart routing: picks model by query complexity, OpenRouter-first
   */
  async *chat(
    message: string,
    history: ChatMessage[] = [],
    metadataCollector?: ChatMetadataCollector
  ): AsyncGenerator<string, void, unknown> {
    // Determine complexity for smart routing
    const analysis = this.analyzeQuery(message);
    const topK = analysis.topK || TOP_K_SIMPLE;
    const isComplex = topK >= RAGService.COMPLEXITY_THRESHOLD;

    // OpenRouter-first routing (both simple AND complex go through OR)
    if (this.openrouter) {
      const prevModel = this.openrouterModel;
      this.openrouterModel = isComplex ? RAGService.COMPLEX_MODEL : RAGService.SIMPLE_MODEL;
      console.log(isComplex
        ? `🎭 Routing to ${RAGService.COMPLEX_MODEL} via OpenRouter (topK=${topK})`
        : `🦙 Routing to ${RAGService.SIMPLE_MODEL} via OpenRouter (topK=${topK})`);
      try {
        yield* this.chatStreamOpenRouter(message, history, metadataCollector);
      } finally {
        this.openrouterModel = prevModel; // restore
      }
      return;
    }

    // Fallback: direct provider (no OR key)
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
