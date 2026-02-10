import { StreamChat } from "stream-chat";

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

// Initialize Stream Client
const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

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
    throw new Error("Failed to delete file from S3 storage.");
  }
};

/**
 * Helper: Sync profile picture with GetStream
 * Only called for profile picture uploads
 */
export const syncProfilePictureToStream = async (userId, s3Key, s3Bucket) => {
  try {
    // Generate signed URL for Stream (24 hours)
    const command = new GetObjectCommand({
      Bucket: s3Bucket,
      Key: s3Key,
    });

    const profileImageUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 86400, // 24 hours
      signableHeaders: new Set(["host"]),
    });

    // Update Stream user with profile picture
    await streamClient.partialUpdateUser({
      id: userId.toString(),
      set: {
        image: profileImageUrl,
      },
    });

    console.log(`Profile picture synced to Stream for user ${userId}`);
    return profileImageUrl;
  } catch (error) {
    console.error("Error syncing profile picture to Stream:", error);
    throw error;
  }
};

/**
 * 1. Generate Pre-signed URL for Upload
 * Used by: Profile pictures, Feed attachments, Inquiry attachments
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
 * 2. Create DB Record (Confirmation) with Conditional Stream Sync
 * Used by: Profile pictures, Feed attachments, Inquiry attachments
 * Only syncs to Stream for profile pictures (relation_type = 'profile')
 */
export const createAttachment = async (req, res) => {
  try {
    const {
      relation_type,
      relation_id,
      s3_key,
      s3_bucket,
      display_name,
      file_type,
    } = req.body;
    const userBU = req.user.business_unit;

    // Safety Check
    if (!relation_id) {
      return res.status(400).json({ error: "Missing relation_id" });
    }

    // Pre-query: verify the parent record belongs to the requestor's business_unit
    if (relation_type === "inquiries") {
      const check = await getPool().query(
        "SELECT ticket_id FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(404).json({ error: "Record not found" });
    } else if (relation_type === "announcements") {
      const check = await getPool().query(
        "SELECT row_id FROM v4.announcement_tbl WHERE row_id = $1 AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(404).json({ error: "Record not found" });
    } else if (relation_type === "profile") {
      // For profile attachments, verify the target user belongs to same BU
      const check = await getPool().query(
        "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(404).json({ error: "User not found" });
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

    // ONLY sync to GetStream if this is a profile picture
    if (relation_type === "profile") {
      try {
        await syncProfilePictureToStream(relation_id, s3_key, s3_bucket);
        console.log("Profile picture successfully synced to GetStream");
      } catch (streamError) {
        console.error("Stream sync failed but attachment saved:", streamError);
        // Don't fail the request if Stream sync fails
      }
    }

    // Return the created row to the frontend
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Create Attachment Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * 3. Generate a temporary viewing URL for a private file
 * Used by: All attachment types (profile, feed, inquiry)
 */
export const getViewingUrl = async (req, res) => {
  const { id } = req.params;
  const userBU = req.user.business_unit;

  try {
    // Fetch attachment and verify parent record's BU
    const { rows } = await getPool().query(
      "SELECT s3_key, s3_bucket, relation_type, relation_id FROM v4.shared_attachments WHERE attachment_id = $1",
      [id],
    );

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    const { relation_type, relation_id } = rows[0];
    if (relation_type === "inquiries") {
      const check = await getPool().query(
        "SELECT ticket_id FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    } else if (relation_type === "announcements") {
      const check = await getPool().query(
        "SELECT row_id FROM v4.announcement_tbl WHERE row_id = $1 AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    } else if (relation_type === "profile") {
      const check = await getPool().query(
        "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    }

    // Create Command
    const command = new GetObjectCommand({
      Bucket: rows[0].s3_bucket,
      Key: rows[0].s3_key,
      ChecksumMode: undefined,
    });

    // Generate Clean URL using signableHeaders
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour for viewing
      signableHeaders: new Set(["host"]),
    });

    // Return as a JSON object
    res.json({ url: signedUrl });
  } catch (error) {
    console.error("Signing Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * 4. Get all attachments for a specific relation
 * Used by: Feed posts, Inquiry threads to fetch multiple attachments
 */
export const getAttachmentsByRelation = async (req, res) => {
  const { relationType, relationId } = req.params;
  const userBU = req.user.business_unit;

  try {
    // Pre-query: verify the parent record belongs to the requestor's business_unit
    if (relationType === "inquiries") {
      const check = await getPool().query(
        "SELECT ticket_id FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
        [relationId, userBU],
      );
      if (check.rowCount === 0) return res.status(404).json({ error: "Record not found" });
    } else if (relationType === "announcements") {
      const check = await getPool().query(
        "SELECT row_id FROM v4.announcement_tbl WHERE row_id = $1 AND business_unit = $2",
        [relationId, userBU],
      );
      if (check.rowCount === 0) return res.status(404).json({ error: "Record not found" });
    } else if (relationType === "profile") {
      const check = await getPool().query(
        "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
        [relationId, userBU],
      );
      if (check.rowCount === 0) return res.status(404).json({ error: "User not found" });
    }

    const query = `
      SELECT
        attachment_id,
        relation_type,
        relation_id,
        s3_key,
        s3_bucket,
        display_name,
        file_type,
        file_size,
        created_at,
        updated_at
      FROM v4.shared_attachments
      WHERE relation_type = $1 AND relation_id = $2
      ORDER BY created_at DESC
    `;

    const { rows } = await getPool().query(query, [
      relationType,
      relationId.toString(),
    ]);

    res.json({ attachments: rows });
  } catch (error) {
    console.error("Get Attachments Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * 5. Unified Delete: Removes from S3 first, then Postgres
 * Used by: All attachment types (profile, feed, inquiry)
 */
export const deleteAttachment = async (req, res) => {
  const { id } = req.params;
  const userBU = req.user.business_unit;

  try {
    // Get the attachment details from DB first
    console.log("Deleting attachment with ID:", id);

    const findQuery = `
      SELECT s3_key, relation_type, relation_id
      FROM v4.shared_attachments
      WHERE attachment_id = $1
    `;
    const { rows } = await getPool().query(findQuery, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    const { s3_key, relation_type, relation_id } = rows[0];

    // Verify parent record belongs to requestor's business_unit
    if (relation_type === "inquiries") {
      const check = await getPool().query(
        "SELECT ticket_id FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    } else if (relation_type === "announcements") {
      const check = await getPool().query(
        "SELECT row_id FROM v4.announcement_tbl WHERE row_id = $1 AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    } else if (relation_type === "profile") {
      const check = await getPool().query(
        "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    }
    console.log("Deleting from S3:", s3_key);

    // Delete from S3
    await deleteFromS3(s3_key);

    // Delete from Postgres
    await getPool().query(
      `DELETE FROM v4.shared_attachments WHERE attachment_id = $1`,
      [id],
    );

    // If this was a profile picture, remove from Stream
    if (relation_type === "profile") {
      try {
        await streamClient.partialUpdateUser({
          id: relation_id.toString(),
          unset: ["image"],
        });
        console.log(
          `Profile picture removed from Stream for user ${relation_id}`,
        );
      } catch (streamError) {
        console.error("Stream sync failed during delete:", streamError);
        // Continue even if Stream sync fails
      }
    }

    res.json({ message: "Attachment deleted successfully from S3 and DB" });
  } catch (error) {
    console.error("Delete Route Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * 6. Delete profile picture by user ID with Stream Sync
 * Specialized endpoint for profile picture deletion
 */
export const deleteProfilePicture = async (req, res) => {
  const { userId } = req.params;
  const userBU = req.user.business_unit;

  try {
    // Verify the target user belongs to the requestor's business_unit
    const buCheck = await getPool().query(
      "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
      [userId, userBU],
    );
    if (buCheck.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    // Find the existing profile picture for this user
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

    // Delete from S3
    await deleteFromS3(s3_key);

    // Delete from database
    await getPool().query(
      `DELETE FROM v4.shared_attachments WHERE attachment_id = $1`,
      [attachment_id],
    );

    // Remove profile picture from Stream
    try {
      await streamClient.partialUpdateUser({
        id: userId.toString(),
        unset: ["image"],
      });
      console.log(`Profile picture removed from Stream for user ${userId}`);
    } catch (streamError) {
      console.error("Stream sync failed during delete:", streamError);
      // Continue even if Stream sync fails
    }

    res.json({
      message: "Profile picture deleted successfully",
      attachment_id,
    });
  } catch (error) {
    console.error("Delete Profile Picture Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * 7. Batch delete attachments for a relation
 * Used by: When deleting entire feed posts or inquiry threads
 */
export const deleteAttachmentsByRelation = async (req, res) => {
  const { relationType, relationId } = req.params;
  const userBU = req.user.business_unit;

  try {
    // Pre-query: verify the parent record belongs to the requestor's business_unit
    if (relationType === "inquiries") {
      const check = await getPool().query(
        "SELECT ticket_id FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
        [relationId, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    } else if (relationType === "announcements") {
      const check = await getPool().query(
        "SELECT row_id FROM v4.announcement_tbl WHERE row_id = $1 AND business_unit = $2",
        [relationId, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    } else if (relationType === "profile") {
      const check = await getPool().query(
        "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
        [relationId, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    }
    // Get all attachments for this relation
    const findQuery = `
      SELECT attachment_id, s3_key 
      FROM v4.shared_attachments 
      WHERE relation_type = $1 AND relation_id = $2
    `;
    const { rows } = await getPool().query(findQuery, [
      relationType,
      relationId.toString(),
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "No attachments found" });
    }

    // Delete all files from S3
    const deletePromises = rows.map((row) => deleteFromS3(row.s3_key));
    await Promise.all(deletePromises);

    // Delete all records from database
    await getPool().query(
      `DELETE FROM v4.shared_attachments WHERE relation_type = $1 AND relation_id = $2`,
      [relationType, relationId.toString()],
    );

    // If these were profile pictures, remove from Stream
    if (relationType === "profile") {
      try {
        await streamClient.partialUpdateUser({
          id: relationId.toString(),
          unset: ["image"],
        });
        console.log(
          `Profile pictures removed from Stream for user ${relationId}`,
        );
      } catch (streamError) {
        console.error("Stream sync failed during batch delete:", streamError);
      }
    }

    res.json({
      message: `Successfully deleted ${rows.length} attachment(s)`,
      count: rows.length,
    });
  } catch (error) {
    console.error("Batch Delete Error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const renameAttachment = async (req, res) => {
  const { id } = req.params;
  const { display_name } = req.body;
  const userBU = req.user.business_unit;

  // Basic validation
  if (!display_name || display_name.trim() === "") {
    return res.status(400).json({
      error: "Display name is required.",
    });
  }

  try {
    // Verify parent record belongs to requestor's business_unit
    const attachCheck = await getPool().query(
      "SELECT relation_type, relation_id FROM v4.shared_attachments WHERE attachment_id = $1",
      [id],
    );
    if (attachCheck.rowCount === 0) return res.status(404).json({ error: "Attachment not found." });

    const { relation_type, relation_id } = attachCheck.rows[0];
    if (relation_type === "inquiries") {
      const check = await getPool().query(
        "SELECT ticket_id FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    } else if (relation_type === "announcements") {
      const check = await getPool().query(
        "SELECT row_id FROM v4.announcement_tbl WHERE row_id = $1 AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    } else if (relation_type === "profile") {
      const check = await getPool().query(
        "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
        [relation_id, userBU],
      );
      if (check.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });
    }

    const query = `
      UPDATE v4.shared_attachments
      SET
        display_name = $1,
        updated_at = NOW()
      WHERE attachment_id = $2
      RETURNING *;
    `;

    const result = await getPool().query(query, [display_name.trim(), id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Attachment not found.",
      });
    }

    // Return the updated record
    return res.status(200).json({
      message: "Attachment renamed successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error renaming attachment:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
