/**
 * Opt-in guard for tests that send real requests to a running chat server.
 *
 * Those tests cost real LLM calls and eat into the server's rate limit, so they
 * must never run as part of a plain `npm test`. They run only when BOTH are set:
 *
 *   RUN_LIVE_CHAT_TESTS=1                    explicit opt-in
 *   CHATBOT_URL=<full /api/chat URL>         explicit target (no default, ever)
 *
 * Example (local dev server):
 *   RUN_LIVE_CHAT_TESTS=1 CHATBOT_URL=http://localhost:3000/api/chat npm run test:live
 */

export const LIVE_FLAG = 'RUN_LIVE_CHAT_TESTS';

export interface LiveChatConfig {
  /** Target chat URL. Empty string when the tests are skipped. */
  url: string;
  /** Pass as `{ skip }` to describe()/test(): a reason string, or false to run. */
  skip: string | false;
}

export function liveChatConfig(env: NodeJS.ProcessEnv = process.env): LiveChatConfig {
  // OPENCOUNCIL_API_URL is the older name used by q1-2026-accuracy.test.ts.
  const url = (env.CHATBOT_URL || env.OPENCOUNCIL_API_URL || '').trim();
  if (env[LIVE_FLAG] !== '1') {
    return { url: '', skip: `live chat tests are opt-in: set ${LIVE_FLAG}=1 and CHATBOT_URL` };
  }
  if (!url) {
    return { url: '', skip: 'live chat tests need an explicit CHATBOT_URL (there is no default)' };
  }
  return { url, skip: false };
}
