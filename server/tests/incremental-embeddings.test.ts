/**
 * Unit tests for incremental embedding logic.
 *
 * Locks in the contract that `EmbeddingGenerator.generateIncremental` re-embeds
 * chunks whose text content has changed (not just chunks with brand-new ids),
 * and reports orphan ids for cleanup.
 *
 * Run with: npm run test -- server/tests/incremental-embeddings.test.ts
 */

import test, { describe } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EmbeddingGenerator } from '../embeddings.js';
import { hashChunkText, type ExistingChunkInfo } from '../vector-store.js';

/** Stubbed OpenAI key — generateIncremental short-circuits before any API call
 *  if there is nothing to embed, which is the case in all tests below. */
const STUB_KEY = 'stub-key';

async function withTempDataDir(
  meetings: Array<{ filename: string; meeting: unknown }>,
  fn: (dataDir: string) => Promise<void>
) {
  const root = await mkdtemp(join(tmpdir(), 'open-council-test-'));
  const monthDir = join(root, '2026-04');
  await mkdir(monthDir, { recursive: true });
  for (const { filename, meeting } of meetings) {
    await writeFile(join(monthDir, filename), JSON.stringify(meeting));
  }
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fakeMeeting(title: string, datetime: string, contentString: string) {
  return {
    title,
    datetime,
    url: 'https://example.com/x',
    meeting_type: 'Council',
    present: ['A. Test'],
    items: [],
    content: { string: contentString, __class__: 'Paragraph' },
  };
}

describe('generateIncremental change detection', () => {
  test('reports nothing to do when content matches existing hashes', async () => {
    await withTempDataDir(
      [{ filename: 'meeting.json', meeting: fakeMeeting('M1', '2026-04-14 13:00:00', 'hello world') }],
      async (dataDir) => {
        const gen = new EmbeddingGenerator(STUB_KEY, dataDir);

        // Pre-build the chunk set as the production code would, so we can mirror
        // the on-disk hashes into the "existing" map.
        const meetings = await gen.loadMeetings();
        const fresh = meetings.flatMap(m => gen.createChunks(m.meeting, m.filePath));

        const existing = new Map<string, ExistingChunkInfo>(
          fresh.map(c => [c.id, { textHash: hashChunkText(c.text), filePath: c.metadata.file_path }])
        );

        const { chunks, orphanIds } = await gen.generateIncremental(existing);
        assert.strictEqual(chunks.length, 0, 'no chunks should need embedding');
        assert.strictEqual(orphanIds.length, 0, 'no orphans expected');
      }
    );
  });

  test('flags chunks whose text changed (same id, different hash)', async () => {
    await withTempDataDir(
      [{ filename: 'meeting.json', meeting: fakeMeeting('M1', '2026-04-14 13:00:00', 'hello world') }],
      async (dataDir) => {
        const gen = new EmbeddingGenerator(STUB_KEY, dataDir);
        const meetings = await gen.loadMeetings();
        const fresh = meetings.flatMap(m => gen.createChunks(m.meeting, m.filePath));

        // Existing map carries the SAME ids but a STALE hash for every chunk.
        const existing = new Map<string, ExistingChunkInfo>(
          fresh.map(c => [c.id, { textHash: 'stalehash00000000', filePath: c.metadata.file_path }])
        );

        // Sanity: the embedder will be invoked, so stub generateEmbeddings to
        // skip the real OpenAI call.
        (gen as unknown as { generateEmbeddings: typeof gen['generateEmbeddings'] }).generateEmbeddings =
          async (chunks) => chunks;

        const { chunks, orphanIds } = await gen.generateIncremental(existing);
        assert.strictEqual(chunks.length, fresh.length, 'every chunk should be flagged for re-embed');
        assert.strictEqual(orphanIds.length, 0, 'no orphans when ids match');
      }
    );
  });

  test('reports orphan ids when an existing chunk no longer appears for a still-present file', async () => {
    await withTempDataDir(
      [{ filename: 'meeting.json', meeting: fakeMeeting('M1', '2026-04-14 13:00:00', 'hello world') }],
      async (dataDir) => {
        const gen = new EmbeddingGenerator(STUB_KEY, dataDir);
        const meetings = await gen.loadMeetings();
        const fresh = meetings.flatMap(m => gen.createChunks(m.meeting, m.filePath));
        const filePath = fresh[0].metadata.file_path;

        const existing = new Map<string, ExistingChunkInfo>(
          fresh.map(c => [c.id, { textHash: hashChunkText(c.text), filePath: c.metadata.file_path }])
        );
        // Add a stale chunk attached to the SAME file that no longer exists in fresh chunks
        // (e.g. an item that was removed when the agenda was re-scraped).
        existing.set(`${filePath}:item:99`, { textHash: 'irrelevant', filePath });

        const { chunks, orphanIds } = await gen.generateIncremental(existing);
        assert.strictEqual(chunks.length, 0, 'matching content should not re-embed');
        assert.deepStrictEqual(orphanIds, [`${filePath}:item:99`], 'stale chunk on still-present file should be orphan');
      }
    );
  });

  test('does NOT orphan chunks whose file is no longer on disk (defensive)', async () => {
    await withTempDataDir(
      [{ filename: 'meeting.json', meeting: fakeMeeting('M1', '2026-04-14 13:00:00', 'hello world') }],
      async (dataDir) => {
        const gen = new EmbeddingGenerator(STUB_KEY, dataDir);
        const meetings = await gen.loadMeetings();
        const fresh = meetings.flatMap(m => gen.createChunks(m.meeting, m.filePath));

        const existing = new Map<string, ExistingChunkInfo>(
          fresh.map(c => [c.id, { textHash: hashChunkText(c.text), filePath: c.metadata.file_path }])
        );
        // Stale chunk attached to a file that doesn't exist in the data dir at all
        // — could be a partial scrape or transient missing file. Leave alone.
        existing.set('data/2026-03/missing.json:content', {
          textHash: 'irrelevant',
          filePath: 'data/2026-03/missing.json',
        });

        const { orphanIds } = await gen.generateIncremental(existing);
        assert.strictEqual(orphanIds.length, 0, 'should not nuke chunks for files not currently on disk');
      }
    );
  });
});

describe('hashChunkText', () => {
  test('is stable for the same input', () => {
    assert.strictEqual(hashChunkText('hello'), hashChunkText('hello'));
  });

  test('differs for different inputs', () => {
    assert.notStrictEqual(hashChunkText('hello'), hashChunkText('Hello'));
  });

  test('handles empty string', () => {
    assert.match(hashChunkText(''), /^[0-9a-f]{16}$/);
  });
});
