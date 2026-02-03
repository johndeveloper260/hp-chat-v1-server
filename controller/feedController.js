import dotenv from "dotenv";
import { getPool } from "../config/getPool.js";
import { sendNotificationToMultipleUsers } from "./notificationController.js";
import { getUserLanguage } from "../utils/getUserLanguage.js";

dotenv.config();

export const getPosters = async (req, res) => {
  const { business_unit } = req.user;

  try {
    const query = `
      SELECT DISTINCT 
        a.created_by AS value,
        p.first_name || ' ' || p.last_name AS label
      FROM v4.announcement_tbl a
      JOIN v4.user_profile_tbl p ON a.created_by = p.user_id
      WHERE a.business_unit = $1
      ORDER BY label ASC
    `;
    const { rows } = await getPool().query(query, [business_unit]);
    res.json(rows);
  } catch (err) {
    console.error("Get Posters Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /announcements
 * Fetch all active announcements with attachments
 */
export const getAnnouncements = async (req, res) => {
  const { company_filter } = req.query;
  const { id: userId, business_unit: userBU, userType: userType } = req.user;
  const userRole = (userType || "").toUpperCase();

  // Ensure preferredLanguage is passed in your values array (e.g., 'en', 'es')
  const preferredLanguage = await getUserLanguage(req.user.id);

  let query = `
    SELECT 
      a.row_id,
      a.business_unit,
      a.company as company_ids,
      a.batch_no,
      ARRAY(
        SELECT COALESCE(c.company_name->>$1, c.company_name->>'en')
        FROM v4.company_tbl c 
        WHERE c.company_id = ANY(a.company::uuid[]) 
        ORDER BY c.sort_order ASC
      ) as target_companies,
      a.title,
      a.content_text,
      a.reactions,
      a.date_from,
      a.date_to,
      a.active,
      (SELECT COUNT(*) FROM v4.shared_comments WHERE relation_id = a.row_id AND relation_type = 'announcements') as comment_count,
      (SELECT COUNT(*) FROM v4.announcement_views WHERE announcement_id = a.row_id::integer) as view_count,
      EXISTS(SELECT 1 FROM v4.announcement_views WHERE announcement_id = a.row_id::integer AND user_id = $2::uuid) as has_viewed,
       a.comments_on,
      a.created_by,
      to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
      u.first_name || ' ' || u.last_name as created_by_name,
      COALESCE(
        (
          SELECT json_agg(att)
          FROM (
            SELECT attachment_id, s3_key, s3_bucket, display_name as name, file_type as type
            FROM v4.shared_attachments
            WHERE relation_type = 'announcements' AND relation_id = a.row_id::text
          ) att
        ), '[]'
      ) as attachments
    FROM v4.announcement_tbl a
    LEFT JOIN v4.user_profile_tbl u ON a.created_by = u.user_id
    WHERE a.active = true 
      AND (a.date_to IS NULL OR a.date_to >= CURRENT_DATE)
  `;

  const values = [preferredLanguage || "en"];

  if (userRole === "ADMIN" || userRole === "OFFICER") {
    // ADMIN/OFFICER sees everything in the BU
  } else if (company_filter) {
    values.push(company_filter);
    query += ` AND ($${values.length} = ANY(a.company::uuid[]) OR a.company IS NULL OR cardinality(a.company) = 0)`;
  } else {
    query += ` AND (a.company IS NULL OR cardinality(a.company) = 0)`;
  }

  if (userBU) {
    values.push(userBU);
    query += ` AND business_unit = $${values.length}`;
  }

  query += ` ORDER BY a.created_at DESC`;

  try {
    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /announcements
 * Create a new announcement - WITH PUSH NOTIFICATIONS
 */
export const createAnnouncement = async (req, res) => {
  const { id: userId, business_unit: userBU } = req.user;

  const {
    company,
    batch_no,
    title,
    content_text,
    date_from,
    date_to,
    active,
    comments_on,
  } = req.body;

  const query = `
    INSERT INTO v4.announcement_tbl (
      business_unit, company, batch_no, title, content_text, 
      date_from, date_to, active, comments_on, 
      created_by, created_at, last_updated_by, last_updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, NOW(), $10::uuid, NOW())
    RETURNING *;
  `;

  try {
    const values = [
      userBU,
      company,
      batch_no || null,
      title,
      content_text,
      date_from,
      date_to,
      active,
      comments_on,
      userId,
    ];

    const { rows } = await getPool().query(query, values);
    const newAnnouncement = rows[0];

    // Get creator's name - ADDED ::uuid
    const creatorQuery = await getPool().query(
      `SELECT first_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1::uuid`,
      [userId],
    );
    const creatorName = creatorQuery.rows[0]
      ? `${creatorQuery.rows[0].first_name} ${creatorQuery.rows[0].last_name}`
      : "Someone";

    // UPDATED: Recipient Query with explicit casts
    let recipientQuery = `
      SELECT DISTINCT a.id::text as user_id
      FROM v4.user_account_tbl a
      JOIN v4.user_profile_tbl p ON a.id = p.user_id
      WHERE a.business_unit = $1::text 
        AND a.is_active = true
        AND a.id != $2::uuid
    `;

    const queryValues = [userBU, userId];

    if (company && Array.isArray(company) && company.length > 0) {
      queryValues.push(company);
      recipientQuery += ` AND (p.company::uuid = ANY($${queryValues.length}::uuid[]) OR p.company IS NULL)`;
    }

    const recipientResult = await getPool().query(recipientQuery, queryValues);
    const recipientIds = recipientResult.rows.map((row) => row.user_id);

    if (recipientIds.length > 0 && active) {
      await sendNotificationToMultipleUsers(
        recipientIds,
        `New Announcement: ${title}`,
        `${creatorName} posted a new announcement`,
        {
          type: "announcement",
          announcementId: newAnnouncement.row_id,
          screen: "HomeScreen",
          params: { rowId: newAnnouncement.row_id },
        },
      );
    }

    res.status(201).json(newAnnouncement);
  } catch (err) {
    console.error("Create Announcement Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * PUT /announcements/:id
 * Update an existing announcement - WITH PUSH NOTIFICATIONS
 */
export const updateAnnouncement = async (req, res) => {
  const { rowId } = req.params;
  const userId = req.user.id;
  const {
    company,
    batch_no,
    title,
    content_text,
    date_from,
    date_to,
    active,
    comments_on,
  } = req.body;

  // Ensure row_id cast matches your schema (integer vs uuid)
  const query = `
    UPDATE v4.announcement_tbl 
    SET 
      company = $1, batch_no = $2, title = $3, 
      content_text = $4, date_from = $5, date_to = $6, 
      active = $7, comments_on = $8, 
      last_updated_by = $9::uuid,
      last_updated_at = NOW()
    WHERE row_id = $10::integer  
    RETURNING *;
  `;

  try {
    const oldData = await getPool().query(
      "SELECT * FROM v4.announcement_tbl WHERE row_id = $1::integer",
      [rowId],
    );

    const values = [
      company,
      batch_no || null,
      title,
      content_text,
      date_from,
      date_to,
      active,
      comments_on,
      userId,
      rowId,
    ];

    const { rows } = await getPool().query(query, values);

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    const updatedAnnouncement = rows[0];
    const wasActivated = !oldData.rows[0].active && active;
    const titleChanged = oldData.rows[0].title !== title;
    const contentChanged = oldData.rows[0].content_text !== content_text;

    if (wasActivated || (active && (titleChanged || contentChanged))) {
      const updaterQuery = await getPool().query(
        `SELECT first_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1::uuid`,
        [userId],
      );
      const updaterName = updaterQuery.rows[0]
        ? `${updaterQuery.rows[0].first_name} ${updaterQuery.rows[0].last_name}`
        : "Someone";

      // UPDATED: Recipient Query with explicit casts
      let recipientQuery = `
        SELECT DISTINCT a.id::text as user_id
        FROM v4.user_account_tbl a
        JOIN v4.user_profile_tbl p ON a.id = p.user_id
        WHERE a.business_unit = $1::text 
          AND a.is_active = true
          AND a.id != $2::uuid
      `;

      const queryValues = [updatedAnnouncement.business_unit, userId];

      if (company && Array.isArray(company) && company.length > 0) {
        queryValues.push(company);
        recipientQuery += ` AND (p.company::uuid = ANY($${queryValues.length}::uuid[]) OR p.company IS NULL)`;
      }

      const recipientResult = await getPool().query(
        recipientQuery,
        queryValues,
      );
      const recipientIds = recipientResult.rows.map((row) => row.user_id);

      if (recipientIds.length > 0) {
        await sendNotificationToMultipleUsers(
          recipientIds,
          wasActivated
            ? `New Announcement: ${title}`
            : `Announcement Updated: ${title}`,
          wasActivated
            ? `${updaterName} posted an announcement`
            : `${updaterName} updated an announcement`,
          {
            type: "announcement",
            announcementId: rowId,
            screen: "HomeScreen",
            params: { rowId: rowId },
          },
        );
      }
    }

    res.json(updatedAnnouncement);
  } catch (err) {
    console.error("Update Announcement Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Toggle Reaction
 */
export const toggleReaction = async (req, res) => {
  const { rowId } = req.params;
  const { emoji } = req.body;
  const userId = String(req.user.id);

  try {
    const result = await getPool().query(
      "SELECT reactions FROM v4.announcement_tbl WHERE row_id = $1",
      [rowId],
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Post not found" });

    let reactions = result.rows[0].reactions || {};
    const isSameEmoji = reactions[emoji]?.includes(userId);

    Object.keys(reactions).forEach((key) => {
      if (Array.isArray(reactions[key])) {
        reactions[key] = reactions[key].filter((id) => id !== userId);
      }
      if (reactions[key].length === 0) delete reactions[key];
    });

    if (!isSameEmoji) {
      if (!reactions[emoji]) reactions[emoji] = [];
      reactions[emoji].push(userId);
    }

    const finalUpdate = await getPool().query(
      "UPDATE v4.announcement_tbl SET reactions = $1 WHERE row_id = $2 RETURNING reactions",
      [JSON.stringify(reactions), rowId],
    );

    res.json(finalUpdate.rows[0]);
  } catch (err) {
    console.error("Toggle Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /feed/companies-with-users
 * Returns only companies that have active users
 */
export const getCompaniesWithUsers = async (req, res) => {
  const { business_unit } = req.user;
  const lang = await getUserLanguage(req.user.id);

  try {
    const query = `
      SELECT DISTINCT 
        c.company_id AS value,
        COALESCE(c.company_name->>$1, c.company_name->>'en') AS label
      FROM v4.company_tbl c
      INNER JOIN v4.user_profile_tbl p ON p.company::uuid = c.company_id
      INNER JOIN v4.user_account_tbl a ON a.id = p.user_id
      WHERE c.business_unit = $2 
        AND c.is_active = true
        AND a.is_active = true
      ORDER BY label ASC
    `;
    const { rows } = await getPool().query(query, [lang, business_unit]);
    res.json(rows);
  } catch (err) {
    console.error("Get Companies Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /feed/batches/:companyId
 * Returns only batches that have active users in the company
 */
export const getBatchesByCompany = async (req, res) => {
  const { companyId } = req.params;

  try {
    const query = `
      SELECT DISTINCT 
        p.batch_no AS value,
        p.batch_no AS label
      FROM v4.user_profile_tbl p
      INNER JOIN v4.user_account_tbl a ON a.id = p.user_id
      WHERE p.company::uuid = $1::uuid
        AND p.batch_no IS NOT NULL
        AND a.is_active = true
      ORDER BY p.batch_no ASC
    `;
    const { rows } = await getPool().query(query, [companyId]);
    res.json(rows);
  } catch (err) {
    console.error("Get Batches Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /feed/preview-audience
 * Count users who will receive the announcement
 */
export const previewAudience = async (req, res) => {
  const { company, batch_no } = req.body;
  const { business_unit } = req.user;

  try {
    let query = `
      SELECT COUNT(DISTINCT a.id) as count
      FROM v4.user_account_tbl a
      INNER JOIN v4.user_profile_tbl p ON a.id = p.user_id
      WHERE a.business_unit = $1
        AND a.is_active = true
    `;

    const values = [business_unit];

    // Filter by company
    if (company && Array.isArray(company) && company.length > 0) {
      values.push(company);
      query += ` AND p.company::uuid = ANY($${values.length}::uuid[])`;
    }

    // Filter by batch_no (only if single company)
    if (batch_no && company && company.length === 1) {
      values.push(batch_no);
      query += ` AND p.batch_no = $${values.length}`;
    }

    const { rows } = await getPool().query(query, values);
    res.json({ count: parseInt(rows[0].count) || 0 });
  } catch (err) {
    console.error("Preview Audience Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /feed/reactions/:rowId
 * Get users who reacted to an announcement
 */
export const getReactions = async (req, res) => {
  const { rowId } = req.params;

  try {
    const result = await getPool().query(
      "SELECT reactions FROM v4.announcement_tbl WHERE row_id = $1",
      [rowId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Announcement not found" });
    }

    const reactions = result.rows[0].reactions || {};

    // Flatten reactions and get user details
    const userIds = Object.values(reactions).flat();

    if (userIds.length === 0) {
      return res.json([]);
    }

    const userQuery = `
      SELECT 
        a.id,
        p.first_name || ' ' || p.last_name AS name,
        p.company
      FROM v4.user_account_tbl a
      LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
      WHERE a.id = ANY($1::uuid[])
    `;

    const userResult = await getPool().query(userQuery, [userIds]);
    const userMap = {};
    userResult.rows.forEach((u) => {
      userMap[u.id] = { name: u.name, company: u.company };
    });

    // Build response with emoji groups
    const reactionList = Object.entries(reactions).map(([emoji, ids]) => ({
      emoji,
      users: ids.map((id) => ({
        id,
        ...userMap[id],
      })),
    }));

    res.json(reactionList);
  } catch (err) {
    console.error("Get Reactions Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ New endpoint: Mark announcement as seen
export const markAsSeen = async (req, res) => {
  const { rowId } = req.params;
  const userId = req.user.id;

  try {
    const query = `
      INSERT INTO v4.announcement_views (announcement_id, user_id)
      VALUES ($1::integer, $2::uuid)
      ON CONFLICT (announcement_id, user_id) DO NOTHING
      RETURNING *
    `;

    await getPool().query(query, [rowId, userId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Mark as seen error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ New endpoint: Get viewers list
export const getViewers = async (req, res) => {
  const { rowId } = req.params;

  try {
    const query = `
      SELECT 
        v.user_id as id,
        p.first_name || ' ' || p.last_name as name,
        v.viewed_at
      FROM v4.announcement_views v
      JOIN v4.user_profile_tbl p ON v.user_id = p.user_id
      WHERE v.announcement_id = $1::integer
      ORDER BY v.viewed_at DESC
    `;

    const { rows } = await getPool().query(query, [rowId]);
    res.json(rows);
  } catch (err) {
    console.error("Get viewers error:", err);
    res.status(500).json({ error: err.message });
  }
};
