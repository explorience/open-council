// RAG (Retrieval Augmented Generation) service for chatbot

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { VectorStore } from './vector-store.js';
import type { ChatMessage, SearchResult } from './types.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';

// Dynamic TOP_K values based on query complexity
const TOP_K_SIMPLE = 10;      // Single meeting, specific question
const TOP_K_MEDIUM = 30;      // Multiple meetings, specific topic
const TOP_K_COMPLEX = 80;     // Multi-year, broad policy tracking
const TOP_K_COMPREHENSIVE = 150; // Comprehensive historical analysis

export type LLMProvider = 'openai' | 'anthropic';

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
    ];

    // Patterns that indicate complex multi-topic queries
    const complexPatterns = [
      /\d{4}-\d{4}/,  // "2014-2025"
      /compare|comparison|versus|vs/,
      /all (meetings|decisions|votes) (about|on|regarding)/,
      /comprehensive|complete|full (summary|overview|history)/,
      /(housing|homelessness|budget|planning) (policy|policies|decisions)/,
    ];

    // Patterns that indicate medium complexity
    const mediumPatterns = [
      /in \d{4}/,  // "in 2024"
      /in (january|february|march|april|may|june|july|august|september|october|november|december)( \d{4})?/,  // "in november 2025"
      /(january|february|march|april|may|june|july|august|september|october|november|december) \d{4}/,  // "november 2025"
      /meetings?.*(in|from|during|for) (january|february|march|april|may|june|july|august|september|october|november|december)/,
      /what (meetings?|happened).*(in|during)/,
      /(took place|occurred|held) in/,
      /last (year|month|quarter)/,
      /recent|latest/,
      /multiple|several|various/,
      /all.*voted|voting record/,
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
   * Check if query is asking about recent/latest meetings (for "most recent" sorting)
   */
  private isRecentQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    const recentPatterns = [
      /most recent|latest|newest|last meeting/,
      /recent meeting/,
      /what.*happened.*recently/,
      /latest (meeting|council|decision)/,
    ];

    return recentPatterns.some(pattern => pattern.test(lowerQuery));
  }

  /**
   * Check if query asks about a specific time period (month/year)
   */
  private isSpecificTimePeriodQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    const timePeriodPatterns = [
      /this month|current month|last month|previous month/,
      /in (january|february|march|april|may|june|july|august|september|october|november|december)( \d{4})?/,
      /(january|february|march|april|may|june|july|august|september|october|november|december) \d{4}/,
      /meetings?.*(in|from|during|for) (january|february|march|april|may|june|july|august|september|october|november|december)/,
      /meetings?.*(this|last|current|previous) month/,
      /what (meetings?|happened).*(in|during) (january|february|march|april|may|june|july|august|september|october|november|december)/,
      /what (meetings?|happened).*(this|last) month/,
      /(took place|occurred|held) (in |this |last )?(january|february|march|april|may|june|july|august|september|october|november|december|month)/,
    ];

    return timePeriodPatterns.some(pattern => pattern.test(lowerQuery));
  }

  /**
   * Extract month and year from a temporal query
   * Returns { month: 0-11, year: number } or null
   */
  private extractDateRange(query: string): { month: number; year: number } | null {
    const lowerQuery = query.toLowerCase();
    const months: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    };

    // Match "this month" - use current date (November 2025)
    if (/this month|current month/.test(lowerQuery)) {
      const now = new Date();
      return {
        month: now.getMonth(),
        year: now.getFullYear()
      };
    }

    // Match "last month"
    if (/last month|previous month/.test(lowerQuery)) {
      const now = new Date();
      const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      return { month: lastMonth, year };
    }

    // Match "in november 2025", "november 2025", etc.
    const monthYearPattern = /(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})/;
    const match = lowerQuery.match(monthYearPattern);

    if (match) {
      return {
        month: months[match[1]],
        year: parseInt(match[2], 10)
      };
    }

    // Match just month name (assume current or most recent year with data)
    const monthOnlyPattern = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/;
    const monthMatch = lowerQuery.match(monthOnlyPattern);

    if (monthMatch) {
      // Default to 2025 if no year specified (most recent data year)
      return {
        month: months[monthMatch[1]],
        year: 2025
      };
    }

    return null;
  }

  /**
   * Filter results to only include meetings from a specific month/year
   */
  private filterByDateRange(
    results: SearchResult[],
    dateRange: { month: number; year: number }
  ): SearchResult[] {
    return results.filter(result => {
      const meetingDate = new Date(result.metadata.meeting_date);
      return (
        meetingDate.getMonth() === dateRange.month &&
        meetingDate.getFullYear() === dateRange.year
      );
    });
  }

  /**
   * Retrieve relevant context from vector store with dynamic TOP_K
   * For temporal queries, retrieve extra results and apply date filtering/sorting
   */
  async retrieveContext(query: string): Promise<SearchResult[]> {
    const topK = this.analyzeQueryComplexity(query);
    const queryEmbedding = await this.generateQueryEmbedding(query);

    // Check for different types of temporal queries
    const isRecent = this.isRecentQuery(query);
    const isSpecificPeriod = this.isSpecificTimePeriodQuery(query);
    const dateRange = this.extractDateRange(query);

    // For any temporal query, retrieve more results to ensure we capture the right time period
    const retrieveK = (isRecent || isSpecificPeriod) ? Math.max(topK * 5, 100) : topK;

    let results = await this.vectorStore.search(queryEmbedding, retrieveK);

    // Handle specific time period queries (e.g., "meetings in november 2025")
    // Use direct date filtering instead of semantic search + post-filter
    if (isSpecificPeriod && dateRange) {
      console.log(`📆 Specific time period query detected: ${dateRange.month + 1}/${dateRange.year}`);

      // Use date-filtered search to get ALL meetings from this period
      const dateResults = await this.vectorStore.searchByDateRange(
        dateRange.month,
        dateRange.year,
        200  // Get plenty of chunks to ensure we capture all meetings
      );

      if (dateResults.length > 0) {
        // Sort by date
        results = dateResults
          .sort((a, b) => {
            const dateA = new Date(a.metadata.meeting_date).getTime();
            const dateB = new Date(b.metadata.meeting_date).getTime();
            return dateB - dateA; // Most recent first
          });

        // Get unique meetings from the results
        const seenMeetings = new Set<string>();
        for (const result of results) {
          const meetingKey = `${result.metadata.meeting_title}-${result.metadata.meeting_date}`;
          seenMeetings.add(meetingKey);
        }
        console.log(`   Found ${seenMeetings.size} unique meetings in ${dateRange.month + 1}/${dateRange.year}`);

        // Return results (may be fewer than topK if not many meetings in that period)
        return results.slice(0, topK);
      } else {
        console.log(`   ⚠️ No meetings found in ${dateRange.month + 1}/${dateRange.year}`);
        // Return empty or let the LLM know no meetings were found
        return [];
      }
    }

    // Handle "most recent" type queries - sort by date
    if (isRecent && results.length > 0) {
      console.log(`🕐 Recent query detected - retrieved ${results.length} results, sorting by date...`);
      results = results
        .sort((a, b) => {
          const dateA = new Date(a.metadata.meeting_date).getTime();
          const dateB = new Date(b.metadata.meeting_date).getTime();
          return dateB - dateA; // Most recent first
        })
        .slice(0, topK);

      // Log the date range for debugging
      if (results.length > 0) {
        const oldest = results[results.length - 1].metadata.meeting_date;
        const newest = results[0].metadata.meeting_date;
        console.log(`📅 Date range after sorting: ${oldest} to ${newest} (returning top ${topK})`);
      }
    }

    return results;
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
   * Generate system prompt for the chatbot
   */
  private getSystemPrompt(context: string): string {
    return `You are an expert assistant helping citizens understand London, Ontario City Council meetings and decisions.

## Your Role
Help users navigate city council proceedings by providing clear, comprehensive, and well-organized information from meeting minutes, motions, votes, and bills.

## Understanding User Intent
Before responding, consider what the user actually wants:
- **"Highlights"** = Key decisions, controversial votes, important motions - NOT just the first item you find
- **"What happened"** = Comprehensive summary of significant actions and outcomes
- **"List meetings"** = ALL meetings in the time period, not just one
- **Specific questions** = Focused, detailed answers with exact quotes and vote counts

## Response Guidelines

**Length & Detail:**
- For "highlights" or "summary" requests: Provide 3-7 key points with enough detail to be useful
- For specific questions: Be thorough - include motion text, vote breakdowns, who moved/seconded
- For meeting lists: Include date, title, type, and 1-2 sentence summary for each
- Don't be overly brief - users want substance, not one-liners

**Structure:**
- Use clear headings (##) to organize information
- Use bullet points for lists of items or votes
- Include relevant numbers: vote counts, dates, attendance figures
- Always link to meeting minutes for "more details"

**Content Quality:**
- Extract ALL relevant details from the context - motion text, movers, seconders, vote breakdowns
- Be specific: "passed 12-3" not just "passed"
- Include councillor names when discussing votes or motions
- If something was controversial (close vote, debate), highlight that

## Handling Time-Based Questions
When asked about meetings in a specific time period:
1. List ALL meetings found - scan the entire context
2. For each meeting: date, title, type, and brief summary of key business
3. If no meetings found, say so explicitly
4. Don't assume one meeting is the only one

## Linking to Meetings
Use Internal Minutes URLs from the context:
- Format: [Meeting Name](/2024-09/2024-09-24-Council)
- Always provide links so users can read full details

## Important Rules
- Use ONLY information from the provided context
- Never invent details or assume information not in context
- If context is incomplete, say what's missing
- Cite which meeting information comes from

## Retrieved Context from Meetings:
${context}

Now answer the user's question thoroughly, using the context above.`;
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
    const systemPrompt = this.getSystemPrompt(context);

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
    const systemPrompt = this.getSystemPrompt(context);

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
