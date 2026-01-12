import "dotenv/config";

import { StreamChat } from "stream-chat";
import { getPool } from "../config/getPool.js";

import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import emailService from "../config/systemMailer.js"; // Note the .js extension

const router = express.Router();

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

// Ensure you import your pool and stream client correctly
// const { getPool } = require('../db');
// const streamClient = require('../streamConfig');

export const registerUser = async (req, res) => {
  const {
    email,
    password,
    firstName,
    middleName,
    lastName,
    userType,
    position,
    company,
    companyBranch,
    phoneNumber,
    visaType,
    visaExpiry,
    postalCode,
    streetAddress,
    city,
    state,
  } = req.body;

  // 1. Basic Validation
  if (!email || !password || !firstName || !lastName || !userType || !company) {
    return res.status(400).json({
      error:
        "Required fields are missing (email, password, names, userType, company)",
    });
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    // START TRANSACTION
    await client.query("BEGIN");

    const normalizedEmail = email.toLowerCase().trim();
    const hashedPassword = await bcrypt.hash(password, 10);

    // 2. Insert into Security Table (user_account_tbl)
    const accountQuery = `
      INSERT INTO v4.user_account_tbl (email, password_hash)
      VALUES ($1, $2) RETURNING id;
    `;
    const accountRes = await client.query(accountQuery, [
      normalizedEmail,
      hashedPassword,
    ]);
    const userId = accountRes.rows[0].id;

    // 3. Insert into Profile Table (user_profile_tbl)
    const profileQuery = `
      INSERT INTO v4.user_profile_tbl (
        user_id, first_name, middle_name, last_name, 
        user_type, position, company, company_branch,
        phone_number, postal_code, street_address, 
        city, state_province
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;

    const profileRes = await client.query(profileQuery, [
      userId,
      firstName,
      middleName || null,
      lastName,
      userType,
      position || null,
      company,
      companyBranch || null,
      phoneNumber || null,
      postalCode || null,
      streetAddress || null,
      city || null,
      state || null,
    ]);

    // 4. Sync with GetStream Chat
    const fullName = middleName
      ? `${lastName} ${firstName} ${middleName}`
      : `${lastName} ${firstName}`;

    await streamClient.upsertUser({
      id: userId,
      email: normalizedEmail,
      name: fullName,
      role: "user", // all users will be "user"
      // custom fields
      user_type: userType,
      company: company,
    });

    // 5. Generate Stream Token
    const streamToken = streamClient.createToken(userId);

    // COMMIT TRANSACTION - If we reached here, everything succeeded
    await client.query("COMMIT");

    return res.status(201).json({
      message: "Registration successful",
      user: {
        id: userId,
        email: normalizedEmail,
        profile: profileRes.rows[0],
      },
      streamToken,
    });
  } catch (err) {
    // IF ANYTHING FAILS, UNDO EVERYTHING
    await client.query("ROLLBACK");

    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already exists" });
    }

    console.error("Registration Transaction Error:", err);
    return res
      .status(500)
      .json({ error: "Internal server error during registration" });
  } finally {
    // Always release the database client back to the pool
    client.release();
  }
};
