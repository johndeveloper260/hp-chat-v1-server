import "dotenv/config";
import { getPool } from "../config/getPool.js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// Initialize S3 Client
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
 * Helper: Delete physical file from S3 bucket
 */
export const deleteFromS3 = async (s3Key) => {
  const command = new DeleteObjectCommand({
    Bucket: process.env.REACT_APP_AWS_BUCKET,
    Key: s3Key,
  });

  try {
    await s3Client.send(command);
    console.log(`Successfully deleted ${s3Key} from S3`);
  } catch (err) {
    console.error("S3 Deletion Error:", err);
    // We throw the error so the controller doesn't delete the DB record if S3 fails
    throw new Error("Failed to delete file from S3 storage.");
  }
};

/**
 * 1. Generate Pre-signed URL
 */
export const getPresignedUrl = async (
  fileName,
  fileType,
  folder = "general",
) => {
  try {
    const dateFolder = new Date().toISOString().split("T")[0];
    const s3Key = `${folder}/${dateFolder}/${Date.now()}-${fileName.replace(
      /\s/g,
      "_",
    )}`;

    const command = new PutObjectCommand({
      Bucket: process.env.REACT_APP_AWS_BUCKET,
      Key: s3Key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    return { uploadUrl, s3Key, bucketName: process.env.REACT_APP_AWS_BUCKET };
  } catch (error) {
    console.error("S3 SDK ERROR:", error);
    throw error;
  }
};

/**
 * 2. Create DB Record (Confirmation)
 * CORRECTED: Accepts (req, res) to work as a Route Handler
 */
export const createAttachment = async (req, res) => {
  try {
    // Extract from req.body, NOT directly from arguments
    const {
      relation_type,
      relation_id,
      s3_key,
      s3_bucket,
      display_name,
      file_type,
    } = req.body;

    // Safety Check
    if (!relation_id) {
      return res.status(400).json({ error: "Missing relation_id" });
    }

    const query = `
      INSERT INTO v4.shared_attachments 
      (relation_type, relation_id, s3_key, s3_bucket, display_name, file_type)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    const values = [
      relation_type,
      relation_id.toString(),
      s3_key,
      s3_bucket,
      display_name,
      file_type,
    ];

    const result = await getPool().query(query, values);

    // Return the created row to the frontend
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Create Attachment Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Generate a temporary viewing URL for a private file
 */
export const getViewingUrl = async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await getPool().query(
      "SELECT s3_key, s3_bucket FROM v4.shared_attachments WHERE attachment_id = $1",
      [id],
    );

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    // 1. Create Command
    const command = new GetObjectCommand({
      Bucket: rows[0].s3_bucket,
      Key: rows[0].s3_key,
      ChecksumMode: undefined, // Explicitly attempt to clear it
    });

    // 2. Generate Clean URL using signableHeaders
    // This forces the SDK to ignore complex checksum headers in the signature
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
      signableHeaders: new Set(["host"]),
    });

    // 3. Return as a JSON object
    res.json({ url: signedUrl });
  } catch (error) {
    console.error("Signing Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Unified Delete: Removes from S3 first, then Postgres
 */
export const deleteAttachment = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Get the s3_key from DB first
    console.log("inside the cont");
    console.log(id);

    const findQuery = `SELECT s3_key FROM v4.shared_attachments WHERE attachment_id = $1`;
    const { rows } = await getPool().query(findQuery, [id]);

    console.log(rows);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    const s3Key = rows[0].s3_key;

    console.log("delete from S3");
    console.log(s3Key);

    // 2. Delete from S3 using our new helper
    await deleteFromS3(s3Key);

    // 3. Delete from Postgres
    await getPool().query(
      `DELETE FROM v4.shared_attachments WHERE attachment_id = $1`,
      [id],
    );

    res.json({ message: "Attachment deleted successfully from S3 and DB" });
  } catch (error) {
    console.error("Delete Route Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Delete profile picture by user ID
 * Finds and deletes the existing profile picture for a specific user
 */
export const deleteProfilePicture = async (req, res) => {
  const { userId } = req.params;

  try {
    // 1. Find the existing profile picture for this user
    const findQuery = `
      SELECT attachment_id, s3_key 
      FROM v4.shared_attachments 
      WHERE relation_type = 'profile' 
      AND relation_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const { rows } = await getPool().query(findQuery, [userId.toString()]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "No profile picture found" });
    }

    const { attachment_id, s3_key } = rows[0];

    // 2. Delete from S3
    await deleteFromS3(s3_key);

    // 3. Delete from database
    await getPool().query(
      `DELETE FROM v4.shared_attachments WHERE attachment_id = $1`,
      [attachment_id],
    );

    res.json({
      message: "Profile picture deleted successfully",
      attachment_id,
    });
  } catch (error) {
    console.error("Delete Profile Picture Error:", error);
    res.status(500).json({ error: error.message });
  }
};
