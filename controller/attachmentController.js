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
 * 3. Delete Physical File from S3
 */
export const deleteFromS3 = async (s3Key) => {
  const command = new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: s3Key,
  });
  return await s3Client.send(command);
};
