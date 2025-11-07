// Embedding generation for city council meeting data

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import OpenAI from 'openai';
import type { Meeting, EmbeddingChunk, Content } from './types.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100;

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

      for (const monthDir of monthDirs) {
        if (!monthDir.match(/^\d{4}-\d{2}$/)) continue;

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
    const baseMetadata = {
      meeting_title: meeting.title,
      meeting_date: meeting.datetime,
      meeting_type: meeting.meeting_type,
      meeting_url: meeting.url,
      file_path: filePath,
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

    return chunks;
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
   * Generate embeddings for chunks using OpenAI
   */
  async generateEmbeddings(chunks: EmbeddingChunk[]): Promise<EmbeddingChunk[]> {
    const results: EmbeddingChunk[] = [];

    console.log(`Generating embeddings for ${chunks.length} chunks...`);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => c.text);

      try {
        const response = await this.openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: texts,
        });

        batch.forEach((chunk, idx) => {
          results.push({
            ...chunk,
            embedding: response.data[idx].embedding,
          });
        });

        console.log(`Processed ${Math.min(i + BATCH_SIZE, chunks.length)} / ${chunks.length}`);
      } catch (error) {
        console.error(`Error generating embeddings for batch ${i}:`, error);
        throw error;
      }
    }

    return results;
  }

  /**
   * Main method to generate all embeddings
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
}
