// Caps chat history before it's sent to the LLM.
//
// server/rag-service.ts spread `history` directly into the messages array for
// every provider (chatStreamOpenAI/Anthropic/OpenRouter) with no bound on
// array length or per-message size. `req.body` is untyped JSON at runtime —
// nothing stopped a client from sending thousands of history entries (token
// cost per request scales with all of them) or smuggling a `role: "system"`
// entry into the array to try to override the real system prompt. This is
// applied once in RAGService.chat() so every provider path is covered.

import type { ChatMessage } from './types.js';

export const MAX_HISTORY_MESSAGES = 20;
export const MAX_HISTORY_MESSAGE_CHARS = 4000;

export interface CapChatHistoryOptions {
  maxMessages?: number;
  maxMessageChars?: number;
}

const VALID_ROLES = new Set(['user', 'assistant']);

/**
 * Return a bounded, well-formed copy of `history`:
 *   - only the most recent `maxMessages` entries are kept (oldest dropped)
 *   - each message's content is truncated to `maxMessageChars`
 *   - any entry whose `role` isn't 'user' or 'assistant' is dropped entirely
 *     (defends against a client-supplied `role: "system"` history entry)
 *   - non-array/malformed input safely becomes an empty history
 */
export function capChatHistory(
  history: ChatMessage[] | undefined | null,
  options: CapChatHistoryOptions = {}
): ChatMessage[] {
  const maxMessages = options.maxMessages ?? MAX_HISTORY_MESSAGES;
  const maxMessageChars = options.maxMessageChars ?? MAX_HISTORY_MESSAGE_CHARS;

  if (!Array.isArray(history)) return [];

  const wellFormed = history
    .filter((msg): msg is ChatMessage => isValidRole((msg as ChatMessage)?.role))
    .map((msg) => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content.slice(0, maxMessageChars) : '',
    }));

  return wellFormed.slice(-maxMessages);
}

function isValidRole(role: unknown): role is ChatMessage['role'] {
  return typeof role === 'string' && VALID_ROLES.has(role);
}
