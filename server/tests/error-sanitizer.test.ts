/**
 * Unit tests for chat error sanitization.
 *
 * Before this fix, server/index.ts streamed `debug: errorMessage` (the raw
 * SDK error text) straight to anonymous callers — leaking upstream billing
 * URLs, provider identity, and rate-limit internals. This locks in that the
 * client-facing payload never contains raw provider error text, while the
 * category classification (used for user-friendly messaging) is preserved,
 * and every error gets a correlation id so the raw detail (logged
 * server-side) can still be found when someone reports a problem.
 *
 * Run with: npm run test -- server/tests/error-sanitizer.test.ts
 */

import test, { describe } from 'node:test';
import assert from 'node:assert';
import { sanitizeChatError } from '../error-sanitizer.js';

describe('sanitizeChatError', () => {
  test('never includes the raw error message in the returned payload', () => {
    const err = Object.assign(new Error('Billing hard limit reached for org-abc123 at https://platform.openai.com/account/billing'), {
      status: 429,
    });
    const result = sanitizeChatError(err);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('platform.openai.com'));
    assert.ok(!serialized.includes('org-abc123'));
    assert.ok(!('debug' in result));
  });

  test('classifies rate limit errors and gives a generic user message', () => {
    const err = Object.assign(new Error('Rate limit exceeded for requests'), { status: 429 });
    const result = sanitizeChatError(err);
    assert.equal(result.errorCategory, 'rate_limit');
    assert.match(result.error, /rate limit/i);
  });

  test('classifies quota/credit errors', () => {
    const err = new Error('You exceeded your current quota, please check your plan and billing details');
    const result = sanitizeChatError(err);
    assert.equal(result.errorCategory, 'quota');
  });

  test('classifies timeouts', () => {
    const err = Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' });
    const result = sanitizeChatError(err);
    assert.equal(result.errorCategory, 'timeout');
  });

  test('classifies context-length errors', () => {
    const err = new Error("This model's maximum context length is 128000 tokens");
    const result = sanitizeChatError(err);
    assert.equal(result.errorCategory, 'context_length');
  });

  test('classifies auth errors', () => {
    const err = Object.assign(new Error('Incorrect API key provided'), { status: 401 });
    const result = sanitizeChatError(err);
    assert.equal(result.errorCategory, 'auth');
  });

  test('classifies 5xx as service_unavailable', () => {
    const err = Object.assign(new Error('The server had an error while processing your request'), { status: 500 });
    const result = sanitizeChatError(err);
    assert.equal(result.errorCategory, 'service_unavailable');
  });

  test('falls back to "unknown" for unrecognized errors, still without leaking text', () => {
    const err = new Error('some bizarre upstream failure mode we have never seen');
    const result = sanitizeChatError(err);
    assert.equal(result.errorCategory, 'unknown');
    assert.ok(!JSON.stringify(result).includes('bizarre upstream failure'));
  });

  test('generates a distinct errorId per call for correlation with server logs', () => {
    const err = new Error('boom');
    const a = sanitizeChatError(err);
    const b = sanitizeChatError(err);
    assert.notEqual(a.errorId, b.errorId);
    assert.ok(a.errorId.length > 0);
  });

  test('handles non-Error thrown values without throwing itself', () => {
    assert.doesNotThrow(() => sanitizeChatError('a plain string was thrown'));
    assert.doesNotThrow(() => sanitizeChatError(undefined));
    assert.doesNotThrow(() => sanitizeChatError({ weird: 'object' }));
  });
});
