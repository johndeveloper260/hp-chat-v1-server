import dotenv from "dotenv";
import { getPool } from "../config/getPool.js";

import { leaveApplicationAlert } from "../config/systemMailer.js";

dotenv.config();

// ==========================================
// ADMIN: SAVE OR UPDATE TEMPLATE
// ==========================================
export const saveLeaveTemplate = async (req, res) => {
  const { config, fields, company_id } = req.body;
  const business_unit = req.user.business_unit;
  // Allow admin/officer to specify a target company, fallback to own company
  const company = company_id || req.user.company;
  const userId = req.user.id;

  try {
    // Check if a template already exists for this company
    const checkQuery = `SELECT template_id, version FROM v4.leave_template_tbl WHERE company_id = $1 AND business_unit = $2 AND is_active = true`;
    const { rows } = await getPool().query(checkQuery, [
      company,
      business_unit,
    ]);

    // Ensure config and fields are stored as proper JSON strings for pg
    const configJSON = typeof config === "string" ? config : JSON.stringify(config);
    const fieldsJSON = typeof fields === "string" ? fields : JSON.stringify(fields);

    let result;
    if (rows.length > 0) {
      // Update existing (increment version)
      const updateQuery = `
        UPDATE v4.leave_template_tbl
        SET config = $1, fields = $2, version = version + 0.1, last_updated_by = $3, updated_at = NOW()
        WHERE template_id = $4
        RETURNING *;
      `;
      result = await getPool().query(updateQuery, [
        configJSON,
        fieldsJSON,
        userId,
        rows[0].template_id,
      ]);
    } else {
      // Insert new
      const insertQuery = `
        INSERT INTO v4.leave_template_tbl (company_id, business_unit, config, fields, last_updated_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `;
      result = await getPool().query(insertQuery, [
        company,
        business_unit,
        configJSON,
        fieldsJSON,
        userId,
      ]);
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Save Template Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// ==========================================
// USER: GET CURRENT TEMPLATE
// ==========================================
export const getLeaveTemplate = async (req, res) => {
  const business_unit = req.user.business_unit;
  // Allow admin/officer to query a specific company's template via query param
  const company = req.query.company_id || req.user.company;

  try {
    const query = `
      SELECT template_id, version, config, fields 
      FROM v4.leave_template_tbl 
      WHERE company_id = $1 AND business_unit = $2 AND is_active = true
      ORDER BY updated_at DESC LIMIT 1;
    `;
    const { rows } = await getPool().query(query, [company, business_unit]);

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No leave template configured for this company." });
    }

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error("Get Template Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// ==========================================
// USER: SUBMIT LEAVE APPLICATION
// ==========================================
export const submitLeave = async (req, res) => {
  const { templateId, answers } = req.body;
  const business_unit = req.user.business_unit;
  const company = req.user.company;
  const userId = req.user.id;

  try {
    // Ensure answers is stored as a proper JSON string for pg
    const answersJSON = typeof answers === "string" ? answers : JSON.stringify(answers);

    // 1. Save the submission
    const insertQuery = `
      INSERT INTO v4.leave_submission_tbl (template_id, user_id, company_id, business_unit, answers)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const { rows } = await getPool().query(insertQuery, [
      templateId,
      userId,
      company,
      business_unit,
      answersJSON,
    ]);

    const submission = rows[0];

    // 2. Fetch template config to get email recipients
    const templateQuery = `SELECT config, fields FROM v4.leave_template_tbl WHERE template_id = $1`;
    const templateRes = await getPool().query(templateQuery, [templateId]);

    if (templateRes.rows.length > 0) {
      const { config, fields } = templateRes.rows[0];
      const emails = config?.notificationEmails || [];

      if (emails.length > 0) {
        if (templateRes.rows.length > 0) {
          const { config, fields } = templateRes.rows[0];
          const emails = config?.notificationEmails || [];

          if (emails.length > 0) {
            // 1. Get the applicant's name
            const userQuery = `SELECT first_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1`;
            const userRes = await getPool().query(userQuery, [userId]);
            const applicantName =
              userRes.rows.length > 0
                ? `${userRes.rows[0].first_name} ${userRes.rows[0].last_name}`
                : "An Employee";

            // 2. Create a dictionary to quickly look up labels by field ID
            // e.g., { "f_start_date": "Start Date", "f_reason": "Reason for Leave" }
            const fieldLabels = fields.reduce((acc, field) => {
              acc[field.id] = field.label;
              return acc;
            }, {});

            // 3. Map the raw answers JSON into an array for Handlebars
            // Converts { "f_start_date": "2026-03-01" }
            // Into [{ question: "Start Date", answer: "2026-03-01" }]
            const answersData = Object.keys(answers).map((key) => {
              return {
                question: fieldLabels[key] || key, // Fallback to raw key if label missing
                answer: answers[key] || "N/A",
              };
            });

            // 4. Send the email to all configured recipients
            const homeurl =
              process.env.NODE_ENV === "production"
                ? "https://app.horensoplus.com"
                : "http://localhost:5173";

            const emailTitle = `New Leave Application: ${applicantName}`;

            for (const email of emails) {
              // Call the named export directly
              await leaveApplicationAlert(
                email,
                emailTitle,
                applicantName,
                answersData,
                homeurl,
              );
            }
          }
        }
        console.log(`Simulating email to: ${emails.join(", ")}`);
        console.log("Email Payload:", answers);
      }
    }

    res
      .status(201)
      .json({ message: "Leave submitted successfully", submission });
  } catch (err) {
    console.error("Submit Leave Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// ==========================================
// ADMIN/OFFICER: GET COMPANY SUBMISSIONS
// ==========================================
export const getCompanySubmissions = async (req, res) => {
  const business_unit = req.user.business_unit;
  // Allow admin/officer to query a specific company's submissions via query param
  const company = req.query.company_id || req.user.company;

  try {
    const query = `
      SELECT s.submission_id, s.status, s.answers, s.created_at,
             u.email, p.first_name, p.last_name
      FROM v4.leave_submission_tbl s
      JOIN v4.user_account_tbl u ON s.user_id = u.id
      JOIN v4.user_profile_tbl p ON u.id = p.user_id
      WHERE s.company_id = $1 AND s.business_unit = $2
      ORDER BY s.created_at DESC;
    `;
    const { rows } = await getPool().query(query, [company, business_unit]);
    res.status(200).json(rows);
  } catch (err) {
    console.error("Get Submissions Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
