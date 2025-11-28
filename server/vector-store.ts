// Vector store using LanceDB for semantic search

import { connect, Table } from '@lancedb/lancedb';
import type { EmbeddingChunk, SearchResult } from './types.js';

const DB_PATH = './lancedb';
const TABLE_NAME = 'council_meetings';

export class VectorStore {
  private db: any;
  private table: Table<any> | null = null;

  /**
   * Initialize connection to LanceDB
   */
  async initialize(): Promise<void> {
    this.db = await connect(DB_PATH);
    console.log('Connected to LanceDB at', DB_PATH);

    // Try to open existing table
    try {
      this.table = await this.db.openTable(TABLE_NAME);
      console.log(`Opened existing table: ${TABLE_NAME}`);

      // Log the date range of records in the database
      await this.logDateRange();
    } catch (error) {
      console.log(`Table ${TABLE_NAME} does not exist yet`);
    }
  }

  /**
   * Log the date range of records in the database for debugging
   */
  private async logDateRange(): Promise<void> {
    if (!this.table) return;

    try {
      const count = await this.table.countRows();
      // Sample some records to find date range
      const sampleSize = Math.min(count, 5000);
      const results = await this.table.query()
        .limit(sampleSize)
        .toArray();

      if (results.length > 0) {
        const dates = results.map((r: any) => r.meeting_date).filter(Boolean).sort();
        const uniqueDates = [...new Set(dates)];
        console.log(`📊 Database has ${count} records`);
        console.log(`📅 Date range in DB: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`);
      }
    } catch (error) {
      console.log('Could not determine date range:', error);
    }
  }

  /**
   * Create or replace the table with new embeddings
   */
  async createTable(chunks: EmbeddingChunk[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Convert chunks to LanceDB format
    const records = chunks.map(chunk => ({
      id: chunk.id,
      text: chunk.text,
      vector: chunk.embedding!,
      meeting_title: chunk.metadata.meeting_title,
      meeting_date: chunk.metadata.meeting_date,
      meeting_type: chunk.metadata.meeting_type,
      meeting_url: chunk.metadata.meeting_url,
      item_number: chunk.metadata.item_number || '',
      item_title: chunk.metadata.item_title || '',
      chunk_type: chunk.metadata.chunk_type,
      file_path: chunk.metadata.file_path,
    }));

    console.log(`Creating table with ${records.length} records...`);
    this.table = await this.db.createTable(TABLE_NAME, records, { mode: 'overwrite' });
    console.log(`Table ${TABLE_NAME} created successfully`);
  }

  /**
   * Search for similar chunks using vector similarity
   */
  async search(queryEmbedding: number[], limit: number = 5): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Table not initialized. Please run embedding generation first.');
    }

    const results = await this.table
      .vectorSearch(queryEmbedding)
      .limit(limit)
      .toArray();

    return results.map((result: any) => ({
      text: result.text,
      score: result._distance || 0,
      metadata: {
        meeting_title: result.meeting_title,
        meeting_date: result.meeting_date,
        meeting_type: result.meeting_type,
        meeting_url: result.meeting_url,
        item_number: result.item_number || undefined,
        item_title: result.item_title || undefined,
        chunk_type: result.chunk_type,
        file_path: result.file_path,
      },
    }));
  }

  /**
   * Get all existing chunk IDs from the database
   */
  async getExistingChunkIds(): Promise<Set<string>> {
    if (!this.table) {
      return new Set();
    }

    try {
      // First, get the total count to set appropriate limit
      const totalCount = await this.table.countRows();
      console.log(`Retrieving ${totalCount} existing chunk IDs...`);

      // Use a dummy vector to retrieve all IDs
      // Add buffer to handle any concurrent additions
      const dummyVector = new Array(1536).fill(0); // text-embedding-3-small dimension

      const results = await this.table
        .vectorSearch(dummyVector)
        .limit(totalCount + 1000) // Add 1000 buffer for safety
        .select(['id'])
        .toArray();

      console.log(`Retrieved ${results.length} chunk IDs from database`);
      return new Set(results.map((r: any) => r.id));
    } catch (error) {
      console.error('Error fetching existing chunk IDs:', error);
      return new Set();
    }
  }

  /**
   * Add new chunks to the existing table (incremental update)
   */
  async addChunks(chunks: EmbeddingChunk[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (chunks.length === 0) {
      console.log('No new chunks to add');
      return;
    }

    // Convert chunks to LanceDB format
    const records = chunks.map(chunk => ({
      id: chunk.id,
      text: chunk.text,
      vector: chunk.embedding!,
      meeting_title: chunk.metadata.meeting_title,
      meeting_date: chunk.metadata.meeting_date,
      meeting_type: chunk.metadata.meeting_type,
      meeting_url: chunk.metadata.meeting_url,
      item_number: chunk.metadata.item_number || '',
      item_title: chunk.metadata.item_title || '',
      chunk_type: chunk.metadata.chunk_type,
      file_path: chunk.metadata.file_path,
    }));

    if (!this.table) {
      // If table doesn't exist, create it
      console.log(`Creating new table with ${records.length} records...`);
      this.table = await this.db.createTable(TABLE_NAME, records);
      console.log(`Table ${TABLE_NAME} created successfully`);
    } else {
      // Add to existing table
      console.log(`Adding ${records.length} new records to existing table...`);
      await this.table.add(records);
      console.log(`Successfully added ${records.length} new records`);
    }
  }

  /**
   * Search for chunks within a specific date range (month/year)
   * This bypasses semantic search and returns ALL chunks from the specified period
   */
  async searchByDateRange(
    month: number,  // 0-11
    year: number,
    limit: number = 100
  ): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Table not initialized. Please run embedding generation first.');
    }

    // Build date range for the month
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0); // Last day of the month

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    console.log(`🔍 Searching for meetings between ${startStr} and ${endStr}`);

    try {
      // Use a dummy vector to query with date filter
      // LanceDB requires a vector for vectorSearch, so we use zeros and ignore similarity
      const dummyVector = new Array(1536).fill(0); // text-embedding-3-small dimension

      const results = await this.table
        .vectorSearch(dummyVector)
        .where(`meeting_date >= '${startStr}' AND meeting_date <= '${endStr} 23:59:59'`)
        .limit(limit)
        .toArray();

      console.log(`   Found ${results.length} chunks in date range`);

      return results.map((result: any) => ({
        text: result.text,
        score: 0, // No semantic score for date-based search
        metadata: {
          meeting_title: result.meeting_title,
          meeting_date: result.meeting_date,
          meeting_type: result.meeting_type,
          meeting_url: result.meeting_url,
          item_number: result.item_number || undefined,
          item_title: result.item_title || undefined,
          chunk_type: result.chunk_type,
          file_path: result.file_path,
        },
      }));
    } catch (error) {
      console.error('Error in date range search:', error);
      // Fallback: return empty array
      return [];
    }
  }

  /**
   * Get the most recent chunks ordered by date (bypasses semantic search)
   * Use this for "most recent" or "latest" type queries
   */
  async getMostRecent(limit: number = 50): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Table not initialized. Please run embedding generation first.');
    }

    try {
      // Query all chunks and sort by date descending
      // LanceDB doesn't have great ORDER BY support, so we fetch more and sort in JS
      const fetchLimit = Math.min(limit * 10, 1000); // Fetch more to ensure we get recent ones

      const results = await this.table.query()
        .limit(fetchLimit)
        .toArray();

      // Sort by meeting_date descending (newest first)
      const sorted = results
        .filter((r: any) => r.meeting_date) // Filter out any without dates
        .sort((a: any, b: any) => {
          const dateA = new Date(a.meeting_date).getTime();
          const dateB = new Date(b.meeting_date).getTime();
          return dateB - dateA; // Descending
        })
        .slice(0, limit);

      if (sorted.length > 0) {
        console.log(`📅 Most recent meeting in DB: ${sorted[0].meeting_date} - ${sorted[0].meeting_title}`);
      }

      return sorted.map((result: any) => ({
        text: result.text,
        score: 0, // No semantic score for date-based search
        metadata: {
          meeting_title: result.meeting_title,
          meeting_date: result.meeting_date,
          meeting_type: result.meeting_type,
          meeting_url: result.meeting_url,
          item_number: result.item_number || undefined,
          item_title: result.item_title || undefined,
          chunk_type: result.chunk_type,
          file_path: result.file_path,
        },
      }));
    } catch (error) {
      console.error('Error getting most recent chunks:', error);
      return [];
    }
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<{ count: number }> {
    if (!this.table) {
      return { count: 0 };
    }

    const count = await this.table.countRows();
    return { count };
  }
}
