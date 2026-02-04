import "dotenv/config";
import { StreamChat } from "stream-chat";
import { getPool } from "../config/getPool.js";
import express from "express";
import bcrypt from "bcrypt";

const router = express.Router();

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

// --- NEW: Validate Code Endpoint ---
export const validateCode = async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Code is required" });

  const pool = getPool();
  try {
    // Check against your specific table structure
    const query = `
      SELECT business_unit, role_name, company, batch_no 
      FROM v4.customer_xref_tbl 
      WHERE registration_code = $1
    `;
    const { rows } = await pool.query(query, [code]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Invalid Registration Code" });
    }

    // Return the found details so frontend can confirm/debug if needed
    // The UUID is in the 'company' column
    return res.json({
      valid: true,
      business_unit: rows[0].business_unit,
      role: rows[0].role_name,
      company_id: rows[0].company,
      batch_no: rows[0].batch_no,
    });
  } catch (err) {
    console.error("Validation Error:", err);
    return res.status(500).json({ error: "Validation Failed" });
  }
};

// --- REGISTER USER ---
export const registerUser = async (req, res) => {
  const {
    email,
    password,
    firstName,
    middleName,
    lastName,
    registrationCode,
    position,
    companyBranch,
    phoneNumber,
    visaType,
    visaExpiry,
    postalCode,
    streetAddress,
    city,
    state, // This maps to state_province in your table
  } = req.body;

  if (!email || !password || !firstName || !lastName || !registrationCode) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Validate Registration Code
    const xrefQuery = `
      SELECT business_unit, role_name, company, batch_no 
      FROM v4.customer_xref_tbl 
      WHERE registration_code = $1
    `;
    const xrefRes = await client.query(xrefQuery, [registrationCode]);

    if (xrefRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid Registration Code" });
    }

    const { business_unit, role_name, company, batch_no } = xrefRes.rows[0];
    const userRole = (role_name || "USER").toUpperCase();

    // 2. Insert into user_account_tbl
    const normalizedEmail = email.toLowerCase().trim();
    const hashedPassword = await bcrypt.hash(password, 10);

    const accountQuery = `
      INSERT INTO v4.user_account_tbl (
        email, password_hash, business_unit, is_active, created_at, updated_at
      )
      VALUES ($1, $2, $3, true, NOW(), NOW())
      RETURNING id as user_id;
    `;
    const accountRes = await client.query(accountQuery, [
      normalizedEmail,
      hashedPassword,
      business_unit,
    ]);
    const userId = accountRes.rows[0].user_id;

    // 3. Insert into user_profile_tbl
    const profileQuery = `
  INSERT INTO v4.user_profile_tbl (
    user_id, first_name, middle_name, last_name, 
    user_type, position, company, company_branch, 
    phone_number, postal_code, street_address, city, state_province,
    batch_no, created_at, updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
`;

    const profileValues = [
      userId,
      firstName,
      middleName,
      lastName,
      userRole,
      position,
      company,
      companyBranch,
      phoneNumber,
      postalCode,
      streetAddress,
      city,
      state,
      batch_no, // ✅ Moved to end
    ];

    await client.query(profileQuery, profileValues);

    // 4. Insert into user_visa_info_tbl
    const visaQuery = `
      INSERT INTO v4.user_visa_info_tbl (
        user_id, visa_type, visa_expiry_date, created_at, updated_at
      )
      VALUES ($1, $2, $3, NOW(), NOW());
    `;
    const defaultVisaType = visaType || "Standard Work Visa";
    const defaultVisaExpiry =
      visaExpiry ||
      new Date(new Date().setFullYear(new Date().getFullYear() + 1));

    await client.query(visaQuery, [userId, defaultVisaType, defaultVisaExpiry]);

    const getUserCompany = `
      SELECT 
    a.id AS user_id,
    a.email,
    p.first_name,
    p.last_name,
    a.preferred_language,
    -- Extract language-specific name from JSONB with an English fallback
    COALESCE(
        c.company_name ->> a.preferred_language, 
        c.company_name ->> 'en'
    ) AS company_name,
    c.website_url,
    p.user_type,
    p.position
    FROM user_account_tbl a
    JOIN user_profile_tbl p ON a.id = p.user_id
    LEFT JOIN company_tbl c ON p.company::uuid = c.company_id
    WHERE a.id = $1
    `;
    const getUserCompanyRes = await client.query(getUserCompany, [userId]);

    const { company_name } = getUserCompanyRes.rows[0];

    // 5. Stream Chat Integration
    const fullName = `${firstName} ${lastName}`.trim();

    await streamClient.upsertUser({
      id: userId,
      email: normalizedEmail,
      name: fullName,
      // role: userRole.toLowerCase() === "admin" ? "admin" : "user",
      role: "user",
      user_type: userRole,
      company: company,
      company_name: company_name,
      batch_no: batch_no,
      business_unit: business_unit,
    });

    const streamToken = streamClient.createToken(userId);

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Registration successful",
      user: { id: userId, email: normalizedEmail, role: userRole },
      streamToken,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      // Unique violation for email
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("Registration Error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
};
