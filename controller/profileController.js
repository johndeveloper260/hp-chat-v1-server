import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import dotenv from "dotenv";

import { getPool } from "../config/getPool.js"; // Note the .js extension

import { StreamChat } from "stream-chat";

dotenv.config();

// Initialize Stream Client (usually in a config file)
const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

// Add S3 Client
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
 * Update Work Visa
 */
export const updateWorkVisa = async (req, res) => {
  const { userId } = req.params;
  const data = req.body;

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    // 1. Update the Visa Info Table
    const visaQuery = `
      UPDATE v4.user_visa_info_tbl 
      SET 
        visa_type = $1, visa_number = $2, visa_issue_date = $3, 
        visa_expiry_date = $4, issuing_authority = $5,
        passport_no = $6, passport_name = $7, passport_expiry = $8,
        passport_issuing_country = $9, updated_at = NOW()
      WHERE user_id = $10
    `;
    const visaValues = [
      data.visa_type,
      data.visa_number,
      data.visa_issue_date,
      data.visa_expiry_date,
      data.issuing_authority,
      data.passport_no,
      data.passport_name,
      data.passport_expiry,
      data.passport_issuing_country,
      userId,
    ];
    await client.query(visaQuery, visaValues);

    await client.query("COMMIT");
    res.status(200).json({ message: "Update successful" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Database transaction failed" });
  } finally {
    client.release();
  }
};

/**
 * Get User Legal Profile (Profile + Visa)
 */
export const getUserLegalProfile = async (req, res) => {
  const { userId } = req.params;

  try {
    const query = `
      SELECT 
        p.id as profile_id,
        p.first_name, p.middle_name, p.last_name, p.user_type,
        p.position, p.company, p.company_branch,
        v.id as visa_record_id,
        v.visa_type, v.visa_number, v.visa_issue_date, v.visa_expiry_date,
        v.passport_expiry,v.issuing_authority, v.passport_issuing_country,
        v.passport_no,v.passport_name,
        v.joining_date, v.assignment_start_date
      FROM v4.user_profile_tbl p
      LEFT JOIN v4.user_visa_info_tbl v ON p.user_id = v.user_id
      WHERE p.user_id = $1;
    `;

    const result = await getPool().query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Database Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Get User Profile
 */
export const getUserProfile = async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await getPool().query(
      "SELECT * FROM v4.user_profile_tbl WHERE user_id = $1",
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

/**
 * Update User Profile
 */
/**
 * Update User Profile - WITH STREAM SYNC INCLUDING PROFILE PICTURE
 */
export const updateUserProfile = async (req, res) => {
  const { userId } = req.params;
  const {
    first_name,
    middle_name,
    last_name,
    user_type,
    position,
    company,
    batch_no,
    company_branch,
    phone_number,
    postal_code,
    street_address,
    city,
    state_province,
  } = req.body;

  try {
    const result = await getPool().query(
      `UPDATE v4.user_profile_tbl SET 
        first_name = $1, middle_name = $2, last_name = $3, 
        user_type = $4, position = $5, company = $6, batch_no = $14, 
        company_branch = $7, phone_number = $8, postal_code = $9, 
        street_address = $10, city = $11, state_province = $12, 
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $13 RETURNING *`,
      [
        first_name,
        middle_name,
        last_name,
        user_type,
        position,
        company,
        company_branch,
        phone_number,
        postal_code,
        street_address,
        city,
        state_province,
        userId,
        batch_no,
      ],
    );

    const loginQuery = `
      SELECT 
        a.id, 
        a.email, 
        a.business_unit, 
        p.first_name, 
        p.middle_name,
        p.last_name, 
        p.company,
        p.user_type,
        sa.s3_key as profile_pic_s3_key,
        sa.s3_bucket as profile_pic_s3_bucket
      FROM v4.user_account_tbl a
      LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
      LEFT JOIN LATERAL (
        SELECT s3_key, s3_bucket
        FROM v4.shared_attachments
        WHERE relation_type = 'profile'
          AND relation_id = a.id::text
        ORDER BY created_at DESC
        LIMIT 1
      ) sa ON true
      WHERE a.id = $1;
    `;

    const resultForUpdate = await getPool().query(loginQuery, [userId]);

    if (resultForUpdate.rows.length === 0) {
      return res.status(404).send("User not found");
    }

    const user = resultForUpdate.rows[0];
    const fullName = `${user.first_name} ${user.last_name}`.trim();
    const normalizedEmail = user.email.toLowerCase().trim();

    // Generate profile picture URL for Stream if exists
    let profileImageUrl = null;
    if (user.profile_pic_s3_key && user.profile_pic_s3_bucket) {
      try {
        const command = new GetObjectCommand({
          Bucket: user.profile_pic_s3_bucket,
          Key: user.profile_pic_s3_key,
        });

        profileImageUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 86400, // 24 hours for Stream
          signableHeaders: new Set(["host"]),
        });
      } catch (error) {
        console.error(
          "Error generating profile picture URL for Stream:",
          error,
        );
      }
    }

    // Sync with GetStream including profile picture
    const streamUserData = {
      id: user.id,
      name: fullName,
      email: normalizedEmail,
      company: user.company,
      business_unit: user.business_unit,
      user_type: user.user_type,
    };

    // Only add image if URL was generated successfully
    if (profileImageUrl) {
      streamUserData.image = profileImageUrl;
    }

    await serverClient.upsertUser(streamUserData);

    res.json({ message: "Profile updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Database Error");
  }
};

export const updateUserLanguage = async (req, res) => {
  const { language } = req.body;
  const userId = req.user.id;

  const validLanguages = ["en", "ja", "id", "vi"];
  if (!validLanguages.includes(language)) {
    return res.status(400).json({ error: "Invalid language code" });
  }

  try {
    await getPool().query(
      "UPDATE v4.user_account_tbl SET preferred_language = $1 WHERE id = $2",
      [language, userId],
    );

    res.json({ success: true, message: "Language preference updated" });
  } catch (error) {
    console.error("Update Language Error:", error);
    res.status(500).json({ error: "Failed to update language" });
  }
};
