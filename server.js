//01-May 2025
//HoRenSo Plus v3
require("dotenv").config();

const express = require("express");
const app = express();
const cors = require("cors");
const bodyParser = require("body-parser");
const { StreamChat } = require("stream-chat");

// Init Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// initialize Stream Chat SDK
const serverSideClient = new StreamChat(
  process.env.STREAM_API_KEY,
  process.env.STREAM_APP_SECRET
);

const httpServer = require("http").createServer(app);
// const io = require("socket.io")(httpServer, {
//   cors: {
//     origin: [
//       "http://localhost:3000",
//       "https://hp-web-ultra-dev.web.app",
//       "https://forward-hp-ultra.horensoplus.com",
//       "https://hp-web-ultra-prod.web.app",
//     ],
//     methods: ["GET", "POST", "PATCH"],
//   },
// });

// Connect Database
const connectDB = require("./config/db");
connectDB();

//Connect to websocket
// const ioSocket = require("./config/ioSocket");
// ioSocket(io);

const register = require("./routes/registerRoute");
app.use("/register", register);

const login = require("./routes/loginRoute");
app.use("/login", login);

// const auth = require("./routes/accountRoutes");
// app.use("/auth", auth);

const access = require("./routes/accessRoutes");
app.use("/access", access);

// const profile = require("./routes/profileRoutes");
// app.use("/profile", profile);

// const config = require("./routes/configRoutes");
// app.use("/config", config);

// const ticket = require("./routes/ticketRoutes");
// app.use("/ticket", ticket);

// const chat = require("./routes/chatRoutes");
// app.use("/chat", chat);

const PORT = process.env.PORT || 8010;

httpServer.listen(PORT, () => console.log(`Server started on port ${PORT}`));
