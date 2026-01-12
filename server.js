// 01-May 2025 | HoRenSo Plus v3
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

// --- Import Logic ---
import connectDB from "./config/db.js";
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

const app = express();
const httpServer = createServer(app);

// --- 1. CORS Configuration ---
const whitelist = ["https://hp-ultra-chatv1-f47662ed467d.herokuapp.com"];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.includes(origin) || origin === "null") {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-auth-token", "Authorization", "Accept"],
  credentials: true,
};

app.use(cors(corsOptions));

// --- 2. Middleware ---
app.use(express.json({ limit: "10mb" })); // Built-in body parser
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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
app.use("/stream", stream);
app.use("/attachments", attachmentRoutes);
app.use("/comments", commentsRoutes);

const PORT = process.env.PORT || 8010;
httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
