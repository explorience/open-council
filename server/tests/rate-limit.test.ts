/**
 * Unit tests for the per-IP rate limiters applied to POST /api/chat.
 *
 * Before this fix, /api/chat had no rate limiting at all — including the
 * "most recent meeting" retrieval path (rag-service.ts, vectorStore.getMostRecent)
 * which uses a dummy vector and doesn't call OpenAI, so it stays abusable even
 * while the OpenAI key is out of credit. A flood of requests (from one IP, or
 * distributed) burns paid LLM tokens with no ceiling.
 *
 * These tests use short windows so they run fast; production wiring
 * (server/index.ts) uses the real per-minute/per-day configs exported here.
 *
 * Run with: npm run test -- server/tests/rate-limit.test.ts
 */

import test, { describe } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import {
  createRateLimiter,
  TRUST_PROXY_HOPS,
  CHAT_RATE_LIMIT_PER_MINUTE,
  CHAT_RATE_LIMIT_PER_DAY,
} from '../rate-limit.js';

function buildApp(config: { windowMs: number; limit: number; message: string }) {
  const app = express();
  app.set('trust proxy', TRUST_PROXY_HOPS);
  app.use('/api/chat', createRateLimiter(config));
  app.post('/api/chat', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('default rate limit configuration', () => {
  test('per-minute limit defaults to a sane civic-Q&A ceiling (15/min) when env var unset', () => {
    assert.equal(CHAT_RATE_LIMIT_PER_MINUTE, 15);
  });

  test('per-day limit defaults to a sane civic-Q&A ceiling (200/day) when env var unset', () => {
    assert.equal(CHAT_RATE_LIMIT_PER_DAY, 200);
  });
});

describe('createRateLimiter', () => {
  test('allows requests up to the configured limit', async () => {
    const app = buildApp({ windowMs: 10_000, limit: 3, message: 'slow down' });
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/chat').send();
      assert.equal(res.status, 200, `request ${i + 1} should succeed`);
    }
  });

  test('rejects the request after the limit is exceeded, with a 429 and a clear message', async () => {
    const app = buildApp({ windowMs: 10_000, limit: 2, message: 'slow down please' });
    await request(app).post('/api/chat').send();
    await request(app).post('/api/chat').send();
    const res = await request(app).post('/api/chat').send();
    assert.equal(res.status, 429);
    assert.equal(res.body.error, 'slow down please');
  });

  test('resets after the window elapses', async () => {
    const app = buildApp({ windowMs: 150, limit: 1, message: 'slow down' });
    const first = await request(app).post('/api/chat').send();
    assert.equal(first.status, 200);

    const blocked = await request(app).post('/api/chat').send();
    assert.equal(blocked.status, 429);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const afterWindow = await request(app).post('/api/chat').send();
    assert.equal(afterWindow.status, 200);
  });

  test('buckets by client IP: one IP being limited does not block another', async () => {
    const app = buildApp({ windowMs: 10_000, limit: 1, message: 'slow down' });

    const clientA = await request(app)
      .post('/api/chat')
      .set('X-Forwarded-For', '203.0.113.10')
      .send();
    assert.equal(clientA.status, 200);

    const clientAAgain = await request(app)
      .post('/api/chat')
      .set('X-Forwarded-For', '203.0.113.10')
      .send();
    assert.equal(clientAAgain.status, 429, 'same IP should now be limited');

    const clientB = await request(app)
      .post('/api/chat')
      .set('X-Forwarded-For', '203.0.113.20')
      .send();
    assert.equal(clientB.status, 200, 'a different IP should have its own bucket');
  });

  test('sets standard RateLimit-* headers and not legacy X-RateLimit-* headers', async () => {
    const app = buildApp({ windowMs: 10_000, limit: 5, message: 'slow down' });
    const res = await request(app).post('/api/chat').send();
    assert.ok(res.headers['ratelimit-limit'] !== undefined);
    assert.equal(res.headers['x-ratelimit-limit'], undefined);
  });
});
