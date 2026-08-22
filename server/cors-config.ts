// CORS allowlist for the chat server.
//
// The chat server is called from browsers on opencouncil.xyz (and localhost in
// dev). A wide-open `cors()` lets ANY third-party site's client-side JS drive
// paid /api/chat calls from every visitor's browser (a cost-DoS vector, and a
// route straight past any same-origin assumptions the frontend makes). This
// restricts the CORS allowlist to explicit configured origins.
//
// Note: CORS is a browser-enforced protection — it does nothing against
// direct server-to-server or curl-style callers (they never send an Origin
// header and are unaffected either way). Rate limiting (server/rate-limit.ts)
// is the real defense against those; this closes the "malicious page uses
// visitors' browsers as a relay" vector specifically.

import type { CorsOptions } from 'cors';

/** Parse a comma-separated ALLOWED_ORIGINS env value into a clean origin list. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Build cors() options that only reflect an Origin header when it's in the
 * allowlist. Requests with no Origin header (curl, server-to-server, same-
 * origin navigation) are passed through — CORS headers are irrelevant to them.
 */
export function buildCorsOptions(allowedOrigins: string[]): CorsOptions {
  const allowed = new Set(allowedOrigins);
  return {
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      // Don't set CORS headers for disallowed origins. Passing `false`
      // (rather than an Error) keeps this a clean 2xx/no-CORS-header response
      // instead of a noisy 500 from Express's default error handler — the
      // browser still blocks the disallowed page from reading the response.
      callback(null, false);
    },
    credentials: false,
  };
}
