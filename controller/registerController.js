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
      SELECT business_unit, role_name, company 
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
    registrationCode, // Required
    position,
    companyBranch,
    phoneNumber,
    visaType,
    visaExpiry,
    postalCode,
    streetAddress,
    city,
    state,
  } = req.body;

  if (!email || !password || !firstName || !lastName || !registrationCode) {
    return res.status(400).json({
      error: "Missing required fields.",
    });
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Re-validate Code (Security Step)
    // We use the column 'company' as per your schema
    const xrefQuery = `
      SELECT business_unit, role_name, company 
      FROM v4.customer_xref_tbl 
      WHERE registration_code = $1
    `;
    const xrefRes = await client.query(xrefQuery, [registrationCode]);

    if (xrefRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid Registration Code" });
    }

    const { business_unit, role_name, company } = xrefRes.rows[0];
    const userRole = (role_name || "USER").toUpperCase();

    // 2. Create User
    const normalizedEmail = email.toLowerCase().trim();
    const hashedPassword = await bcrypt.hash(password, 10);

    const profileQuery = `
      INSERT INTO v4.user_profile_tbl (
        email, password_hash, first_name, middle_name, last_name, 
        user_type, role, business_unit, company, 
        position, company_branch, phone_number, 
        postal_code, street_address, city, state,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
      RETURNING user_id;
    `;

    const profileValues = [
      normalizedEmail,
      hashedPassword,
      firstName,
      middleName,
      lastName,
      userRole, // From XREF
      userRole, // From XREF
      business_unit, // From XREF
      company, // From XREF (UUID)
      position,
      companyBranch,
      phoneNumber,
      postalCode,
      streetAddress,
      city,
      state,
    ];

    const profileRes = await client.query(profileQuery, profileValues);
    const userId = profileRes.rows[0].user_id;

    // 3. Visa & Stream Chat
    const visaQuery = `
      INSERT INTO v4.visa_status_tbl (
        user_id, visa_type, visa_expiry_date, visa_issue_date, joining_date
      )
      VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE);
    `;
    const defaultVisaType = visaType || "Standard Work Visa";
    const defaultVisaExpiry =
      visaExpiry ||
      new Date(new Date().setFullYear(new Date().getFullYear() + 1));

    await client.query(visaQuery, [userId, defaultVisaType, defaultVisaExpiry]);

    const fullName = middleName
      ? `${lastName} ${firstName} ${middleName}`
      : `${lastName} ${firstName}`;

    await streamClient.upsertUser({
      id: userId,
      email: normalizedEmail,
      name: fullName,
      role: userRole.toLowerCase() === "admin" ? "admin" : "user",
      user_type: userRole,
      company: company,
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
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("Registration Error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
};
