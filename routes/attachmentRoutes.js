import express from "express";
const router = express.Router();

// 1. Convert require to imports with .js extensions
import * as attachmentController from "../controller/attachmentController.js";
import auth from "../middleware/auth.js";

// 1. Get the Signed URL (Now protected)
router.post("/generate-url", auth, async (req, res) => {
  try {
    const { fileName, fileType, folder } = req.body; // 'announcements' or 'profiles'
    const data = await attachmentController.getPresignedUrl(
      fileName,
      fileType,
      folder,
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Confirm the upload
router.post("/confirm", auth, attachmentController.createAttachment);

// 3. View
router.get("/view/:id", auth, attachmentController.getViewingUrl);

// 4. Delete
router.delete("/:id", auth, attachmentController.deleteAttachment);

// 5. Delete Profile Pic
router.delete("/profile/:userId", auth, deleteProfilePicture);

// 6. Change module.exports to export default
export default router;
