import dotenv from "dotenv";
import { getPool } from "../config/getPool.js";

dotenv.config();

// 1. SEARCH / GET ALL (with filters)
export const searchInquiries = async (req, res) => {
  const { status, type, business_unit } = req.query;

  // Build dynamic query
  let query = `SELECT * FROM v4.inquiry_tbl WHERE 1=1`;
  const values = [];

  if (status) {
    values.push(status);
    query += ` AND status = $${values.length}`;
  }
  if (business_unit) {
    values.push(business_unit);
    query += ` AND business_unit = $${values.length}`;
  }

  query += ` ORDER BY last_update_dttm DESC`;

  try {
    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 2. CREATE
export const createInquiry = async (req, res) => {
  const { id: userId, business_unit: userBU } = req.user;
  const {
    company,
    title,
    description,
    occur_date,
    type,
    high_pri,
    watcher,
    owner_id,
  } = req.body;

  const query = `
    INSERT INTO v4.inquiry_tbl (
      business_unit, company, title, description, 
      occur_date, type, high_pri, watcher,
      opened_by, owner_id, status, open_dt,
      last_updated_by, last_update_dttm
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::uuid[], 
      $9::uuid, $10::uuid, 'OPEN', CURRENT_DATE,
      $9::uuid, NOW()
    ) RETURNING *;
  `;

  try {
    const values = [
      userBU,
      company,
      title,
      description,
      occur_date,
      type,
      high_pri,
      watcher || [],
      userId,
      owner_id || userId,
    ];
    const { rows } = await getPool().query(query, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 3. UPDATE
export const updateInquiry = async (req, res) => {
  const { ticketId } = req.params;
  const { id: userId } = req.user;
  const {
    status,
    assigned_to,
    resolution,
    description,
    high_pri,
    watcher,
    closed_dt,
  } = req.body;

  const query = `
    UPDATE v4.inquiry_tbl
    SET 
      status = $1,
      assigned_to = $2::uuid,
      resolution = $3,
      description = $4,
      high_pri = $5,
      watcher = $6::uuid[],
      closed_dt = $7,
      last_updated_by = $8::uuid,
      last_update_dttm = NOW()
    WHERE ticket_id = $9
    RETURNING *;
  `;

  try {
    const values = [
      status,
      assigned_to,
      resolution,
      description,
      high_pri,
      watcher,
      closed_dt,
      userId,
      ticketId,
    ];
    const { rows } = await getPool().query(query, values);
    if (rows.length === 0)
      return res.status(404).json({ error: "Ticket not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 4. DELETE
export const deleteInquiry = async (req, res) => {
  const { ticketId } = req.params;
  try {
    const { rowCount } = await getPool().query(
      "DELETE FROM v4.inquiry_tbl WHERE ticket_id = $1",
      [ticketId]
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Ticket not found" });
    res.json({ message: "Inquiry deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
