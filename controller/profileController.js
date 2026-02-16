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
 * Search Users by Company, Batch Number, and Name
 */
/**
 * Search Users with Language Preference
 */
export const searchUsers = async (req, res) => {
  const { company, batch_no, name } = req.query;
  const userId = req.user.id;
  const userBU = req.user.business_unit;

  try {
    // 1. Fetch user's preferred language from account table
    const langResult = await getPool().query(
      "SELECT preferred_language FROM v4.user_account_tbl WHERE id = $1",
      [userId],
    );

    // Fallback to 'en' if not set
    const preferredLanguage = langResult.rows[0]?.preferred_language || "en";

    let queryValues = [];
    let queryParts = [];

    // 2. Base Query - JOIN account table to enforce same business_unit
    let sql = `
      SELECT
        p.user_id,
        p.first_name,
        p.last_name,
        p.company,
        COALESCE(
          c.company_name ->> $1,
          c.company_name ->> 'ja',
          c.company_name ->> 'en',
          (SELECT value FROM jsonb_each_text(c.company_name) LIMIT 1)
        ) AS company_name,
        p.batch_no,
        p.position,
        p.user_type
      FROM v4.user_profile_tbl p
      JOIN v4.user_account_tbl a ON p.user_id = a.id
      LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
      WHERE a.business_unit = $2
    `;

    // The preferredLanguage is the first parameter ($1), business_unit is $2
    queryValues.push(preferredLanguage);
    queryValues.push(userBU);

    // 3. Filter by Company (UUID)
    if (company) {
      queryValues.push(company);
      queryParts.push(`AND p.company = $${queryValues.length}`);
    }

    // 4. Filter by Batch Number
    if (batch_no) {
      queryValues.push(batch_no);
      queryParts.push(`AND p.batch_no = $${queryValues.length}`);
    }

    // 5. Filter by Name (Partial match)
    if (name) {
      queryValues.push(`%${name}%`);
      queryParts.push(
        `AND (p.first_name ILIKE $${queryValues.length} OR p.last_name ILIKE $${queryValues.length})`,
      );
    }

    sql += ` ${queryParts.join(" ")} ORDER BY p.first_name ASC LIMIT 50`;

    const result = await getPool().query(sql, queryValues);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Search Users Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Update Work Visa
 */
export const updateWorkVisa = async (req, res) => {
  const { userId } = req.params;
  const data = req.body;
  const userBU = req.user.business_unit;

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    // Verify the target user belongs to the requestor's business_unit
    const buCheck = await client.query(
      "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
      [userId, userBU],
    );
    if (buCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Helper to convert empty strings to NULL for Postgres DATE columns
    const toDate = (val) => (val === "" || !val ? null : val);

    // 1. Update the Visa Info Table
    const visaQuery = `
      UPDATE v4.user_visa_info_tbl
      SET
        visa_type = $1, 
        visa_number = $2, 
        visa_issue_date = $3,
        visa_expiry_date = $4, 
        issuing_authority = $5,
        passport_no = $6, 
        passport_name = $7, 
        passport_expiry = $8,
        passport_issuing_country = $9, 
        joining_date = $10,
        assignment_start_date = $11,
        updated_at = NOW()
      WHERE user_id = $12
    `;

    const visaValues = [
      data.visa_type,
      data.visa_number,
      toDate(data.visa_issue_date), // $3 - Fixed
      toDate(data.visa_expiry_date), // $4 - Fixed
      data.issuing_authority,
      data.passport_no,
      data.passport_name,
      toDate(data.passport_expiry), // $8 - Fixed
      data.passport_issuing_country,
      toDate(data.joining_date), // $10 - Fixed
      toDate(data.assignment_start_date), // $11 - Fixed
      userId, // $12
    ];

    await client.query(visaQuery, visaValues);

    await client.query("COMMIT");
    res.status(200).json({ message: "Update successful" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update Work Visa Error:", error); // Log the specific error
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
  const userBU = req.user.business_unit;

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
      JOIN v4.user_account_tbl a ON p.user_id = a.id
      LEFT JOIN v4.user_visa_info_tbl v ON p.user_id = v.user_id
      WHERE p.user_id = $1 AND a.business_unit = $2;
    `;

    const result = await getPool().query(query, [userId, userBU]);

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
  const userBU = req.user.business_unit;
  try {
    const result = await getPool().query(
      `SELECT p.* FROM v4.user_profile_tbl p
       JOIN v4.user_account_tbl a ON p.user_id = a.id
       WHERE p.user_id = $1 AND a.business_unit = $2`,
      [userId, userBU],
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
 * Update User Profile - WITH STREAM SYNC INCLUDING PROFILE PICTURE
 */
export const updateUserProfile = async (req, res) => {
  const { userId } = req.params;
  const userBU = req.user.business_unit;

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
    // New Fields
    country,
    sending_org,
    emergency_contact_name,
    emergency_contact_number,
    emergency_contact_address,
    emergency_email,
    birthdate,
    gender,
    company_joining_date, // Added new field
  } = req.body;

  try {
    // Verify the target user belongs to the requestor's business_unit
    const buCheck = await getPool().query(
      "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
      [userId, userBU],
    );

    if (buCheck.rowCount === 0) return res.status(403).send("Unauthorized");

    const cleanDate = (date) => (date === "" ? null : date);

    const result = await getPool().query(
      `UPDATE v4.user_profile_tbl SET
      first_name = $1,
      middle_name = $2,
      last_name = $3,
      user_type = $4,
      position = $5,
      company = $6,
      batch_no = $7,
      company_branch = $8,
      phone_number = $9,
      postal_code = $10,
      street_address = $11,
      city = $12,
      state_province = $13,
      country = $14,
      sending_org = $15,
      emergency_contact_name = $16,
      emergency_contact_number = $17,
      emergency_contact_address = $18,
      emergency_email = $19,
      birthdate = $20,
      gender = $21,
      company_joining_date = $22,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $23 RETURNING *`,
      [
        first_name, // $1
        middle_name, // $2
        last_name, // $3
        user_type, // $4
        position, // $5
        company, // $6
        batch_no, // $7
        company_branch, // $8
        phone_number, // $9
        postal_code, // $10
        street_address, // $11
        city, // $12
        state_province, // $13
        country, // $14
        sending_org, // $15
        emergency_contact_name, // $16
        emergency_contact_number, // $17
        emergency_contact_address, // $18
        emergency_email, // $19
        cleanDate(birthdate), // $20
        gender, // $21
        cleanDate(company_joining_date), // $22
        userId, // $23
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
        COALESCE(
          c.company_name ->> 'ja', 
          c.company_name ->> 'en', 
          (SELECT value FROM jsonb_each_text(c.company_name) LIMIT 1)
        ) AS company_name,
        p.batch_no,
        p.user_type,
        -- Visa Fields
        v.visa_type,
        COALESCE(
          vl.descr ->> 'ja', 
          vl.descr ->> 'en', 
          (SELECT value FROM jsonb_each_text(vl.descr) LIMIT 1)
        ) AS visa_type_descr,
        -- Profile fields
        p.country,
        p.sending_org,
        p.emergency_contact_name,
        p.emergency_contact_number,
        p.emergency_contact_address,
        p.emergency_email,
        p.birthdate,
        p.gender,
        p.company_joining_date,
        sa.s3_key as profile_pic_s3_key,
        sa.s3_bucket as profile_pic_s3_bucket
      FROM v4.user_account_tbl a
      LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
      LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
      LEFT JOIN v4.user_visa_info_tbl v ON a.id = v.user_id
      LEFT JOIN v4.visa_list_tbl vl ON (
        v.visa_type = vl.code 
        AND a.business_unit = vl.business_unit
      )
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
      company_name: user.company_name,
      visa_type_descr: user.visa_type_descr,
      batch_no: user.batch_no,
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
