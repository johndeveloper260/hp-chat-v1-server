require("dotenv").config();

// Ensure you import your pool and stream client correctly
const { getPool } = require("../config/getPool");

exports.updateWorkVisa = async (req, res) => {
  const { userId } = req.params;
  const data = req.body;

  const client = await pool.connect();

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

    // 2. Optional: If user is Officer, update Timeline dates
    // This adds a layer of backend security
    if (req.user.role === "OFFICER") {
      await client.query(
        "UPDATE v4.user_visa_info_tbl SET joining_date = $1, assignment_start_date = $2 WHERE user_id = $3",
        [data.joining_date, data.assignment_start_date, userId]
      );
    }

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

exports.getUserLegalProfile = async (req, res) => {
  const { userId } = req.params;

  try {
    /**
     * We use a LEFT JOIN to ensure that even if a visa record
     * hasn't been created yet, we still get the user's profile data.
     */
    const query = `
      SELECT 
        p.id as profile_id,
        p.first_name, p.middle_name, p.last_name, p.user_type,
        p.position, p.company, p.company_branch,
        v.id as visa_record_id,
        v.visa_type, v.visa_number, v.visa_issue_date, v.visa_expiry_date,
        v.passport_expiry,
        v.joining_date, v.assignment_start_date
      FROM v4.user_profile_tbl p
      LEFT JOIN v4.user_visa_info_tbl v ON p.user_id = v.user_id
      WHERE p.user_id = $1;
    `;

    const result = await getPool().query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Send the joined record back to the frontend
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Database Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
