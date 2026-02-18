import { getPool } from "../config/getPool.js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// ── S3 client (same config as attachmentController) ──────────────────
const s3Client = new S3Client({
  region: process.env.REACT_APP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({ connectionTimeout: 5000 }),
  responseChecksumValidation: "WHEN_REQUIRED",
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const BUCKET = process.env.REACT_APP_AWS_BUCKET;

// ── Helpers ──────────────────────────────────────────────────────────
const OFFICER_TYPES = ["officer", "admin"];
const isOfficer = (userType) => OFFICER_TYPES.includes(userType?.toLowerCase());

// =====================================================================
// FOLDERS
// =====================================================================

/**
 * GET /sharepoint/folders?parent_id=...
 * Returns { folders, files } for the given parent.
 * Officers see everything; trainees see only company-scoped folders.
 */
export const getFolders = async (req, res) => {
  const { userType, company: userCompany, business_unit } = req.user;
  const { parent_id } = req.query; // undefined / null = root

  try {
    let folderQuery;
    let folderParams;

    if (isOfficer(userType)) {
      if (parent_id) {
        folderQuery = `SELECT * FROM v4.sharepoint_folders
                       WHERE parent_id = $1 AND business_unit = $2
                       ORDER BY name ASC`;
        folderParams = [parent_id, business_unit];
      } else {
        folderQuery = `SELECT * FROM v4.sharepoint_folders
                       WHERE parent_id IS NULL AND business_unit = $1
                       ORDER BY name ASC`;
        folderParams = [business_unit];
      }
    } else {
      // Trainees
      if (!parent_id) {
        folderQuery = `SELECT * FROM v4.sharepoint_folders
                       WHERE parent_id IS NULL
                         AND business_unit = $1
                         AND company_ids @> $2::jsonb
                       ORDER BY name ASC`;
        folderParams = [business_unit, JSON.stringify([userCompany])];
      } else {
        // Sub-folders: if trainee can see the parent, they see its children
        folderQuery = `SELECT * FROM v4.sharepoint_folders
                       WHERE parent_id = $1 AND business_unit = $2
                       ORDER BY name ASC`;
        folderParams = [parent_id, business_unit];
      }
    }

    const { rows: folders } = await getPool().query(folderQuery, folderParams);

    // Fetch files only when inside a folder
    let files = [];
    if (parent_id) {
      const { rows } = await getPool().query(
        `SELECT * FROM v4.sharepoint_files
         WHERE folder_id = $1 ORDER BY created_at DESC`,
        [parent_id],
      );
      files = rows;
    }

    res.json({ folders, files });
  } catch (err) {
    console.error("getFolders error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /sharepoint/folders
 * Body: { name, parent_id?, company_ids? }
 * Only officers can create root-level folders.
 */
export const createFolder = async (req, res) => {
  const { name, parent_id, company_ids } = req.body;
  const { id: userId, userType, business_unit } = req.user;

  if (!isOfficer(userType) && !parent_id) {
    return res
      .status(403)
      .json({ error: "Only officers can create top-level folders" });
  }

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Folder name is required" });
  }

  try {
    const { rows } = await getPool().query(
      `INSERT INTO v4.sharepoint_folders
         (name, parent_id, created_by, company_ids, business_unit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        name.trim(),
        parent_id || null,
        userId,
        JSON.stringify(company_ids || []),
        business_unit,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("createFolder error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /sharepoint/folders/:id
 * Recursively deletes a folder, its sub-folders, files in DB, and S3 objects.
 */
export const deleteFolder = async (req, res) => {
  const { id } = req.params;
  const { userType, business_unit } = req.user;

  if (!isOfficer(userType)) {
    return res.status(403).json({ error: "Only officers can delete folders" });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // Collect all descendant folder IDs via recursive CTE
    const { rows: descendantRows } = await client.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM v4.sharepoint_folders
         WHERE id = $1 AND business_unit = $2
         UNION ALL
         SELECT f.id FROM v4.sharepoint_folders f
         JOIN tree t ON f.parent_id = t.id
       )
       SELECT id FROM tree`,
      [id, business_unit],
    );

    if (descendantRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Folder not found" });
    }

    const folderIds = descendantRows.map((r) => r.id);

    // Get all S3 keys for files in those folders
    const { rows: fileRows } = await client.query(
      `SELECT s3_key FROM v4.sharepoint_files
       WHERE folder_id = ANY($1::uuid[])`,
      [folderIds],
    );

    // Delete files from S3
    const s3Promises = fileRows.map((f) =>
      s3Client
        .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: f.s3_key }))
        .catch((err) => console.error("S3 delete error:", f.s3_key, err)),
    );
    await Promise.all(s3Promises);

    // Delete files from DB
    await client.query(
      `DELETE FROM v4.sharepoint_files WHERE folder_id = ANY($1::uuid[])`,
      [folderIds],
    );

    // Delete folders from DB
    await client.query(
      `DELETE FROM v4.sharepoint_folders WHERE id = ANY($1::uuid[])`,
      [folderIds],
    );

    await client.query("COMMIT");
    res.json({
      message: "Folder deleted successfully",
      deletedCount: folderIds.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("deleteFolder error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// =====================================================================
// FILES — Presigned URL approach (matches existing attachments pattern)
// =====================================================================

/**
 * POST /sharepoint/files/generate-url
 * Body: { fileName, fileType, folderId }
 * Returns: { uploadUrl, s3Key, bucketName }
 */
export const generateUploadUrl = async (req, res) => {
  const { fileName, fileType, folderId } = req.body;
  const { business_unit } = req.user;

  if (!fileName || !fileType || !folderId) {
    return res
      .status(400)
      .json({ error: "fileName, fileType, and folderId are required" });
  }

  try {
    // Verify folder exists and belongs to this BU
    const { rowCount } = await getPool().query(
      `SELECT 1 FROM v4.sharepoint_folders
       WHERE id = $1 AND business_unit = $2`,
      [folderId, business_unit],
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Folder not found" });
    }

    // Build S3 key: sharepoint/{folderId}/{timestamp}-{sanitized}
    const sanitized = fileName
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "");
    const s3Key = `sharepoint/${folderId}/${Date.now()}-${sanitized}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    res.json({ uploadUrl, s3Key, bucketName: BUCKET });
  } catch (err) {
    console.error("generateUploadUrl error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /sharepoint/files/confirm
 * Body: { folder_id, display_name, s3_key, s3_bucket, file_type, file_size }
 * Saves the file record to DB after S3 upload completes.
 */
export const confirmFileUpload = async (req, res) => {
  const { folder_id, display_name, s3_key, s3_bucket, file_type, file_size } =
    req.body;
  const { id: userId, business_unit } = req.user;

  if (!folder_id || !s3_key) {
    return res.status(400).json({ error: "folder_id and s3_key are required" });
  }

  try {
    // Verify folder belongs to this BU
    const { rowCount } = await getPool().query(
      `SELECT 1 FROM v4.sharepoint_folders
       WHERE id = $1 AND business_unit = $2`,
      [folder_id, business_unit],
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const { rows } = await getPool().query(
      `INSERT INTO v4.sharepoint_files
         (folder_id, display_name, s3_key, s3_bucket, file_type, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        folder_id,
        display_name,
        s3_key,
        s3_bucket,
        file_type,
        file_size,
        userId,
      ],
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("confirmFileUpload error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /sharepoint/files/view/:id
 * Returns a 1-hour presigned viewing URL for a file.
 */
export const getFileViewUrl = async (req, res) => {
  const { id } = req.params;
  const { business_unit } = req.user;

  try {
    const { rows } = await getPool().query(
      `SELECT f.s3_key, f.s3_bucket
       FROM v4.sharepoint_files f
       JOIN v4.sharepoint_folders fld ON f.folder_id = fld.id
       WHERE f.id = $1 AND fld.business_unit = $2`,
      [id, business_unit],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }

    const command = new GetObjectCommand({
      Bucket: rows[0].s3_bucket,
      Key: rows[0].s3_key,
    });

    const url = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
      signableHeaders: new Set(["host"]),
    });

    res.json({ url });
  } catch (err) {
    console.error("getFileViewUrl error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /sharepoint/files/:id
 * Deletes a single file from S3 and DB.
 */
export const deleteFile = async (req, res) => {
  const { id } = req.params;
  const { userType, business_unit } = req.user;

  if (!isOfficer(userType)) {
    return res.status(403).json({ error: "Only officers can delete files" });
  }

  try {
    const { rows } = await getPool().query(
      `SELECT f.s3_key
       FROM v4.sharepoint_files f
       JOIN v4.sharepoint_folders fld ON f.folder_id = fld.id
       WHERE f.id = $1 AND fld.business_unit = $2`,
      [id, business_unit],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }

    // Delete from S3
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: rows[0].s3_key }),
    );

    // Delete from DB
    await getPool().query(`DELETE FROM v4.sharepoint_files WHERE id = $1`, [
      id,
    ]);

    res.json({ message: "File deleted successfully" });
  } catch (err) {
    console.error("deleteFile error:", err);
    res.status(500).json({ error: err.message });
  }
};

// =====================================================================
// BREADCRUMB
// =====================================================================

/**
 * GET /sharepoint/breadcrumb/:folderId
 * Returns the ancestor chain from root to the given folder.
 */
export const getBreadcrumb = async (req, res) => {
  const { folderId } = req.params;
  const { business_unit } = req.user;

  try {
    const { rows } = await getPool().query(
      `WITH RECURSIVE chain AS (
         SELECT id, name, parent_id, 0 AS depth
         FROM v4.sharepoint_folders
         WHERE id = $1 AND business_unit = $2
         UNION ALL
         SELECT f.id, f.name, f.parent_id, c.depth + 1
         FROM v4.sharepoint_folders f
         JOIN chain c ON f.id = c.parent_id
       )
       SELECT id, name FROM chain ORDER BY depth DESC`,
      [folderId, business_unit],
    );

    res.json({ breadcrumb: rows });
  } catch (err) {
    console.error("getBreadcrumb error:", err);
    res.status(500).json({ error: err.message });
  }
};
