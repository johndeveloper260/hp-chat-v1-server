const { StreamChat } = require("stream-chat");

const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

require("dotenv").config();

const router = express.Router();

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);

// Ensure you import your pool and stream client correctly
const { getPool } = require("../config/getPool");

const emailService = require("../config/systemMailer");

// const { getPool } = require('../db');
// const streamClient = require('../streamConfig');

exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // 1. Fetch user and profile (Added a.business_unit to the SELECT)
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

    // 2. Compare passwords
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // 3. GENERATE JWT TOKEN (Option B Compatibility)
    // We use the keys your middleware expects: user_id and business_unit
    const payload = {
      user_id: String(user.id).trim(),
      business_unit: String(user.business_unit || "DEFAULT").replace(
        /[^a-zA-Z0-9]/g,
        ""
      ),
      test_flag: "ALIVE",
    };

    console.log("FINAL PAYLOAD STRINGS:", JSON.stringify(payload));

    const token = jwt.sign(payload, process.env.REACT_APP_SECRET_TOKEN.trim(), {
      expiresIn: "24h",
    });
    console.log("--- TOKEN GENERATED AT LOGIN ---");
    console.log(token);
    console.log(
      "DEBUG SECRET:",
      process.env.REACT_APP_SECRET_TOKEN.substring(0, 3) + "***"
    );

    // 4. Create a fresh Stream Token for this session
    const streamToken = streamClient.createToken(user.id);

    // 5. Return user data (Now includes the x-auth-token compatible 'token')
    return res.status(200).json({
      message: "Login successful",
      token, // Mobile app will save this as the auth token
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        userType: user.user_type,
        company: user.company,
        businessUnit: user.business_unit, // Included for the UI
      },
      streamToken,
    });
  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.handleForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const lowerEmail = email.toLowerCase().trim();

    // 1. Check if user exists in your specific schema/table
    const userResult = await getPool().query(
      "SELECT id FROM v4.user_account_tbl WHERE email = $1",
      [lowerEmail]
    );

    if (userResult.rows.length === 0) {
      // Security: Keep response generic
      return res
        .status(200)
        .json({ message: "Check your email for a reset code." });
    }

    // 2. Generate a random 8-character temporary password
    const resetCode = crypto.randomBytes(4).toString("hex");

    // 3. Hash the code for the database
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(resetCode, salt);

    // 4. Update the record in PostgreSQL
    // I am assuming your column name is 'password'
    await getPool().query(
      "UPDATE v4.user_account_tbl SET password_hash = $1 WHERE email = $2",
      [hashedPassword, lowerEmail]
    );

    // 5. Trigger the email function we modernized earlier
    const emailTitle = "Your Temporary Password";
    await emailService.passwordResetCode(lowerEmail, emailTitle, resetCode);

    return res.status(200).json({
      success: true,
      message: "Temporary password sent.",
    });
  } catch (error) {
    console.error("Postgres Forgot Password Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id; // Assuming you have auth middleware providing this

    // 1. Fetch user from v4.user_account_tbl
    const userResult = await getPool().query(
      "SELECT password_hash FROM v4.user_account_tbl WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.rows[0];

    // 2. Check if Current Password is correct
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res
        .status(400)
        .json({ message: "Current password is incorrect." });
    }

    // 3. Hash the New Password
    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    // 4. Update the database
    await getPool().query(
      "UPDATE v4.user_account_tbl SET password_hash = $1 WHERE id = $2",
      [hashedNewPassword, userId]
    );

    res
      .status(200)
      .json({ success: true, message: "Password updated successfully!" });
  } catch (error) {
    console.error("Update Password Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteUserAccount = async (req, res) => {
  const userId = req.user.id; // From your Auth Middleware
  console.log(userId);

  try {
    // 1. Delete from GetStream
    // Using hard: true removes message history, user data, and IDs permanently
    await streamClient.deleteUser(userId, {
      mark_messages_deleted: true,
      hard: true,
    });

    // 2. Delete from PostgreSQL
    // Because of Foreign Key constraints, deleting from user_account_tbl
    // will usually cascade to user_profile_tbl (if configured with ON DELETE CASCADE)
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
