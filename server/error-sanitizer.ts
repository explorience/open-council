// Sanitizes chat/LLM errors before they reach an anonymous HTTP caller.
//
// Before this fix, server/index.ts streamed `debug: errorMessage` — the raw
// SDK error text — straight to the client. That leaks upstream billing URLs,
// which provider is in use, and rate-limit/quota internals. This keeps the
// user-friendly category classification (used to tailor the message) but
// replaces the raw text with a generic message plus a correlation id; the
// raw detail is logged server-side (index.ts) keyed by that same id.

import { randomUUID } from 'node:crypto';

export type ErrorCategory =
  | 'rate_limit'
  | 'quota'
  | 'timeout'
  | 'context_length'
  | 'auth'
  | 'service_unavailable'
  | 'unknown';

export interface SanitizedChatError {
  error: string;
  errorCategory: ErrorCategory;
  errorId: string;
}

interface ErrorLike {
  message?: unknown;
  status?: unknown;
  code?: unknown;
  type?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === 'object' && value !== null;
}

/**
 * Classify an upstream (OpenAI/Anthropic/OpenRouter) error and produce a
 * client-safe payload. Never includes the original error message/stack.
 */
export function sanitizeChatError(error: unknown): SanitizedChatError {
  const err = isErrorLike(error) ? error : {};
  const errorMessage = typeof err.message === 'string' ? err.message : '';
  const errorCode = typeof err.code === 'string' ? err.code : typeof err.type === 'string' ? err.type : '';
  const statusCode = typeof err.status === 'number' ? err.status : 0;

  let userError = 'Error generating response';
  let errorCategory: ErrorCategory = 'unknown';

  if (errorMessage.includes('rate limit') || statusCode === 429) {
    userError = 'Rate limit exceeded. Please wait a moment and try again.';
    errorCategory = 'rate_limit';
  } else if (
    errorMessage.includes('insufficient') ||
    errorMessage.includes('credit') ||
    errorMessage.includes('quota')
  ) {
    userError = 'API quota exceeded. Please try again later.';
    errorCategory = 'quota';
  } else if (
    errorMessage.includes('timeout') ||
    errorCode === 'ETIMEDOUT' ||
    errorCode === 'ESOCKETTIMEDOUT'
  ) {
    userError = 'Request timed out. Try a simpler question.';
    errorCategory = 'timeout';
  } else if (
    errorMessage.includes('context') ||
    errorMessage.includes('too long') ||
    errorMessage.includes('maximum')
  ) {
    userError = 'Question too complex. Try breaking it into smaller parts.';
    errorCategory = 'context_length';
  } else if (statusCode === 401 || statusCode === 403 || errorMessage.includes('auth')) {
    userError = 'API authentication error. Please contact support.';
    errorCategory = 'auth';
  } else if (statusCode >= 500 || errorMessage.includes('unavailable')) {
    userError = 'AI service temporarily unavailable. Please try again.';
    errorCategory = 'service_unavailable';
  }

  return {
    error: userError,
    errorCategory,
    errorId: randomUUID(),
  };
}
