// Embedding generation for city council meeting data

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import OpenAI from 'openai';
import type { Meeting, EmbeddingChunk, Content, TranscriptSegment } from './types.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_BATCH_SIZE = 100; // Maximum chunks per batch
const MAX_TOKENS_PER_BATCH = 8000; // text-embedding-3-small has 8192 token limit, leave some margin
const MAX_TOKENS_PER_CHUNK = 8000; // Maximum tokens per individual chunk
const RATE_LIMIT_DELAY_MS = 0; // No delay between batches (retry logic handles rate limits)
const MAX_RETRIES = 5;
const TRANSCRIPT_CHUNK_DURATION_SECONDS = 300; // 5-minute transcript chunks

/**
 * Rough token count estimation (OpenAI uses ~4 chars per token for English text)
 * This is a conservative estimate to avoid hitting the limit
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3.5); // Slightly more conservative than 4
}

export class EmbeddingGenerator {
  private openai: OpenAI;
  private dataDir: string;

  constructor(apiKey: string, dataDir: string = '../data') {
    this.openai = new OpenAI({ apiKey });
    this.dataDir = dataDir;
  }

  /**
   * Load all meeting JSON files from the data directory
   */
  async loadMeetings(): Promise<{ meeting: Meeting; filePath: string }[]> {
    const meetings: { meeting: Meeting; filePath: string }[] = [];

    try {
      const monthDirs = await readdir(this.dataDir);
      const sortedMonths = monthDirs.filter(d => d.match(/^\d{4}-\d{2}$/)).sort();

      console.log(`📂 Found ${sortedMonths.length} month directories`);
      console.log(`   First: ${sortedMonths[0]}, Last: ${sortedMonths[sortedMonths.length - 1]}`);

      for (const monthDir of sortedMonths) {
        const monthPath = join(this.dataDir, monthDir);
        const files = await readdir(monthPath);

        for (const file of files) {
          if (!file.endsWith('.json')) continue;

          const filePath = join(monthPath, file);
          const content = await readFile(filePath, 'utf-8');
          const meeting = JSON.parse(content) as Meeting;
          meetings.push({ meeting, filePath });
        }
      }

      // Log the date range of loaded meetings
      if (meetings.length > 0) {
        const dates = meetings.map(m => m.meeting.datetime).sort();
        console.log(`📅 Meeting date range: ${dates[0]} to ${dates[dates.length - 1]}`);
      }
    } catch (error) {
      console.error('Error loading meetings:', error);
      throw error;
    }

    return meetings;
  }

  /**
   * Extract text content from Content objects
   */
  private extractText(content: Content | Content[]): string {
    if (Array.isArray(content)) {
      return content.map(c => this.extractText(c)).join('\n');
    }

    if (content.string) {
      return content.string;
    }

    let text = '';

    if (content.pre_motion_texts?.length) {
      text += this.extractText(content.pre_motion_texts) + '\n';
    }

    if (content.moved_by) {
      text += this.extractText(content.moved_by) + '\n';
    }

    if (content.seconded_by) {
      text += this.extractText(content.seconded_by) + '\n';
    }

    if (content.motion_texts?.length) {
      text += this.extractText(content.motion_texts) + '\n';
    }

    if (content.vote) {
      text += `Vote: ${content.vote.rows.map(r => `${r.vote} ${r.voters.join(', ')}`).join('; ')}\n`;
    }

    if (content.result) {
      text += this.extractText(content.result);
    }

    return text.trim();
  }

  /**
   * Create chunks from a meeting for embedding
   */
  createChunks(meeting: Meeting, filePath: string): EmbeddingChunk[] {
    const chunks: EmbeddingChunk[] = [];
    // Check if this is a transcript-only meeting (no official minutes)
    const hasOfficialMinutes = meeting.data_sources?.official_minutes !== false;

    const baseMetadata = {
      meeting_title: meeting.title,
      meeting_date: meeting.datetime,
      meeting_type: meeting.meeting_type,
      meeting_url: meeting.url,
      file_path: filePath,
      has_official_minutes: hasOfficialMinutes,
    };

    // Chunk 1: Attendance information
    const attendanceText = [
      `Meeting: ${meeting.title}`,
      `Date: ${meeting.datetime}`,
      `Present: ${meeting.present.join(', ')}`,
      meeting.also_present?.length ? `Also Present: ${meeting.also_present.join(', ')}` : '',
      meeting.absent?.length ? `Absent: ${meeting.absent.join(', ')}` : '',
      meeting.remote_attendance?.length ? `Remote: ${meeting.remote_attendance.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    chunks.push({
      id: `${filePath}:attendance`,
      text: attendanceText,
      metadata: {
        ...baseMetadata,
        chunk_type: 'attendance',
      },
    });

    // Chunk 2: Meeting content
    if (meeting.content) {
      const contentText = this.extractText(meeting.content);
      if (contentText) {
        chunks.push({
          id: `${filePath}:content`,
          text: `${meeting.title}\n${contentText}`,
          metadata: {
            ...baseMetadata,
            chunk_type: 'content',
          },
        });
      }
    }

    // Chunk 3+: Meeting items (agenda items with motions)
    this.processItems(meeting.items, chunks, baseMetadata, filePath);

    // Final chunks: Bills
    if (meeting.bills?.bills?.length) {
      meeting.bills.bills.forEach((bill, idx) => {
        chunks.push({
          id: `${filePath}:bill:${idx}`,
          text: `${bill.title}\n${bill.desc}`,
          metadata: {
            ...baseMetadata,
            chunk_type: 'bill',
            item_title: bill.title,
          },
        });
      });
    }

    // Transcript chunks (if available)
    if (meeting.transcript?.length) {
      const transcriptChunks = this.createTranscriptChunks(meeting.transcript, baseMetadata, filePath);
      chunks.push(...transcriptChunks);
    }

    // News coverage chunks (supplements transcript-only meetings with vote info)
    if (meeting.news_coverage?.length) {
      meeting.news_coverage.forEach((article, idx) => {
        // Build councillor vote breakdown if available
        const voteBreakdown: string[] = [];
        if (article.councillors_for?.length) {
          voteBreakdown.push(`Councillors who voted FOR: ${article.councillors_for.join(', ')}`);
        }
        if (article.councillors_against?.length) {
          voteBreakdown.push(`Councillors who voted AGAINST: ${article.councillors_against.join(', ')}`);
        }

        const newsText = [
          `[NEWS COVERAGE - Source: ${article.source}]`,
          `⚠️ IMPORTANT: When citing this vote information, you MUST include "(source: [${article.source}](${article.url}))" in your response.`,
          ``,
          `Title: ${article.title}`,
          article.vote_summary ? `Vote Result: ${article.vote_summary}` : '',
          ...voteBreakdown,
          ``,
          `Summary: ${article.summary}`,
          ``,
          `Full article: ${article.url}`,
        ].filter(Boolean).join('\n');

        chunks.push({
          id: `${filePath}:news:${idx}`,
          text: newsText,
          metadata: {
            ...baseMetadata,
            chunk_type: 'content',  // Use 'content' type so it's included in searches
            item_title: `News: ${article.title}`,
          },
        });
      });
    }

    return chunks;
  }

  /**
   * Convert timestamp string (HH:MM:SS.mmm) to seconds
   */
  private timestampToSeconds(timestamp: string): number {
    const parts = timestamp.replace(',', '.').split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Create chunks from transcript segments
   * Groups segments into ~5 minute blocks for embedding
   */
  private createTranscriptChunks(
    transcript: TranscriptSegment[],
    baseMetadata: any,
    filePath: string
  ): EmbeddingChunk[] {
    const chunks: EmbeddingChunk[] = [];

    if (!transcript.length) return chunks;

    let currentChunkSegments: TranscriptSegment[] = [];
    let chunkStartTime = this.timestampToSeconds(transcript[0].start);
    let chunkIndex = 0;

    for (const segment of transcript) {
      const segmentTime = this.timestampToSeconds(segment.start);

      // Check if we should start a new chunk
      if (segmentTime - chunkStartTime >= TRANSCRIPT_CHUNK_DURATION_SECONDS && currentChunkSegments.length > 0) {
        // Save current chunk
        chunks.push(this.buildTranscriptChunk(currentChunkSegments, baseMetadata, filePath, chunkIndex));
        chunkIndex++;

        // Start new chunk
        currentChunkSegments = [];
        chunkStartTime = segmentTime;
      }

      currentChunkSegments.push(segment);
    }

    // Don't forget the last chunk
    if (currentChunkSegments.length > 0) {
      chunks.push(this.buildTranscriptChunk(currentChunkSegments, baseMetadata, filePath, chunkIndex));
    }

    return chunks;
  }

  /**
   * Build a single transcript chunk from segments
   */
  private buildTranscriptChunk(
    segments: TranscriptSegment[],
    baseMetadata: any,
    filePath: string,
    chunkIndex: number
  ): EmbeddingChunk {
    const text = segments.map(s => s.text).join(' ');
    const startTime = segments[0].start;
    const endTime = segments[segments.length - 1].end;

    return {
      id: `${filePath}:transcript:${chunkIndex}`,
      text: `[Transcript ${startTime} - ${endTime}]\n${text}`,
      metadata: {
        ...baseMetadata,
        chunk_type: 'transcript',
        transcript_start: startTime,
        transcript_end: endTime,
      },
    };
  }

  /**
   * Recursively process meeting items
   */
  private processItems(
    items: Record<string, any>,
    chunks: EmbeddingChunk[],
    baseMetadata: any,
    filePath: string,
    prefix: string = ''
  ): void {
    for (const [key, item] of Object.entries(items)) {
      const itemNumber = prefix ? `${prefix}.${key}` : key;
      const itemText = this.extractText(item.content || []);

      if (itemText) {
        chunks.push({
          id: `${filePath}:item:${itemNumber}`,
          text: `${item.title}\n${itemText}`,
          metadata: {
            ...baseMetadata,
            item_number: itemNumber,
            item_title: item.title,
            chunk_type: 'motion',
          },
        });
      }

      // Process sub-items recursively
      if (item.items && Object.keys(item.items).length > 0) {
        this.processItems(item.items, chunks, baseMetadata, filePath, itemNumber);
      }
    }
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate embeddings for a single batch with retry logic
   */
  private async generateBatchWithRetry(texts: string[], batchIndex: number): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: texts,
        });
        return response;
      } catch (error: any) {
        lastError = error;

        // Check if it's a rate limit error
        if (error?.status === 429) {
          // Extract retry-after from headers or use exponential backoff
          const retryAfter = error?.headers?.['retry-after'];
          const delayMs = retryAfter
            ? parseInt(retryAfter) * 1000
            : Math.min(1000 * Math.pow(2, attempt), 60000); // Exponential backoff, max 60s

          console.log(`Rate limit hit on batch ${batchIndex}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await this.sleep(delayMs);
          continue;
        }

        // For other errors, throw immediately
        throw error;
      }
    }

    // If we exhausted all retries, throw the last error
    throw lastError || new Error(`Failed to generate embeddings after ${MAX_RETRIES} attempts`);
  }

  /**
   * Truncate text to fit within token limit
   */
  private truncateToTokenLimit(text: string, maxTokens: number): string {
    const estimatedTokens = estimateTokenCount(text);
    if (estimatedTokens <= maxTokens) {
      return text;
    }
    // Truncate to approximately the right length (conservative)
    const maxChars = Math.floor(maxTokens * 3.5);
    return text.substring(0, maxChars) + '...';
  }

  /**
   * Create token-aware batches from chunks
   */
  private createTokenAwareBatches(chunks: EmbeddingChunk[]): EmbeddingChunk[][] {
    const batches: EmbeddingChunk[][] = [];
    let currentBatch: EmbeddingChunk[] = [];
    let currentTokenCount = 0;

    for (const chunk of chunks) {
      // Truncate chunk text if it exceeds the per-chunk limit
      const truncatedText = this.truncateToTokenLimit(chunk.text, MAX_TOKENS_PER_CHUNK);
      const chunkTokens = estimateTokenCount(truncatedText);

      // Update the chunk's text if it was truncated
      const processedChunk = truncatedText !== chunk.text
        ? { ...chunk, text: truncatedText }
        : chunk;

      // Check if adding this chunk would exceed limits
      if (currentBatch.length >= MAX_BATCH_SIZE ||
          (currentTokenCount + chunkTokens > MAX_TOKENS_PER_BATCH && currentBatch.length > 0)) {
        // Save current batch and start a new one
        batches.push(currentBatch);
        currentBatch = [processedChunk];
        currentTokenCount = chunkTokens;
      } else {
        currentBatch.push(processedChunk);
        currentTokenCount += chunkTokens;
      }
    }

    // Don't forget the last batch
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /**
   * Generate embeddings for chunks using OpenAI
   * @param chunks - Chunks to generate embeddings for
   * @param onBatchComplete - Optional callback called after each batch with the completed chunks
   */
  async generateEmbeddings(
    chunks: EmbeddingChunk[],
    onBatchComplete?: (batchChunks: EmbeddingChunk[]) => Promise<void>
  ): Promise<EmbeddingChunk[]> {
    const results: EmbeddingChunk[] = [];

    console.log(`Generating embeddings for ${chunks.length} chunks...`);

    // Create token-aware batches
    const batches = this.createTokenAwareBatches(chunks);
    console.log(`Split into ${batches.length} token-aware batches`);

    let processedCount = 0;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const texts = batch.map(c => c.text);

      try {
        const response = await this.generateBatchWithRetry(texts, batchIndex);

        const batchResults: EmbeddingChunk[] = [];
        batch.forEach((chunk, idx) => {
          const chunkWithEmbedding = {
            ...chunk,
            embedding: response.data[idx].embedding,
          };
          results.push(chunkWithEmbedding);
          batchResults.push(chunkWithEmbedding);
        });

        // Save batch immediately if callback provided
        if (onBatchComplete) {
          await onBatchComplete(batchResults);
        }

        processedCount += batch.length;
        console.log(`Processed ${processedCount} / ${chunks.length} (batch ${batchIndex + 1}/${batches.length})`);

        // Add delay between batches to avoid rate limits
        if (batchIndex < batches.length - 1) {
          await this.sleep(RATE_LIMIT_DELAY_MS);
        }
      } catch (error) {
        console.error(`Error generating embeddings for batch ${batchIndex}:`, error);
        throw error;
      }
    }

    return results;
  }

  /**
   * Main method to generate all embeddings (full regeneration)
   */
  async generateAll(): Promise<EmbeddingChunk[]> {
    console.log('Loading meetings from', this.dataDir);
    const meetings = await this.loadMeetings();
    console.log(`Loaded ${meetings.length} meetings`);

    console.log('Creating chunks...');
    const allChunks: EmbeddingChunk[] = [];
    for (const { meeting, filePath } of meetings) {
      const chunks = this.createChunks(meeting, filePath);
      allChunks.push(...chunks);
    }
    console.log(`Created ${allChunks.length} chunks`);

    console.log('Generating embeddings...');
    const chunksWithEmbeddings = await this.generateEmbeddings(allChunks);

    return chunksWithEmbeddings;
  }

  /**
   * Generate embeddings only for new chunks (incremental update)
   * @param existingChunkIds - Set of chunk IDs that already exist in the database
   * @param onBatchComplete - Optional callback called after each batch with the completed chunks
   */
  async generateIncremental(
    existingChunkIds: Set<string>,
    onBatchComplete?: (batchChunks: EmbeddingChunk[]) => Promise<void>
  ): Promise<EmbeddingChunk[]> {
    console.log('🔄 Loading meetings from', this.dataDir);
    const meetings = await this.loadMeetings();
    console.log(`Loaded ${meetings.length} meetings`);

    console.log('Creating chunks...');
    const allChunks: EmbeddingChunk[] = [];
    for (const { meeting, filePath } of meetings) {
      const chunks = this.createChunks(meeting, filePath);
      allChunks.push(...chunks);
    }
    console.log(`Created ${allChunks.length} total chunks`);

    // Filter out chunks that already exist
    const newChunks = allChunks.filter(chunk => !existingChunkIds.has(chunk.id));
    console.log(`Found ${newChunks.length} new chunks (${existingChunkIds.size} already exist)`);

    if (newChunks.length === 0) {
      console.log('✅ No new meetings to process. Database is up to date!');
      return [];
    }

    console.log(`Generating embeddings for ${newChunks.length} new chunks...`);
    const chunksWithEmbeddings = await this.generateEmbeddings(newChunks, onBatchComplete);

    return chunksWithEmbeddings;
  }
}
