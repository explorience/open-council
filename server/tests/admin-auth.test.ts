/**
 * Unit tests for the admin-token gate used by POST /api/regenerate.
 *
 * Threat model: /api/regenerate triggers `generator.generateAll()` in `?full=true`
 * mode, which makes thousands of paid OpenAI embedding calls. Before this fix it
 * was reachable by anyone on the internet. These tests lock in:
 *   - fail CLOSED when ADMIN_API_TOKEN isn't configured (never silently open)
 *   - reject missing/incorrect tokens
 *   - accept the correct token
 *   - comparison is constant-time (doesn't short-circuit on length)
 *
 * Run with: npm run test -- server/tests/admin-auth.test.ts
 */

import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { requireAdminToken, safeCompare, ADMIN_TOKEN_HEADER } from '../admin-auth.js';

function buildApp() {
  const app = express();
  app.post('/api/regenerate', requireAdminToken, (_req, res) => {
    res.json({ status: 'started' });
  });
  return app;
}

describe('safeCompare', () => {
  test('returns true for equal strings', () => {
    assert.equal(safeCompare('correct-token', 'correct-token'), true);
  });

  test('returns false for different strings of the same length', () => {
    assert.equal(safeCompare('correct-token', 'wr0ng-t0ken!!'), false);
  });

  test('returns false for different-length strings without throwing', () => {
    assert.doesNotThrow(() => safeCompare('short', 'a-much-longer-string'));
    assert.equal(safeCompare('short', 'a-much-longer-string'), false);
  });

  test('returns false when one side is empty', () => {
    assert.equal(safeCompare('', 'correct-token'), false);
    assert.equal(safeCompare('correct-token', ''), false);
  });
});

describe('requireAdminToken middleware', () => {
  const ORIGINAL_TOKEN = process.env.ADMIN_API_TOKEN;

  beforeEach(() => {
    delete process.env.ADMIN_API_TOKEN;
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.ADMIN_API_TOKEN;
    } else {
      process.env.ADMIN_API_TOKEN = ORIGINAL_TOKEN;
    }
  });

  test('fails closed with 503 when ADMIN_API_TOKEN is not configured, even with a header sent', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/regenerate')
      .set(ADMIN_TOKEN_HEADER, 'anything')
      .send();
    assert.equal(res.status, 503);
    assert.match(res.body.error, /not configured/i);
  });

  test('rejects requests with no token header (401)', async () => {
    process.env.ADMIN_API_TOKEN = 'super-secret-token';
    const app = buildApp();
    const res = await request(app).post('/api/regenerate').send();
    assert.equal(res.status, 401);
  });

  test('rejects requests with an incorrect token (401)', async () => {
    process.env.ADMIN_API_TOKEN = 'super-secret-token';
    const app = buildApp();
    const res = await request(app)
      .post('/api/regenerate')
      .set(ADMIN_TOKEN_HEADER, 'guessed-token')
      .send();
    assert.equal(res.status, 401);
  });

  test('accepts requests with the correct token (200, reaches handler)', async () => {
    process.env.ADMIN_API_TOKEN = 'super-secret-token';
    const app = buildApp();
    const res = await request(app)
      .post('/api/regenerate')
      .set(ADMIN_TOKEN_HEADER, 'super-secret-token')
      .send();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'started' });
  });

  test('is not fooled by an anonymous caller guessing the query string alone', async () => {
    process.env.ADMIN_API_TOKEN = 'super-secret-token';
    const app = buildApp();
    const res = await request(app).post('/api/regenerate?full=true').send();
    assert.equal(res.status, 401);
  });
});
