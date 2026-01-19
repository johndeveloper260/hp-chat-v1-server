import { StreamChat } from "stream-chat";
import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

// 1. Load environment variables
dotenv.config();

// 2. Import your modernized services
// IMPORTANT: You must include the .js extension in the import path
import { getPool } from "../config/getPool.js";
import * as emailService from "../config/systemMailer.js";

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

/**
 * Login User
 */
export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const loginQuery = `
      SELECT 
        a.id, 
        a.email, 
        a.password_hash, 
        a.business_unit, 
        p.first_name, 
        p.last_name, 
        p.user_type, 
        p.company
      FROM v4.user_account_tbl a
      LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
      WHERE a.email = $1;
    `;

    const result = await getPool().query(loginQuery, [
      email.toLowerCase().trim(),
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const payload = {
      user_id: String(user.id).trim(),
      userType: user.user_type,
      business_unit: String(user.business_unit || "DEFAULT").replace(
        /[^a-zA-Z0-9]/g,
        "",
      ),
    };

    // Right before jwt.sign
    console.log("SIGNING SECRET:", process.env.SECRET_TOKEN?.length, "chars");

    const token = jwt.sign(payload, process.env.SECRET_TOKEN.trim(), {
      expiresIn: "24h",
    });

    const streamToken = streamClient.createToken(user.id);

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        userType: user.user_type,
        company: user.company,
        businessUnit: user.business_unit,
      },
      streamToken,
    });
  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Handle Forgot Password
 */
export const handleForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const lowerEmail = email.toLowerCase().trim();

    const userResult = await getPool().query(
      "SELECT id FROM v4.user_account_tbl WHERE email = $1",
      [lowerEmail],
    );

    if (userResult.rows.length === 0) {
      return res
        .status(200)
        .json({ message: "Check your email for a reset code." });
    }

    const resetCode = crypto.randomBytes(4).toString("hex");
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(resetCode, salt);

    await getPool().query(
      "UPDATE v4.user_account_tbl SET password_hash = $1 WHERE email = $2",
      [hashedPassword, lowerEmail],
    );

    const emailTitle = "Your Temporary Password";
    await emailService.passwordResetCode(lowerEmail, emailTitle, resetCode);

    return res
      .status(200)
      .json({ success: true, message: "Temporary password sent." });
  } catch (error) {
    console.error("Postgres Forgot Password Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Update Password
 */
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    const userResult = await getPool().query(
      "SELECT password_hash FROM v4.user_account_tbl WHERE id = $1",
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.rows[0];

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res
        .status(400)
        .json({ message: "Current password is incorrect." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    await getPool().query(
      "UPDATE v4.user_account_tbl SET password_hash = $1 WHERE id = $2",
      [hashedNewPassword, userId],
    );

    res
      .status(200)
      .json({ success: true, message: "Password updated successfully!" });
  } catch (error) {
    console.error("Update Password Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Delete User Account
 */
export const deleteUserAccount = async (req, res) => {
  const userId = req.user.id;

  try {
    await streamClient.deleteUser(userId, {
      mark_messages_deleted: false,
      hard: false,
    });

    const deleteQuery = `DELETE FROM v4.user_account_tbl WHERE id = $1`;
    const result = await getPool().query(deleteQuery, [userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found in database" });
    }

    res
      .status(200)
      .json({ success: true, message: "Account deleted permanently" });
  } catch (err) {
    console.error("Deletion Error:", err);
    res.status(500).json({ error: "Server error during account deletion." });
  }
};
