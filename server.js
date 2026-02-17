// 01-May 2025 | HoRenSo Plus v3
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

// --- Import Logic ---
import connectDB from "./config/db.js";
import slidingExpiration from "./middleware/slidingExpiration.js";

import register from "./routes/registerRoute.js";
import login from "./routes/loginRoute.js";
import access from "./routes/accessRoutes.js";
import profile from "./routes/profileRoutes.js";
import feed from "./routes/feedRoutes.js";
import inquiry from "./routes/inquiryRoutes.js";
import company from "./routes/companyRoutes.js";
import stream from "./routes/streamRoutes.js";
import attachmentRoutes from "./routes/attachmentRoutes.js";
import commentsRoutes from "./routes/commentRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import translateRoutes from "./routes/translateRoutes.js";
import sendingOrgRoutes from "./routes/sendingOrgRoutes.js";
import sharepointRoutes from "./routes/sharepointRoutes.js";

const app = express();
const httpServer = createServer(app);

// --- 1. CORS Configuration ---
const whitelist = [
  // Legacy Heroku frontend URLs
  process.env.NODE_ENV === "production"
    ? "https://hp-chat-v1-prod-fe23bd464547.herokuapp.com"
    : "https://hp-chat-v1-dev-0d0d5d3944dd.herokuapp.com",
  // Firebase Hosting URLs
  "https://hp-chat-web.web.app", // Production
  "https://hp-chat-web--dev-13u7zg05.web.app", // Dev channel
  // Custom domain (when connected)
  "https://app.horensoplus.com",
  "https://horensoplus.com",
  // Local development
  "http://localhost:5173",
  "http://localhost:3000",
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.includes(origin) || origin === "null") {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "x-auth-token",
    "Authorization",
    "Accept",
    "x-app-identity",
  ],
  exposedHeaders: ["X-Refresh-Token"], // Allow frontend to read this header
  credentials: true,
};

app.use(cors(corsOptions));

// --- CRITICAL: Register webhook routes BEFORE express.json() ---
// Stream Chat webhook needs raw body for signature verification
app.use("/stream", stream);

// --- 2. Middleware ---
app.use(express.json({ limit: "10mb" })); // Built-in body parser
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// --- Sliding Expiration Middleware (Before Routes) ---
app.use(slidingExpiration);

// --- 3. Database ---
connectDB();

// --- 4. Routes ---
app.get("/", (req, res) => res.status(200).send({ status: "ok" }));

app.use("/register", register);
app.use("/login", login);
app.use("/access", access);
app.use("/profile", profile);
app.use("/feed", feed);
app.use("/inquiry", inquiry);
app.use("/company", company);
// Stream routes already registered above (before express.json)
app.use("/attachments", attachmentRoutes);
app.use("/comments", commentsRoutes);
app.use("/notifications", notificationRoutes);
app.use("/translate", translateRoutes);
app.use("/sending-org", sendingOrgRoutes);

app.use("/sharepoint", sharepointRoutes);

const PORT = process.env.PORT || 8010;
httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
