const { StreamChat } = require("stream-chat");

const express = require("express");
const bcrypt = require("bcrypt");

require("dotenv").config();

const router = express.Router();

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

const { getPool } = require("../config/getPool");

// Ensure you import your pool and stream client correctly
// const { getPool } = require('../db');
// const streamClient = require('../streamConfig');

exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const pool = getPool();

    // 1. Fetch user and their profile details using a JOIN
    const loginQuery = `
      SELECT a.id, a.email, a.password_hash, p.first_name, p.last_name, p.user_type, p.company
      FROM v4.user_account_tbl a
      LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
      WHERE a.email = $1;
    `;

    const result = await pool.query(loginQuery, [email.toLowerCase().trim()]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    // 2. Compare passwords
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // 3. Create a fresh Stream Token for this session
    const streamToken = streamClient.createToken(user.id);

    // 4. Return user data (excluding password_hash)
    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        userType: user.user_type,
        company: user.company,
      },
      streamToken,
    });
  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
