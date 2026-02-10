import dotenv from "dotenv";
import { getPool } from "../config/getPool.js";
import { createNotification } from "./notificationController.js";
import { getUserLanguage } from "../utils/getUserLanguage.js";

dotenv.config();

// 1. SEARCH
export const searchInquiries = async (req, res) => {
  const { status, type, company_id, assigned_to, high_pri } = req.query;

  const businessUnit = req.user.business_unit;
  const userId = req.user.id;
  const userRole = req.user.userType?.toUpperCase() || "";
  const lang = await getUserLanguage(req.user.id);

  let query = `
  SELECT 
    i.*, 
    COALESCE(c.company_name->>$1, c.company_name->>'en', 'N/A') AS company_name_text,
    COALESCE(iss.descr->>$1, iss.descr->>'en', 'General Inquiry') AS type_name,
    TRIM(CONCAT(u_assign.first_name, ' ', u_assign.last_name)) AS assigned_to_name,
    TRIM(CONCAT(u_owner.first_name, ' ', u_owner.last_name)) AS owner_name,
    TRIM(CONCAT(u_open.first_name, ' ', u_open.last_name)) AS opened_by_name,
    TRIM(CONCAT(u_upd.first_name, ' ', u_upd.last_name)) AS last_updated_by_name,
    (SELECT STRING_AGG(TRIM(CONCAT(first_name, ' ', last_name)), ', ') 
     FROM v4.user_profile_tbl 
     WHERE user_id = ANY(i.watcher)) AS watcher_names, 
    (SELECT COUNT(*) 
     FROM v4.shared_comments 
     WHERE relation_type = 'inquiries' 
     AND relation_id = i.ticket_id) AS comment_count,
     COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'attachment_id', attachment_id,
            's3_key', s3_key,
            's3_bucket', s3_bucket,
            'name', display_name,
            'type', file_type
          )
        )
        FROM v4.shared_attachments
        WHERE relation_type = 'inquiries' 
        AND relation_id = i.ticket_id::text
      ), '[]'::json
    ) as attachments
  FROM v4.inquiry_tbl i
  LEFT JOIN v4.company_tbl c ON i.company = c.company_id
  LEFT JOIN v4.issue_tbl iss ON i.type = iss.code AND i.business_unit = iss.business_unit
  LEFT JOIN v4.user_profile_tbl u_assign ON i.assigned_to = u_assign.user_id
  LEFT JOIN v4.user_profile_tbl u_owner ON i.owner_id = u_owner.user_id
  LEFT JOIN v4.user_profile_tbl u_open ON i.opened_by = u_open.user_id
  LEFT JOIN v4.user_profile_tbl u_upd ON i.last_updated_by = u_upd.user_id
  WHERE i.business_unit = $2
  `;

  const values = [lang, businessUnit];

  if (userRole !== "OFFICER") {
    values.push(userId);
    query += ` AND i.owner_id = $${values.length}::uuid`;
  }

  if (status && status !== "All") {
    values.push(status);
    query += ` AND i.status = $${values.length}`;
  } else if (!status || status === "All") {
    query += ` AND i.status NOT IN ('Completed', 'Hold')`;
  }

  if (type && type !== "All") {
    values.push(type);
    query += ` AND i.type = $${values.length}`;
  }

  if (company_id && company_id !== "null") {
    values.push(company_id);
    query += ` AND i.company = $${values.length}`;
  }

  if (assigned_to && assigned_to !== "null") {
    values.push(assigned_to);
    query += ` AND i.assigned_to = $${values.length}::uuid`;
  }

  if (high_pri === "true" || high_pri === true) {
    query += ` AND i.high_pri = true`;
  }

  query += ` ORDER BY i.last_update_dttm DESC`;

  try {
    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    console.error("Search Inquiries Error:", err);
    res.status(500).json({ error: "Search failed" });
  }
};

// 2. CREATE - WITH DB LOGGING & PUSH
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
    opened_by,
  } = req.body;

  const query = `
  INSERT INTO v4.inquiry_tbl (
    business_unit, company, title, description, 
    occur_date, type, high_pri, watcher,
    opened_by, owner_id, assigned_to, 
    status, open_dt, last_updated_by, last_update_dttm
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8::uuid[], 
    $9::uuid, $10::uuid, $11::uuid, 
    'New', CURRENT_DATE, $9::uuid, NOW()
  ) RETURNING *;
`;

  try {
    const values = [
      userBU,
      company && company !== "" ? company : null, // Fix for parameter $2
      title,
      description,
      occur_date,
      type,
      high_pri,
      Array.isArray(watcher) ? watcher.filter((id) => id !== "") : [],
      opened_by || userId,
      owner_id || userId,
      req.body.assigned_to || null, // Add this as $11
    ];

    const { rows } = await getPool().query(query, values);
    const newInquiry = rows[0];

    // 1. BUILD RECIPIENT LIST (Owner, Assignee, and Watchers)
    const recipients = [
      owner_id,
      req.body.assigned_to,
      ...(Array.isArray(watcher) ? watcher : []),
    ];

    // 2. FILTER: Remove duplicates, nulls, and do not notify self (creator)
    const notificationRecipients = [...new Set(recipients)].filter(
      (id) => id && id !== userId,
    );

    // ✅ Fetch creator's name
    const creatorQuery = await getPool().query(
      `SELECT first_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1`,
      [userId],
    );
    const creatorName = creatorQuery.rows[0]
      ? `${creatorQuery.rows[0].first_name} ${creatorQuery.rows[0].last_name}`
      : "Someone";

    if (notificationRecipients.length > 0) {
      const titleKey = high_pri ? "new_inquiry_high_priority" : "new_inquiry";

      await Promise.all(
        notificationRecipients.map((recipientId) =>
          createNotification({
            userId: recipientId,
            titleKey: titleKey,
            bodyKey: "created_inquiry",
            bodyParams: { name: creatorName, title: title },
            data: {
              type: "inquiries",
              rowId: newInquiry.ticket_id,
              screen: "Inquiry",
              params: { ticketId: newInquiry.ticket_id },
            },
          }),
        ),
      );
    }

    res.status(201).json(newInquiry);
  } catch (err) {
    console.error("Create Inquiry Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 3. UPDATE - WITH PUSH NOTIFICATIONS
export const updateInquiry = async (req, res) => {
  const { ticketId } = req.params;
  const userId = req.user.id;
  const userBU = req.user.business_unit;
  const {
    status,
    assigned_to,
    resolution,
    description,
    high_pri,
    watcher,
    closed_dt,
    title,
    type,
    occur_date,
  } = req.body;

  const query = `
    UPDATE v4.inquiry_tbl
    SET status = $1, assigned_to = $2::uuid, resolution = $3, description = $4,
        high_pri = $5, watcher = $6::uuid[], closed_dt = $7, last_updated_by = $8::uuid,
        last_update_dttm = NOW(), title=$10, type=$11, occur_date=$12
    WHERE ticket_id = $9 AND business_unit = $13 RETURNING *;
  `;

  try {
    const oldInquiry = await getPool().query(
      "SELECT * FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
      [ticketId, userBU],
    );

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
      title,
      type,
      occur_date,
      userBU,
    ];
    const { rows } = await getPool().query(query, values);
    if (rows.length === 0)
      return res.status(404).json({ error: "Ticket not found" });

    const updatedInquiry = rows[0];

    const updaterQuery = await getPool().query(
      `SELECT first_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1`,
      [userId],
    );
    const updaterName = updaterQuery.rows[0]
      ? `${updaterQuery.rows[0].first_name} ${updaterQuery.rows[0].last_name}`
      : "Someone";

    // BUILD RECIPIENT LIST
    const recipientsSet = new Set();

    // 1. Notify the Owner (if it's not the person updating)
    if (updatedInquiry.owner_id && updatedInquiry.owner_id !== userId) {
      recipientsSet.add(updatedInquiry.owner_id);
    }

    // 2. Notify the Assignee (if it's not the person updating)
    if (updatedInquiry.assigned_to && updatedInquiry.assigned_to !== userId) {
      recipientsSet.add(updatedInquiry.assigned_to);
    }

    // 3. Notify Watchers (if they aren't the person updating)
    if (watcher && Array.isArray(watcher)) {
      watcher.forEach((w) => {
        if (w && w !== userId) recipientsSet.add(w);
      });
    }

    const recipients = Array.from(recipientsSet);

    if (recipients.length > 0) {
      let bodyKey;
      let bodyParams = { name: updaterName };

      if (status && status !== oldInquiry.rows[0].status) {
        bodyKey = "changed_status_to";
        bodyParams.status = status;
      } else if (
        assigned_to &&
        assigned_to !== oldInquiry.rows[0].assigned_to
      ) {
        bodyKey = "assigned_to_you";
      } else {
        bodyKey = "updated_inquiry";
      }

      await Promise.all(
        recipients.map((recipientId) =>
          createNotification({
            userId: recipientId,
            titleKey: "inquiry_updated",
            bodyKey: bodyKey,
            bodyParams: { ...bodyParams, title: updatedInquiry.title },
            data: {
              type: "inquiries",
              rowId: ticketId,
              screen: "Inquiry",
              params: { ticketId: ticketId },
            },
          }),
        ),
      );
    }

    res.json(updatedInquiry);
  } catch (err) {
    console.error("Update Inquiry Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 4. DELETE
export const deleteInquiry = async (req, res) => {
  const { ticketId } = req.params;
  const userBU = req.user.business_unit;
  try {
    const { rowCount } = await getPool().query(
      "DELETE FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
      [ticketId, userBU],
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Ticket not found" });
    res.json({ message: "Inquiry deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

//5. GET ISSUE TYPE
export const getIssues = async (req, res) => {
  const lang = await getUserLanguage(req.user.id);
  const bu = req.user.business_unit;

  try {
    const query = `
      SELECT 
        code AS value, 
        COALESCE(descr->>$1, descr->>'en', code) AS label,
        active
      FROM v4.issue_tbl
      WHERE business_unit = $2 AND active = true
      ORDER BY sort_order ASC
    `;
    const { rows } = await getPool().query(query, [lang, bu]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

//6. GET Officer
export const getOfficersByBU = async (req, res) => {
  try {
    const bu = req.user.business_unit;

    if (!bu) {
      return res
        .status(400)
        .json({ error: "Business Unit missing from user token" });
    }

    const query = `
    SELECT 
        p.user_id AS value, 
        p.first_name || ' ' || p.last_name AS label
    FROM v4.user_profile_tbl p
    JOIN v4.user_account_tbl a ON p.user_id = a.id
    WHERE a.business_unit = $1 
      AND p.user_type = 'OFFICER'
      AND a.is_active = true
    ORDER BY p.first_name ASC
    `;

    const { rows } = await getPool().query(query, [bu]);
    res.status(200).json(rows || []);
  } catch (error) {
    console.error("Backend Error (getOfficersByBU):", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
