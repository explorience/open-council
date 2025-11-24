// RAG (Retrieval Augmented Generation) service for chatbot

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { VectorStore } from './vector-store.js';
import type { ChatMessage, SearchResult } from './types.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const TOP_K = 10; // Increased from 5 to get more context

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
   * Retrieve relevant context from vector store
   */
  async retrieveContext(query: string): Promise<SearchResult[]> {
    const queryEmbedding = await this.generateQueryEmbedding(query);
    const results = await this.vectorStore.search(queryEmbedding, TOP_K);
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
    return `You are an intelligent assistant helping users understand London, Ontario City Council meetings and decisions.

You have access to meeting minutes, motions, votes, and bills from city council meetings. Your role is to:

1. Answer questions about what happened in specific meetings
2. Explain motions, votes, and decisions made by council
3. Provide information about councillor participation and voting records
4. Help users find information about specific topics discussed in meetings
5. Summarize key decisions and their implications

**Guidelines:**
- Always cite which meeting and date information comes from
- Be factual and precise - use ONLY the information provided in the context below
- Provide complete details including full motion text, vote counts, and outcomes
- When referencing a meeting, ALWAYS link to the **Internal Minutes** URL (not City Website)
- Include specific details: councillor names, exact vote counts, motion text
- If the context contains partial information, provide what you have and note what's missing
- Never say you "don't have information" if it's clearly in the context provided

**How to Link to Meetings:**
- Use the Internal Minutes URL from the context (e.g., "/2024-09/2024-09-24-Council")
- Format: [Meeting Name](internal-url)
- Example: For more details, see the [15th Council Meeting](/2025-09/2025-09-23-Council)

**Retrieved Context from Meetings:**
${context}

Use this context to answer the user's question. Extract and present ALL relevant details from the context provided.`;
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
      temperature: 0.7,
      max_tokens: 2000,
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
      model: 'claude-3-5-sonnet-20240620',
      max_tokens: 4000,
      temperature: 0.7,
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
