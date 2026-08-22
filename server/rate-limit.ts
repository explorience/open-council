// Per-IP rate limiting for the chat server.
//
// POST /api/chat had no rate limiting at all before this fix — including the
// "most recent meeting" retrieval path (rag-service.ts, vectorStore.getMostRecent)
// which uses a dummy vector and never calls OpenAI, so it stays abusable even
// while the OpenAI key is out of credit. This module provides the limiter
// factory; server/index.ts wires it onto /api/chat.
//
// Limits are chosen for a civic Q&A tool with a real (if small) audience:
// 15/min lets a person have a genuine back-and-forth conversation without
// friction, while 200/day caps the worst case (a single IP hammering the
// endpoint all day) at a bounded, budgetable number of paid LLM calls. Both
// are overridable via env vars in case real traffic needs adjustment.

import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

/**
 * Railway puts exactly one reverse-proxy hop in front of the app. Express's
 * `trust proxy` must be set to this exact hop count (not `true`, which trusts
 * the whole X-Forwarded-For chain and lets a client spoof its own IP) — see
 * server/tests/trust-proxy.test.ts for the empirical proof, and server/index.ts
 * for where this is applied via `app.set('trust proxy', TRUST_PROXY_HOPS)`.
 */
export const TRUST_PROXY_HOPS = 1;

export const CHAT_RATE_LIMIT_PER_MINUTE = Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE) || 15;
export const CHAT_RATE_LIMIT_PER_DAY = Number(process.env.CHAT_RATE_LIMIT_PER_DAY) || 200;

export interface RateLimiterConfig {
  windowMs: number;
  limit: number;
  message: string;
}

/** Build a single express-rate-limit middleware from a plain config object (unit-testable with small windows). */
export function createRateLimiter(config: RateLimiterConfig): RequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: true, // RateLimit-* headers
    legacyHeaders: false, // no X-RateLimit-*
    message: { error: config.message },
  });
}

export const chatMinuteLimiterConfig: RateLimiterConfig = {
  windowMs: 60 * 1000,
  limit: CHAT_RATE_LIMIT_PER_MINUTE,
  message: 'Too many questions in a short time. Please wait a minute and try again.',
};

export const chatDailyLimiterConfig: RateLimiterConfig = {
  windowMs: 24 * 60 * 60 * 1000,
  limit: CHAT_RATE_LIMIT_PER_DAY,
  message: 'Daily question limit reached for your network. Please try again tomorrow.',
};

/** Both limiters chained: a tight per-minute burst limit plus a daily ceiling. */
export function createChatRateLimiters(): RequestHandler[] {
  return [createRateLimiter(chatMinuteLimiterConfig), createRateLimiter(chatDailyLimiterConfig)];
}
