import express from "express";
const router = express.Router();

import * as attachmentController from "../controller/attachmentController.js";
import auth from "../middleware/auth.js";

// 1. Get the Signed URL for Upload
// Expects: { fileName, fileType, relationType, relationId }
// business_unit is pulled from the authenticated user's JWT
router.post("/generate-url", auth, async (req, res) => {
  try {
    const { fileName, fileType, relationType, relationId } = req.body;
    const businessUnit = req.user.business_unit;

    if (!relationType || !relationId) {
      return res
        .status(400)
        .json({ error: "relationType and relationId are required" });
    }

    const data = await attachmentController.getPresignedUrl(
      fileName,
      fileType,
      businessUnit,
      relationType,
      relationId,
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Confirm the upload (saves to DB, syncs profile pics to Stream)
router.post("/confirm", auth, attachmentController.createAttachment);

// 3. View single attachment (generates signed viewing URL)
router.get("/view/:id", auth, attachmentController.getViewingUrl);

// 4. Get all attachments for a specific relation (e.g., all attachments on a feed post)
router.get(
  "/:relationType/:relationId",
  auth,
  attachmentController.getAttachmentsByRelation,
);

// 5. Delete single attachment (also removes from Stream if profile pic)
router.delete("/:id", auth, attachmentController.deleteAttachment);

// 6. Delete profile picture by user ID (specialized endpoint)
router.delete(
  "/profile/:userId",
  auth,
  attachmentController.deleteProfilePicture,
);

// 7. Batch delete all attachments for a relation (e.g., delete all attachments when deleting a post)
router.delete(
  "/relation/:relationType/:relationId",
  auth,
  attachmentController.deleteAttachmentsByRelation,
);

// PUT /attachments/{id}/rename
router.put("/:id/rename", auth, attachmentController.renameAttachment);

export default router;
