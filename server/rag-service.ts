// RAG (Retrieval Augmented Generation) service for chatbot

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { VectorStore } from './vector-store.js';
import { getSystemPrompt } from './system-prompt.js';
import type { ChatMessage, SearchResult } from './types.js';

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

    // 1. Determine complexity and TOP_K
    const topK = this.analyzeQueryComplexity(query);

    // 2. Check for "most recent" type queries
    const isMostRecent = this.detectMostRecentIntent(lowerQuery);

    // 3. Extract specific month/year if mentioned
    const specificMonth = this.extractSpecificMonth(lowerQuery);

    // 4. Extract year filter if just year mentioned
    const yearFilter = this.extractYearFilter(lowerQuery);

    // 5. Detect meeting type (committee, council, etc.)
    const meetingTypeFilter = this.detectMeetingType(lowerQuery);

    const analysis: QueryAnalysis = {
      isMostRecent,
      specificMonth: specificMonth || undefined,
      yearFilter: yearFilter || undefined,
      meetingTypeFilter,
      topK,
    };

    // Log what we detected
    const detected: string[] = [];
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
   * Retrieve relevant context from vector store
   * Uses unified query analysis to determine optimal retrieval strategy
   */
  async retrieveContext(query: string): Promise<SearchResult[]> {
    // Analyze query to extract all metadata
    const analysis = this.analyzeQuery(query);
    const { topK, isMostRecent, specificMonth, meetingTypeFilter } = analysis;

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

    // Strategy 3: Semantic search with optional meeting type filter
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

        return `
## Context ${idx + 1}
**Meeting:** ${meta.meeting_title} (${meta.meeting_date})
**Type:** ${meta.chunk_type}${meta.item_title ? ` - ${meta.item_title}` : ''}
**Internal Minutes:** ${internalUrl}
**City Website:** ${meta.meeting_url}

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
    history: ChatMessage[] = []
  ): AsyncGenerator<string, void, unknown> {
    // Retrieve relevant context
    const results = await this.retrieveContext(message);
    const context = this.buildContextString(results);
    const systemPrompt = getSystemPrompt(context);

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
  }

  /**
   * Chat with streaming using Anthropic Claude
   */
  async *chatStreamAnthropic(
    message: string,
    history: ChatMessage[] = []
  ): AsyncGenerator<string, void, unknown> {
    if (!this.anthropic) {
      throw new Error('Anthropic API key not configured');
    }

    // Retrieve relevant context
    const results = await this.retrieveContext(message);
    const context = this.buildContextString(results);
    const systemPrompt = getSystemPrompt(context);

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
    history: ChatMessage[] = []
  ): AsyncGenerator<string, void, unknown> {
    if (this.provider === 'openai') {
      yield* this.chatStreamOpenAI(message, history);
    } else {
      yield* this.chatStreamAnthropic(message, history);
    }
  }

  /**
   * Get context without generating a response (for debugging)
   */
  async getRelevantContext(query: string): Promise<SearchResult[]> {
    return await this.retrieveContext(query);
  }
}
