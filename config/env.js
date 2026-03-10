/**
 * Centralized Environment Configuration
 *
 * Single source of truth for all process.env reads.
 * Validates required variables at startup — the server will refuse to
 * start rather than run silently with missing secrets.
 *
 * Usage:
 *   import env from "../config/env.js";
 *   const secret = env.jwt.secret;
 */

const env = {
  app: {
    port: Number(process.env.PORT) || 8010,
    nodeEnv: process.env.NODE_ENV || "development",
    backendUrl: process.env.BACKEND_URL || "http://localhost:8010",
    frontendUrl: process.env.FRONTEND_URL || "https://forward-hp-ultra.horensoplus.com",
  },

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  },

  jwt: {
    secret: process.env.SECRET_TOKEN,
    expiresIn: "30d",
    slidingWindowDays: 7,
  },

  stream: {
    apiKey: process.env.STREAM_API_KEY,
    apiSecret: process.env.STREAM_API_SECRET,
    tokenValidityHours: 24,
  },

  aws: {
    region: process.env.REACT_APP_AWS_REGION || process.env.AWS_REGION,
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET_NAME || process.env.REACT_APP_AWS_BUCKET,
  },

  email: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
  },

  google: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    // Raw service-account JSON string — used by translateService
    credentials: process.env.CREDENTIALS,
    // Path to service-account JSON — used by @google-cloud/translate
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  },

  cors: {
    whitelist: [
      process.env.NODE_ENV === "production"
        ? "https://hp-chat-v1-prod-fe23bd464547.herokuapp.com"
        : "https://hp-chat-v1-dev-0d0d5d3944dd.herokuapp.com",
      "https://hp-chat-web.web.app",
      "https://hp-chat-web--dev-13u7zg05.web.app",
      "https://app.horensoplus.com",
      "https://horensoplus.com",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
  },
};

// ─── Startup Validation ────────────────────────────────────────────────────
// Add any variable here that will cause silent failures if missing.
const REQUIRED = [
  ["DB_HOST",          env.db.host],
  ["DB_USER",          env.db.user],
  ["DB_PASS",          env.db.password],
  ["DB_DATABASE",      env.db.database],
  ["SECRET_TOKEN",     env.jwt.secret],
  ["STREAM_API_KEY",   env.stream.apiKey],
  ["STREAM_API_SECRET",env.stream.apiSecret],
];

for (const [name, value] of REQUIRED) {
  if (!value) {
    throw new Error(
      `[env] Missing required environment variable: ${name}\n` +
      `Check your .env file and ensure it is loaded before this module.`
    );
  }
}

export default env;
