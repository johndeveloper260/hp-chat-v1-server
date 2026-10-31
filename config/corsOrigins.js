/**
 * CORS origin allow-list, used by server.js.
 *
 * Kept out of server.js so it can be unit-tested without booting the app.
 */

export const whitelist = [
  // Legacy Heroku frontend URLs
  process.env.NODE_ENV === "production"
    ? "https://hp-chat-v1-prod-fe23bd464547.herokuapp.com"
    : "https://hp-chat-v1-dev-0d0d5d3944dd.herokuapp.com",
  // Firebase Hosting URLs
  "https://hp-chat-web.web.app", // Production
  "https://hp-chat-web--dev-x0b7zmr0.web.app", // Dev channel (expires 2026-11-30)
  // Custom domain (when connected)
  "https://app.horensoplus.com",
  "https://horensoplus.com",
  // Local development
  "http://localhost:5173",
  "http://localhost:3000",
];

// Any Firebase preview channel of the hp-chat-web site. Channels get a new
// random suffix each time they're recreated, so the exact dev URL above goes
// stale; this keeps the next one working. Anchored, https only, exact host.
const FIREBASE_PREVIEW_CHANNEL = /^https:\/\/hp-chat-web--[a-z0-9-]+\.web\.app$/;

/** True when a request from this Origin header may call the API. */
export const isAllowedOrigin = (origin) =>
  !origin || // same-origin / non-browser requests send no Origin
  origin === "null" ||
  whitelist.includes(origin) ||
  FIREBASE_PREVIEW_CHANNEL.test(origin);
