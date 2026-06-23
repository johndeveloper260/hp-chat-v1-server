/**
 * Lightweight leveled logger — no external dependency.
 *
 * Controls log volume via the LOG_LEVEL env var so production can suppress
 * the chatty per-message `info`/`debug` output while always emitting
 * `warn` and `error`. This keeps the Heroku log subscription within quota.
 *
 *   LOG_LEVEL = error | warn | info | debug
 *
 * Default: "warn" in production, "info" otherwise.
 *
 * Usage:
 *   import logger from "../utils/logger.js";
 *   logger.info(`message ${id} translated`);   // dropped in prod (level=warn)
 *   logger.error("webhook failed:", err);       // always emitted
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const configured = (process.env.LOG_LEVEL || "").toLowerCase();
const defaultLevel = process.env.NODE_ENV === "production" ? "warn" : "info";
const activeLevel = configured in LEVELS ? configured : defaultLevel;
const threshold = LEVELS[activeLevel];

const logger = {
  error: (...args) => { if (threshold >= LEVELS.error) console.error(...args); },
  warn:  (...args) => { if (threshold >= LEVELS.warn)  console.warn(...args); },
  info:  (...args) => { if (threshold >= LEVELS.info)  console.log(...args); },
  debug: (...args) => { if (threshold >= LEVELS.debug) console.log(...args); },
  level: activeLevel,
};

export default logger;
