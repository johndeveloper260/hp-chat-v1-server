const express = require("express");
const bcrypt = require("bcrypt");
require("dotenv").config();

const router = express.Router();

const { getPool } = require("../config/getPool");

/**
 * POST /api/register
 * Creates a new user in v4.user_account_tbl
 */
exports.registerUser = async (req, res) => {
  const { email, password } = req.body;

  // 1. Basic Validation
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // 2. Normalize email (lowercase) to prevent duplicates like John@ and john@
    const normalizedEmail = email.toLowerCase().trim();

    // 3. Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 4. Insert into the database
    const query = `
      INSERT INTO v4.user_account_tbl (email, password_hash)
      VALUES ($1, $2)
      RETURNING id, email, created_at;
    `;

    const values = [normalizedEmail, hashedPassword];
    const result = await getPool().query(query, values);

    // 5. Return success
    return res.status(201).json({
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (err) {
    // Handle specific PostgreSQL errors
    if (err.code === "23505") {
      // Unique violation error code
      return res.status(409).json({ error: "Email already exists" });
    }

    console.error("Registration Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
