//01-May 2025
//HoRenSo Plus v3
require("dotenv").config();

const express = require("express");
const app = express();
const cors = require("cors");
const bodyParser = require("body-parser");
const { StreamChat } = require("stream-chat");

// --- UPDATED CORS CONFIGURATION ---
// This replaces the old app.use(cors()) to allow DELETE and your custom headers
const corsOptions = {
  origin: ["https://9da42b3df893.ngrok-free.app"],
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-auth-token", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
};

// Apply to all requests
app.use(cors(corsOptions));

// Init Middleware
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const httpServer = require("http").createServer(app);

// Connect Database
const connectDB = require("./config/db");
connectDB();

// Routes
const register = require("./routes/registerRoute");
app.use("/register", register);

const login = require("./routes/loginRoute");
app.use("/login", login);

const access = require("./routes/accessRoutes");
app.use("/access", access);

// ... Other commented routes ...

const PORT = process.env.PORT || 8010;

httpServer.listen(PORT, () => console.log(`Server started on port ${PORT}`));
