import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

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
import { deleteFromS3 } from "./attachmentController.js";

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

//  Add S3 Client initialization (same as attachmentController)
const s3Client = new S3Client({
  region: process.env.REACT_APP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
  }),
  responseChecksumValidation: "WHEN_REQUIRED",
  requestChecksumCalculation: "WHEN_REQUIRED",
});

/**
 * Login User - Updated to include full profile & visa details
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
        a.is_active,
        a.preferred_language, 
        p.user_id, 
        p.first_name, 
        p.middle_name,
        p.last_name, 
        p.user_type, 
        p.position,
        p.company, 
        p.batch_no, 
        p.company_branch,
        p.phone_number,
        p.postal_code,
        p.street_address,
        p.city,
        p.state_province,
        -- Get translated company name with fallbacks
        COALESCE(
          c.company_name ->> a.preferred_language, 
          c.company_name ->> 'en', 
          (SELECT value FROM jsonb_each_text(c.company_name) LIMIT 1)
        ) AS company_name,
        v.visa_type,
        v.visa_expiry_date,
        sa.attachment_id as profile_pic_id,
        sa.s3_key as profile_pic_s3_key,
        sa.s3_bucket as profile_pic_s3_bucket,
        sa.display_name as profile_pic_name,
        sa.file_type as profile_pic_type
      FROM v4.user_account_tbl a
      LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
      LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
      LEFT JOIN v4.user_visa_info_tbl v ON a.id = v.user_id
      LEFT JOIN LATERAL (
        SELECT 
          attachment_id,
          s3_key,
          s3_bucket,
          display_name,
          file_type
        FROM v4.shared_attachments
        WHERE relation_type = 'profile'
          AND relation_id = a.id::text
        ORDER BY created_at DESC
        LIMIT 1
      ) sa ON true
      WHERE a.email = $1;
    `;

    const result = await getPool().query(loginQuery, [
      email.toLowerCase().trim(),
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate profile picture URL if exists
    let profilePictureUrl = null;
    if (user.profile_pic_s3_key && user.profile_pic_s3_bucket) {
      try {
        const command = new GetObjectCommand({
          Bucket: user.profile_pic_s3_bucket,
          Key: user.profile_pic_s3_key,
        });

        profilePictureUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 3600, // 1 hour
          signableHeaders: new Set(["host"]),
        });
      } catch (error) {
        console.error("Error generating profile picture URL:", error);
        // Continue without profile picture URL if generation fails
      }
    }

    // Prepare JWT Payload (keep this lightweight)
    const payload = {
      id: String(user.id).trim(),
      user_type: user.user_type,
      business_unit: user.business_unit,
      company: user.company,
      company_name: user.company_name,
      batch_no: user.batch_no,
      preferred_language: user.preferred_language || "en",
    };

    const token = jwt.sign(payload, process.env.SECRET_TOKEN.trim(), {
      expiresIn: "30d",
    });

    const streamToken = streamClient.createToken(String(user.id));

    // Return the COMPLETE user object for AuthContext
    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        businessUnit: user.business_unit,
        isActive: user.is_active,
        preferredLanguage: user.preferred_language || "en",
        userId: user.user_id,
        firstName: user.first_name,
        middleName: user.middle_name,
        lastName: user.last_name,
        userType: user.user_type,
        position: user.position,
        company: user.company,
        company_name: user.company_name,
        batch_no: user.batch_no,
        companyBranch: user.company_branch,
        phoneNumber: user.phone_number,
        postalCode: user.postal_code,
        streetAddress: user.street_address,
        city: user.city,
        stateProvince: user.state_province,
        visaType: user.visa_type,
        visaExpiry: user.visa_expiry_date,
        // Profile picture fields
        profilePicId: user.profile_pic_id,
        profilePictureUrl: profilePictureUrl,
        profilePicS3Key: user.profile_pic_s3_key,
        profilePicS3Bucket: user.profile_pic_s3_bucket,
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
 * Cleanup: Delete all profile attachments from S3 and DB for a given user.
 * Handles batch deletion (multiple profile history entries) and tolerates
 * files that are already missing from S3.
 */
const cleanupUserProfileAttachments = async (userId) => {
  const { rows } = await getPool().query(
    `SELECT attachment_id, s3_key, s3_bucket
     FROM v4.shared_attachments
     WHERE relation_type = 'profile' AND relation_id = $1`,
    [String(userId)],
  );

  if (rows.length === 0) {
    console.log(`No profile attachments found for user ${userId}`);
    return;
  }

  console.log(
    `Found ${rows.length} profile attachment(s) for user ${userId}. Cleaning up...`,
  );

  for (const row of rows) {
    try {
      await deleteFromS3(row.s3_key);
      console.log(`S3 deleted: ${row.s3_key} from bucket ${row.s3_bucket}`);
    } catch (s3Err) {
      // File may already be missing from S3 — log and continue
      console.warn(
        `S3 deletion skipped for ${row.s3_key} (may already be removed):`,
        s3Err.message,
      );
    }
  }

  // Bulk delete all profile rows from the DB after S3 cleanup
  await getPool().query(
    `DELETE FROM v4.shared_attachments
     WHERE relation_type = 'profile' AND relation_id = $1`,
    [String(userId)],
  );

  console.log(
    `DB cleanup complete: removed ${rows.length} profile attachment row(s) for user ${userId}`,
  );
};

/**
 * Delete User Account
 */
export const deleteUserAccount = async (req, res) => {
  const userId = req.user.id;

  try {
    // 1. Delete from GetStream
    await streamClient.deleteUser(userId, {
      mark_messages_deleted: false,
      hard: false,
    });

    // 2. Cleanup profile attachments (S3 + DB) before removing the user row
    await cleanupUserProfileAttachments(userId);

    // 3. Delete user row from PostgreSQL
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

/**
 * Request Account Deletion (Public Web Flow)
 * This sends an OTP to the email to verify the user owns the account.
 */
export const requestWebDeletion = async (req, res) => {
  const { email } = req.body;
  const lowerEmail = email.toLowerCase().trim();

  try {
    const userResult = await getPool().query(
      "SELECT id FROM v4.user_account_tbl WHERE email = $1",
      [lowerEmail],
    );

    if (userResult.rows.length === 0) {
      // Security: Don't reveal if email exists, return same success message
      return res.status(200).json({
        message: "If an account exists, a verification code has been sent.",
      });
    }

    // Reuse your existing OTP logic
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const otpExpiry = new Date(Date.now() + 15 * 60000); // 15 mins

    await getPool().query(
      "UPDATE v4.user_account_tbl SET otp_code = $1, otp_expiry = $2 WHERE email = $3",
      [otpCode, otpExpiry, lowerEmail],
    );

    await emailService.sendDeletionCode(
      lowerEmail,
      "Account Deletion Request",
      otpCode,
    );

    res.status(200).json({
      success: true,
      message: "Verification code sent to your email.",
    });
  } catch (err) {
    console.error("Web Deletion Request Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Finalize Account Deletion
 */
export const finalizeDeletion = async (req, res) => {
  const { email, otpCode } = req.body;
  // If req.user exists, they are logged in (In-App Path)
  const authenticatedUserId = req.user?.id;

  try {
    let targetId;

    if (authenticatedUserId) {
      // PATH A: In-App (Already have the ID from JWT)
      targetId = authenticatedUserId;
    } else {
      // PATH B: Web/Public (Must get ID from DB using Email + OTP)
      if (!email || !otpCode) {
        return res
          .status(400)
          .json({ error: "Email and verification code are required." });
      }

      const userResult = await getPool().query(
        "SELECT id, otp_code, otp_expiry FROM v4.user_account_tbl WHERE email = $1",
        [email.toLowerCase().trim()],
      );

      const user = userResult.rows[0];

      // Security check: Verify user exists, OTP matches, and hasn't expired
      if (!user || user.otp_code !== otpCode || new Date() > user.otp_expiry) {
        return res
          .status(401)
          .json({ error: "Invalid or expired verification code." });
      }

      // TAKE TARGET ID FROM userResult here
      targetId = user.id;
    }

    // 1. Delete from GetStream
    // Wrap targetId in an array and convert to string to be safe
    await streamClient.deleteUsers([String(targetId)], {
      user: "hard",
      messages: "hard",
      conversations: "hard",
    });

    // 2. Cleanup profile attachments (S3 + DB) before removing the user row
    await cleanupUserProfileAttachments(targetId);

    // 3. Delete from your PostgreSQL DB
    const deleteQuery = `DELETE FROM v4.user_account_tbl WHERE id = $1`;
    const dbResult = await getPool().query(deleteQuery, [targetId]);

    if (dbResult.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "User found in Stream but not in database." });
    }

    res.status(200).json({
      success: true,
      message:
        "Your account and all associated data have been permanently deleted.",
    });
  } catch (err) {
    console.error("Final Deletion Error:", err);
    res.status(500).json({ error: "Server error during account deletion." });
  }
};
