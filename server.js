//01-May 2025
//HoRenSo Plus v3
require("dotenv").config();

// ... [Keep your require statements at the top] ...

const express = require("express");
const app = express();
const cors = require("cors");
const bodyParser = require("body-parser");

// --- REVISED CORS CONFIGURATION ---
const whitelist = ["https://hp-ultra-chatv1-f47662ed467d.herokuapp.com"];

const corsOptions = {
  origin: function (origin, callback) {
    // !origin allows requests with no "Origin" header (Mobile Apps, Postman, Curl)
    if (!origin || whitelist.includes(origin) || origin === "null") {
      callback(null, true);
    } else {
      console.log("CORS Blocked for origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-auth-token", "Authorization", "Accept"],
  credentials: true,
  optionsSuccessStatus: 200,
};

// 1. Apply CORS first
app.use(cors(corsOptions));

// 2. Add a Health Check Route (Essential for Safari testing)
app.get("/", (req, res) => {
  res
    .status(200)
    .send({ status: "ok", message: "Server is compliant and live!" });
});

// 3. Init Middleware
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ... [Rest of your routes: register, login, etc.] ...
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

const profile = require("./routes/profileRoutes");
app.use("/profile", profile);

const feed = require("./routes/feedRoutes");
app.use("/feed", feed);

const stream = require("./routes/streamRoutes");
app.use("/stream", stream);

// ... Other commented routes ...

const PORT = process.env.PORT || 8010;

httpServer.listen(PORT, () => console.log(`Server started on port ${PORT}`));
