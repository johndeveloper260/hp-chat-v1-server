import "dotenv/config";
import { getPool } from "../config/getPool.js";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Initialize S3 Client
const s3Client = new S3Client({
  region: process.env.REACT_APP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * 1. Generate Pre-signed URL
 */
export const getPresignedUrl = async (
  fileName,
  fileType,
  folder = "general"
) => {
  try {
    console.log("Generating URL for:", { fileName, fileType, folder }); // Debug log

    const dateFolder = new Date().toISOString().split("T")[0];
    const s3Key = `${folder}/${dateFolder}/${Date.now()}-${fileName.replace(
      /\s/g,
      "_"
    )}`;

    const command = new PutObjectCommand({
      Bucket: process.env.REACT_APP_AWS_BUCKET,
      Key: s3Key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    return { uploadUrl, s3Key, bucketName: process.env.REACT_APP_AWS_BUCKET };
  } catch (error) {
    console.error("S3 SDK ERROR:", error); // This will tell you if it's a credential issue
    throw error;
  }
};

/**
 * 2. Create DB Record (Confirmation)
 */
export const createAttachment = async (data) => {
  const {
    relation_type,
    relation_id,
    s3_key,
    s3_bucket,
    display_name,
    file_type,
  } = data;

  // Log to debug if relation_id is null/undefined during Step 4
  console.log("Confirming for ID:", relation_id);

  const query = `
    INSERT INTO v4.shared_attachments 
    (relation_type, relation_id, s3_key, s3_bucket, display_name, file_type)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;

  const values = [
    relation_type,
    relation_id.toString(), // Ensure this is not [object Object]
    s3_key,
    s3_bucket,
    display_name,
    file_type,
  ];

  const result = await getPool().query(query, values);
  return result.rows[0];
};

/**
 * Unified Delete: Removes from S3 first, then Postgres
 */
export const deleteAttachment = async (req, res) => {
  const { id } = req.params; // attachment_id (row_id)

  try {
    // 1. Get the s3_key from DB first
    const findQuery = `SELECT s3_key FROM v4.shared_attachments WHERE row_id = $1`;
    const { rows } = await getPool().query(findQuery, [id]);

    if (rows.length > 0) {
      const s3Key = rows[0].s3_key;

      // 2. Delete from S3
      await deleteFromS3(s3Key);

      // 3. Delete from Postgres
      await getPool().query(
        `DELETE FROM v4.shared_attachments WHERE row_id = $1`,
        [id]
      );
    }

    res.json({ message: "Attachment deleted successfully" });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ error: error.message });
  }
};
