/**
 * Locks in the `trust proxy` setting the server needs behind Railway's single
 * reverse-proxy hop, so per-IP rate limiting (server/rate-limit.ts) keys on the
 * real client IP and can't be trivially spoofed via X-Forwarded-For.
 *
 * Empirically verified (see server/index.ts comment) against Express's actual
 * proxy-address resolution (the `proxyaddr` package):
 *   - trust proxy unset (default): X-Forwarded-For is ignored entirely. Safe
 *     from spoofing, but WRONG behind a real proxy — every request looks like
 *     it comes from Railway's internal address, so rate limiting buckets all
 *     visitors together (effectively no per-IP limiting at all).
 *   - trust proxy = 1: trusts exactly one hop (Railway's edge), and reads the
 *     right-most X-Forwarded-For entry appended by that trusted hop — an
 *     attacker prepending fake entries earlier in the chain is ignored.
 *   - trust proxy = true: trusts the WHOLE chain, so a client that prepends a
 *     fake entry to X-Forwarded-For gets it picked up as `req.ip` — trivially
 *     spoofable and must not be used.
 *
 * Run with: npm run test -- server/tests/trust-proxy.test.ts
 */

import test, { describe } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { TRUST_PROXY_HOPS } from '../rate-limit.js';

function buildApp(trustProxySetting: unknown) {
  const app = express();
  if (trustProxySetting !== undefined) {
    app.set('trust proxy', trustProxySetting);
  }
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe('trust proxy configuration', () => {
  test('TRUST_PROXY_HOPS is exactly 1 (single Railway edge proxy hop)', () => {
    assert.equal(TRUST_PROXY_HOPS, 1);
  });

  test('with trust proxy unset, X-Forwarded-For is ignored (req.ip is the raw socket address)', async () => {
    const app = buildApp(undefined);
    const res = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.5');
    // supertest connects over loopback either way; the point is the header
    // had no effect, i.e. it did NOT become "203.0.113.5".
    assert.notEqual(res.body.ip, '203.0.113.5');
  });

  test('with trust proxy = TRUST_PROXY_HOPS, a single real X-Forwarded-For entry (as Railway sets it) is honored', async () => {
    const app = buildApp(TRUST_PROXY_HOPS);
    const res = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.5');
    assert.equal(res.body.ip, '203.0.113.5');
  });

  test('with trust proxy = TRUST_PROXY_HOPS, a spoofed entry prepended ahead of the real one is ignored', async () => {
    const app = buildApp(TRUST_PROXY_HOPS);
    const res = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '9.9.9.9, 203.0.113.5');
    // The real, trusted hop's entry (right-most) wins, not the attacker-supplied one.
    assert.equal(res.body.ip, '203.0.113.5');
    assert.notEqual(res.body.ip, '9.9.9.9');
  });

  test('trust proxy = true (the unsafe setting) WOULD be spoofable — regression guard', async () => {
    const app = buildApp(true);
    const res = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '9.9.9.9, 203.0.113.5');
    // Documents exactly why `true` must not be used: it picks up the
    // attacker-controlled left-most entry instead of the real client.
    assert.equal(res.body.ip, '9.9.9.9');
  });
});
