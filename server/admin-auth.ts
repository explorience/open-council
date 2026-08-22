// Admin-token gate for cost-sensitive/destructive endpoints (e.g. POST /api/regenerate).
//
// POST /api/regenerate can trigger a FULL embedding regeneration
// (`generator.generateAll()` in server/embeddings.ts), which makes thousands of
// paid OpenAI calls. It must never be reachable by an anonymous caller.
//
// Design:
//   - Fail CLOSED: if ADMIN_API_TOKEN isn't set in the environment, every request
//     is rejected (503), never silently allowed through.
//   - Constant-time comparison so response timing can't be used to guess the
//     token one byte at a time.

import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export const ADMIN_TOKEN_HEADER = 'x-admin-token';

/**
 * Constant-time string comparison. Unlike `===`, this doesn't short-circuit on
 * the first differing byte, so it doesn't leak how many leading characters of
 * a guess were correct via response timing.
 *
 * Different-length inputs are handled by comparing against a same-length
 * buffer first (so we always pay for a real `timingSafeEqual` call and never
 * throw), then returning false — the length mismatch itself is not
 * secret-dependent, only guessable-content is.
 */
export function safeCompare(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (providedBuf.length !== expectedBuf.length) {
    // Still run a constant-time comparison of matching lengths so this
    // branch takes comparable time to the equal-length case, then fail.
    timingSafeEqual(providedBuf, providedBuf);
    return false;
  }

  if (providedBuf.length === 0) {
    // Two empty strings would technically be "equal", but an empty expected
    // token means auth is effectively disabled — never allow that silently.
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Express middleware: require a valid `x-admin-token` header matching the
 * `ADMIN_API_TOKEN` environment variable. Fails closed if the env var is unset.
 */
export function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_API_TOKEN;

  if (!expected) {
    console.error(
      '🔒 ADMIN_API_TOKEN is not configured — refusing admin request (fail closed).'
    );
    res.status(503).json({ error: 'Admin endpoint not configured' });
    return;
  }

  const provided = req.header(ADMIN_TOKEN_HEADER);
  if (!provided || !safeCompare(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
