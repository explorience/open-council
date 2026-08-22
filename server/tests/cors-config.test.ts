/**
 * Unit tests for the CORS allowlist used by the chat server.
 *
 * Before this fix, `app.use(cors())` allowed every origin, meaning any
 * third-party page could embed JS that drives paid /api/chat calls from every
 * visitor's browser. These tests lock in:
 *   - only origins from ALLOWED_ORIGINS are reflected
 *   - non-browser callers (no Origin header, e.g. curl/server-to-server) still work
 *     (rate limiting is the real defense against those; CORS only affects browsers)
 *   - malformed/empty config doesn't accidentally allow everything
 *
 * Run with: npm run test -- server/tests/cors-config.test.ts
 */

import test, { describe } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { parseAllowedOrigins, buildCorsOptions } from '../cors-config.js';

describe('parseAllowedOrigins', () => {
  test('splits a comma-separated env value and trims whitespace', () => {
    assert.deepEqual(
      parseAllowedOrigins('https://opencouncil.xyz, https://www.opencouncil.xyz ,http://localhost:8080'),
      ['https://opencouncil.xyz', 'https://www.opencouncil.xyz', 'http://localhost:8080']
    );
  });

  test('returns an empty array for undefined/empty input', () => {
    assert.deepEqual(parseAllowedOrigins(undefined), []);
    assert.deepEqual(parseAllowedOrigins(''), []);
    assert.deepEqual(parseAllowedOrigins('   '), []);
  });

  test('drops empty entries from trailing/double commas', () => {
    assert.deepEqual(
      parseAllowedOrigins('https://opencouncil.xyz,,'),
      ['https://opencouncil.xyz']
    );
  });
});

function buildApp(allowedOrigins: string[]) {
  const app = express();
  app.use(cors(buildCorsOptions(allowedOrigins)));
  app.get('/api/stats', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('buildCorsOptions', () => {
  test('reflects an allowed origin in Access-Control-Allow-Origin', async () => {
    const app = buildApp(['https://opencouncil.xyz']);
    const res = await request(app).get('/api/stats').set('Origin', 'https://opencouncil.xyz');
    assert.equal(res.headers['access-control-allow-origin'], 'https://opencouncil.xyz');
  });

  test('does not reflect a disallowed origin', async () => {
    const app = buildApp(['https://opencouncil.xyz']);
    const res = await request(app).get('/api/stats').set('Origin', 'https://evil.example.com');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  test('allows requests with no Origin header regardless of allowlist (curl/server-to-server)', async () => {
    const app = buildApp(['https://opencouncil.xyz']);
    const res = await request(app).get('/api/stats');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  test('an empty allowlist allows no browser origins', async () => {
    const app = buildApp([]);
    const res = await request(app).get('/api/stats').set('Origin', 'https://anything.example.com');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  test('a disallowed-origin preflight is not granted CORS headers', async () => {
    const app = buildApp(['https://opencouncil.xyz']);
    const res = await request(app)
      .options('/api/stats')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  test('localhost dev origin can be allowlisted explicitly', async () => {
    const app = buildApp(['http://localhost:8080']);
    const res = await request(app).get('/api/stats').set('Origin', 'http://localhost:8080');
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:8080');
  });
});
