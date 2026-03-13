/**
 * Sharepoint Repository
 *
 * Raw SQL for v4.sharepoint_folders and v4.sharepoint_files.
 * Write functions that participate in a transaction accept an optional `client`.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ─── Folders — read ───────────────────────────────────────────────────────────

export const findRootFoldersOfficer = async (businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT * FROM v4.sharepoint_folders
     WHERE parent_id IS NULL AND business_unit = $1
     ORDER BY name ASC`,
    [businessUnit],
  );
  return rows;
};

export const findSubFolders = async (parentId, businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT * FROM v4.sharepoint_folders
     WHERE parent_id = $1 AND business_unit = $2
     ORDER BY name ASC`,
    [parentId, businessUnit],
  );
  return rows;
};

/** Root folders scoped to a company (trainee view). */
export const findRootFoldersForCompany = async (businessUnit, userCompany) => {
  const { rows } = await getPool().query(
    `SELECT * FROM v4.sharepoint_folders
     WHERE parent_id IS NULL
       AND business_unit = $1
       AND company_ids @> $2::jsonb
     ORDER BY name ASC`,
    [businessUnit, JSON.stringify([userCompany])],
  );
  return rows;
};

export const findFilesInFolder = async (folderId) => {
  const { rows } = await getPool().query(
    `SELECT * FROM v4.sharepoint_files
     WHERE folder_id = $1
     ORDER BY created_at DESC`,
    [folderId],
  );
  return rows;
};

export const findFolderById = async (id, businessUnit, client) => {
  const { rows } = await db(client).query(
    `SELECT id, parent_id FROM v4.sharepoint_folders
     WHERE id = $1 AND business_unit = $2`,
    [id, businessUnit],
  );
  return rows[0] ?? null;
};

export const verifyFolderBU = async (folderId, businessUnit, client) => {
  const { rowCount } = await db(client).query(
    `SELECT 1 FROM v4.sharepoint_folders WHERE id = $1 AND business_unit = $2`,
    [folderId, businessUnit],
  );
  return rowCount;
};

// ─── Folders — write ──────────────────────────────────────────────────────────

export const insertFolder = async ({ name, parent_id, userId, company_ids, business_unit }) => {
  const { rows } = await getPool().query(
    `INSERT INTO v4.sharepoint_folders
       (name, parent_id, created_by, company_ids, business_unit)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name.trim(), parent_id || null, userId, JSON.stringify(company_ids || []), business_unit],
  );
  return rows[0];
};

/**
 * Dynamically update a folder's name and/or company_ids.
 * `fields` = { name?, company_ids? }
 */
export const updateFolder = async (id, businessUnit, fields) => {
  const sets = [];
  const params = [];
  let idx = 1;

  if (fields.name?.trim()) {
    sets.push(`name = $${idx++}`);
    params.push(fields.name.trim());
  }
  if (fields.company_ids !== undefined) {
    sets.push(`company_ids = $${idx++}`);
    params.push(JSON.stringify(fields.company_ids));
  }
  sets.push(`updated_at = NOW()`);
  params.push(id, businessUnit);

  const { rows } = await getPool().query(
    `UPDATE v4.sharepoint_folders
     SET ${sets.join(", ")}
     WHERE id = $${idx++} AND business_unit = $${idx}
     RETURNING *`,
    params,
  );
  return rows[0] ?? null;
};

// ─── Folder — recursive delete helpers ───────────────────────────────────────

/** Collects all descendant folder IDs (including the root) via recursive CTE. */
export const findDescendantFolderIds = async (id, businessUnit, client) => {
  const { rows } = await db(client).query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM v4.sharepoint_folders
       WHERE id = $1 AND business_unit = $2
       UNION ALL
       SELECT f.id FROM v4.sharepoint_folders f
       JOIN tree t ON f.parent_id = t.id
     )
     SELECT id FROM tree`,
    [id, businessUnit],
  );
  return rows.map((r) => r.id);
};

export const findFileKeysByFolderIds = async (folderIds, client) => {
  const { rows } = await db(client).query(
    `SELECT s3_key FROM v4.sharepoint_files WHERE folder_id = ANY($1::uuid[])`,
    [folderIds],
  );
  return rows;
};

export const deleteFilesByFolderIds = async (folderIds, client) => {
  await db(client).query(
    `DELETE FROM v4.sharepoint_files WHERE folder_id = ANY($1::uuid[])`,
    [folderIds],
  );
};

export const deleteFoldersByIds = async (folderIds, client) => {
  await db(client).query(
    `DELETE FROM v4.sharepoint_folders WHERE id = ANY($1::uuid[])`,
    [folderIds],
  );
};

// ─── Files ────────────────────────────────────────────────────────────────────

export const insertFile = async ({
  folder_id, display_name, s3_key, s3_bucket,
  file_type, file_size, userId, business_unit,
}) => {
  const { rows } = await getPool().query(
    `INSERT INTO v4.sharepoint_files
       (folder_id, display_name, s3_key, s3_bucket, file_type, file_size, uploaded_by, business_unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [folder_id, display_name, s3_key, s3_bucket, file_type, file_size, userId, business_unit],
  );
  return rows[0];
};

/** Fetch a file while verifying the parent folder belongs to the given BU. */
export const findFileWithFolderBU = async (id, businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT f.s3_key, f.s3_bucket
     FROM v4.sharepoint_files f
     JOIN v4.sharepoint_folders fld ON f.folder_id = fld.id
     WHERE f.id = $1 AND fld.business_unit = $2`,
    [id, businessUnit],
  );
  return rows[0] ?? null;
};

/** Update a file's display_name, verifying business_unit via the parent folder. */
export const updateFileDisplayName = async (id, displayName, businessUnit) => {
  const { rows } = await getPool().query(
    `UPDATE v4.sharepoint_files f
     SET display_name = $1, updated_at = NOW()
     FROM v4.sharepoint_folders fld
     WHERE f.id = $2
       AND f.folder_id = fld.id
       AND fld.business_unit = $3
     RETURNING f.*`,
    [displayName.trim(), id, businessUnit],
  );
  return rows[0] ?? null;
};

export const deleteFileById = async (id, client) => {
  await db(client).query(
    `DELETE FROM v4.sharepoint_files WHERE id = $1`,
    [id],
  );
};

// ─── Storage Quota ────────────────────────────────────────────────────────────

/**
 * Returns the total used storage (sum of file_size) and the BU's max quota.
 * Uses COALESCE so a BU with no files still returns used_storage = 0.
 */
export const getStorageQuota = async (businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT
       COALESCE(SUM(f.file_size), 0)::bigint AS used_storage,
       b.max_storage_size_bytes
     FROM v4.business_unit_tbl b
     LEFT JOIN v4.sharepoint_files f ON f.business_unit = b.bu_code
     WHERE b.bu_code = $1
     GROUP BY b.max_storage_size_bytes`,
    [businessUnit],
  );
  return rows[0] ?? null;
};

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

export const findBreadcrumb = async (folderId, businessUnit) => {
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
    [folderId, businessUnit],
  );
  return rows;
};
