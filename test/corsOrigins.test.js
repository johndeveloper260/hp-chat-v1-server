/**
 * CORS allow-list.
 *
 * Firebase preview channels get a new random URL every time they're recreated,
 * so any https://hp-chat-web--<channel>.web.app origin is allowed — but only
 * that exact host shape, never a look-alike on another domain.
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cors from "cors";
import { isAllowedOrigin } from "../config/corsOrigins.js";
import { errorHandler } from "../middleware/errorHandler.js";

const allowed = [
  "https://hp-chat-web--dev-x0b7zmr0.web.app", // current dev channel
  "https://hp-chat-web--pr-123-abc.web.app",   // a future channel
  "https://hp-chat-web.web.app",               // production
  "http://localhost:5173",
  "https://app.horensoplus.com",
];

const rejected = [
  "https://evil.example.com",
  "https://hp-chat-web--x.web.app.evil.com",   // suffix attack
  "https://evil.com/https://hp-chat-web--x.web.app",
  "http://hp-chat-web--dev-x0b7zmr0.web.app",  // not https
  "https://hp-chat-web--dev-x0b7zmr0.web.app:8443",
  "https://hp-chat-web--.web.app",             // empty channel
  "https://hp-chat-web--DEV.web.app",          // Firebase channel hosts are lowercase
  "https://other-site--dev-x0b7zmr0.web.app",
  "https://xhp-chat-web--dev.web.app",
];

test("allowed origins pass", () => {
  for (const origin of allowed) assert.equal(isAllowedOrigin(origin), true, origin);
});

test("look-alike and foreign origins are rejected", () => {
  for (const origin of rejected) assert.equal(isAllowedOrigin(origin), false, origin);
});

test("requests without an Origin header are still allowed (non-browser clients)", () => {
  assert.equal(isAllowedOrigin(undefined), true);
});

// Same cors wiring as server.js, to check what a browser preflight actually gets.
const startApp = async () => {
  const app = express();
  app.use(cors({
    origin: (origin, cb) => (isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-auth-token", "Authorization", "Accept", "x-app-identity"],
    credentials: true,
  }));
  app.post("/login/loginUser", (req, res) => res.sendStatus(200));
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
};

const preflight = (port, origin) => fetch(`http://127.0.0.1:${port}/login/loginUser`, {
  method: "OPTIONS",
  headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
});

test("preflight from the new dev channel gets 204 with the origin echoed back", async (t) => {
  const server = await startApp();
  t.after(() => server.close());
  const res = await preflight(server.address().port, "https://hp-chat-web--dev-x0b7zmr0.web.app");
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://hp-chat-web--dev-x0b7zmr0.web.app");
});

test("preflight from a foreign origin is refused with 403 and no allow-origin header", async (t) => {
  const server = await startApp();
  t.after(() => server.close());
  for (const origin of ["https://evil.example.com", "https://hp-chat-web--x.web.app.evil.com"]) {
    const res = await preflight(server.address().port, origin);
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers.get("access-control-allow-origin"), null, origin);
  }
});
