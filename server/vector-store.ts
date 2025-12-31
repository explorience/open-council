// Vector store using LanceDB for semantic search

import { connect, Table, Index, rerankers } from '@lancedb/lancedb';
import type { EmbeddingChunk, SearchResult } from './types.js';

const { RRFReranker } = rerankers;

const DB_PATH = './lancedb';
const TABLE_NAME = 'council_meetings';

export class VectorStore {
  private db: any;
  private table: Table | null = null;
  private reranker: InstanceType<typeof RRFReranker> | null = null;
  private ftsIndexCreated: boolean = false;

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

      // Initialize FTS index for hybrid search
      await this.ensureFtsIndex();

      // Initialize RRF reranker for hybrid search
      this.reranker = await RRFReranker.create();
      console.log('Initialized RRF reranker for hybrid search');
    } catch (error) {
      console.log(`Table ${TABLE_NAME} does not exist yet`);
    }
  }

  /**
   * Ensure FTS (Full-Text Search) index exists on the text column
   * This enables BM25-based keyword search for hybrid retrieval
   */
  private async ensureFtsIndex(): Promise<void> {
    if (!this.table || this.ftsIndexCreated) return;

    try {
      // Check if FTS index already exists by listing indices
      const indices = await this.table.listIndices();
      const hasFtsIndex = indices.some((idx: any) =>
        idx.columns?.includes('text') && idx.indexType === 'FTS'
      );

      if (!hasFtsIndex) {
        console.log('Creating FTS index on text column...');
        await this.table.createIndex('text', {
          config: Index.fts({
            withPosition: true,  // Enable phrase queries
            baseTokenizer: 'simple',  // Split on whitespace and punctuation
          }),
        });
        console.log('FTS index created successfully');
      } else {
        console.log('FTS index already exists');
      }

      this.ftsIndexCreated = true;
    } catch (error: any) {
      // FTS index creation may fail on older data or if already exists
      console.log('Note: FTS index setup:', error?.message || error);
      // Don't fail initialization - hybrid search will fall back gracefully
    }
  }

  /**
   * Log the date range of records in the database for debugging
   * Uses targeted queries to find actual min/max dates rather than sampling
   */
  private async logDateRange(): Promise<void> {
    if (!this.table) return;

    try {
      const count = await this.table.countRows();
      console.log(`📊 Database has ${count} records`);

      if (count === 0) return;

      // Use dummy vector to query, then sort to find actual min/max dates
      const dummyVector = new Array(1536).fill(0);

      // Get oldest records
      const oldestResults = await this.table
        .vectorSearch(dummyVector)
        .where(`meeting_date >= '2000-01-01'`) // Far past date to get all
        .limit(100)
        .toArray();

      // Get newest records (check recent years progressively)
      let newestDate = '';
      for (const yearsAgo of [0, 1, 2, 5, 10, 20]) {
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - yearsAgo);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        const recentResults = await this.table
          .vectorSearch(dummyVector)
          .where(`meeting_date >= '${cutoffStr}'`)
          .limit(500)
          .toArray();

        if (recentResults.length > 0) {
          const sortedDates = recentResults
            .map((r: any) => r.meeting_date)
            .filter(Boolean)
            .sort()
            .reverse();
          newestDate = sortedDates[0];
          break;
        }
      }

      if (oldestResults.length > 0) {
        const oldestDates = oldestResults
          .map((r: any) => r.meeting_date)
          .filter(Boolean)
          .sort();
        const oldestDate = oldestDates[0];
        console.log(`📅 Date range in DB: ${oldestDate} to ${newestDate || 'unknown'}`);
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
   * Hybrid search combining vector similarity and BM25 full-text search
   *
   * This is particularly effective for queries that contain:
   * - Proper nouns (councillor names like "Stevenson", "Van Meerbergen")
   * - Specific terms (motion names, bylaw numbers)
   * - Exact phrases that should match verbatim
   *
   * The results are reranked using Reciprocal Rank Fusion (RRF) which
   * combines scores from both search methods.
   *
   * @param queryEmbedding - Vector embedding of the query
   * @param queryText - Original query text for BM25 matching
   * @param limit - Maximum number of results to return
   * @param alpha - Balance between vector (0) and FTS (1), default 0.5
   */
  async hybridSearch(
    queryEmbedding: number[],
    queryText: string,
    limit: number = 30,
    alpha: number = 0.5
  ): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Table not initialized. Please run embedding generation first.');
    }

    // If FTS index isn't available, fall back to pure vector search
    if (!this.ftsIndexCreated || !this.reranker) {
      console.log('⚠️ FTS not available, falling back to vector search');
      return this.search(queryEmbedding, limit);
    }

    try {
      console.log(`🔀 Hybrid search: "${queryText.substring(0, 50)}..." (alpha=${alpha})`);

      // Perform hybrid search with RRF reranking
      // The fullTextSearch chain combines vector + FTS results
      const results = await this.table
        .vectorSearch(queryEmbedding)
        .fullTextSearch(queryText, { columns: ['text'] })
        .rerank(this.reranker)
        .limit(limit)
        .toArray();

      console.log(`   Found ${results.length} results via hybrid search`);

      return results.map((result: any) => ({
        text: result.text,
        score: result._score || result._distance || 0,
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
    } catch (error: any) {
      console.error('Hybrid search failed, falling back to vector search:', error?.message);
      return this.search(queryEmbedding, limit);
    }
  }

  /**
   * Full-text search only (BM25-based keyword search)
   *
   * Use this when you need exact keyword matches without semantic understanding.
   * Good for: councillor names, motion numbers, specific phrases
   *
   * @param queryText - Text to search for
   * @param limit - Maximum results to return
   */
  async fullTextSearch(queryText: string, limit: number = 30): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Table not initialized. Please run embedding generation first.');
    }

    if (!this.ftsIndexCreated) {
      console.log('⚠️ FTS index not available');
      return [];
    }

    try {
      console.log(`📝 FTS search: "${queryText.substring(0, 50)}..."`);

      const results = await this.table
        .search(queryText, 'fts', ['text'])
        .limit(limit)
        .toArray();

      console.log(`   Found ${results.length} results via FTS`);

      return results.map((result: any) => ({
        text: result.text,
        score: result._score || 0,
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
    } catch (error: any) {
      console.error('FTS search failed:', error?.message);
      return [];
    }
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
   * Uses progressive date range expansion to ensure we find recent data
   */
  async getMostRecent(limit: number = 50, meetingTypeFilter?: string): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Table not initialized. Please run embedding generation first.');
    }

    const dummyVector = new Array(1536).fill(0);
    const now = new Date();

    // Try progressively broader date ranges until we find enough results
    const monthsToTry = [2, 6, 12, 24, 60]; // 2 months, 6 months, 1 year, 2 years, 5 years

    for (const months of monthsToTry) {
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffStr = cutoff.toISOString().split('T')[0];

      try {
        let whereClause = `meeting_date >= '${cutoffStr}'`;

        // Add meeting type filter if specified (e.g., "Council", "Budget", "Planning")
        if (meetingTypeFilter) {
          whereClause += ` AND meeting_title LIKE '%${meetingTypeFilter}%'`;
          // For "Council" filter, exclude committee meetings which also contain "Council" in path
          if (meetingTypeFilter === 'Council') {
            whereClause += ` AND meeting_title NOT LIKE '%Committee%'`;
          }
        }

        const results = await this.table
          .vectorSearch(dummyVector)
          .where(whereClause)
          .limit(limit * 5) // Fetch extra to ensure good coverage after sorting
          .toArray();

        if (results.length > 0) {
          // Sort by date descending (newest first)
          const sorted = results
            .sort((a: any, b: any) => {
              const dateA = new Date(a.meeting_date).getTime();
              const dateB = new Date(b.meeting_date).getTime();
              return dateB - dateA;
            })
            .slice(0, limit);

          console.log(`📅 Found ${results.length} chunks from last ${months} months${meetingTypeFilter ? ` (filtered: ${meetingTypeFilter})` : ''}`);
          if (sorted.length > 0) {
            console.log(`   Most recent: ${sorted[0].meeting_date} - ${sorted[0].meeting_title}`);
          }

          return sorted.map((result: any) => ({
            text: result.text,
            score: 0,
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
      } catch (error) {
        console.error(`Error querying last ${months} months:`, error);
      }
    }

    console.log('⚠️ No recent meetings found in any date range');
    return [];
  }

  /**
   * Search with optional meeting type filter (for committee-specific queries)
   */
  async searchWithFilter(
    queryEmbedding: number[],
    limit: number,
    meetingTypeFilter?: string
  ): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Table not initialized. Please run embedding generation first.');
    }

    try {
      let query = this.table.vectorSearch(queryEmbedding);

      if (meetingTypeFilter) {
        let whereClause = `meeting_title LIKE '%${meetingTypeFilter}%'`;
        // For "Council" filter, exclude committee meetings
        if (meetingTypeFilter === 'Council') {
          whereClause += ` AND meeting_title NOT LIKE '%Committee%'`;
        }
        query = query.where(whereClause);
        console.log(`🔍 Filtering results to meetings containing: "${meetingTypeFilter}"`);
      }

      const results = await query.limit(limit).toArray();

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
    } catch (error) {
      console.error('Error in filtered search:', error);
      // Fallback to regular search
      return this.search(queryEmbedding, limit);
    }
  }

  /**
   * Search for chunks of a specific type (e.g., "news_coverage", "vote", "motion")
   * This is useful for finding vote records or news articles specifically
   */
  async searchByChunkType(
    queryEmbedding: number[],
    chunkType: string,
    limit: number = 50,
    recentMonths?: number
  ): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Table not initialized. Please run embedding generation first.');
    }

    try {
      let whereClause = `chunk_type = '${chunkType}'`;

      // Optionally filter to recent data
      if (recentMonths) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - recentMonths);
        const cutoffStr = cutoff.toISOString().split('T')[0];
        whereClause += ` AND meeting_date >= '${cutoffStr}'`;
      }

      const results = await this.table
        .vectorSearch(queryEmbedding)
        .where(whereClause)
        .limit(limit)
        .toArray();

      console.log(`🔍 Found ${results.length} ${chunkType} chunks${recentMonths ? ` from last ${recentMonths} months` : ''}`);

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
    } catch (error) {
      console.error(`Error searching for ${chunkType} chunks:`, error);
      return [];
    }
  }

  /**
   * Get recent news_coverage chunks (contains vote breakdowns from articles)
   * This bypasses semantic search to ensure we get actual vote data
   */
  async getRecentNewsCoverage(limit: number = 30, recentMonths: number = 6): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Table not initialized. Please run embedding generation first.');
    }

    const dummyVector = new Array(1536).fill(0);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - recentMonths);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    try {
      const results = await this.table
        .vectorSearch(dummyVector)
        .where(`chunk_type = 'news_coverage' AND meeting_date >= '${cutoffStr}'`)
        .limit(limit * 2)
        .toArray();

      // Sort by date descending
      const sorted = results.sort((a: any, b: any) => {
        const dateA = new Date(a.meeting_date).getTime();
        const dateB = new Date(b.meeting_date).getTime();
        return dateB - dateA;
      });

      console.log(`📰 Found ${sorted.length} news_coverage chunks from last ${recentMonths} months`);
      if (sorted.length > 0) {
        console.log(`   Most recent: ${sorted[0].meeting_date} - ${sorted[0].meeting_title}`);
      }

      return sorted.slice(0, limit).map((result: any) => ({
        text: result.text,
        score: 0,
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
      console.error('Error getting recent news coverage:', error);
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
