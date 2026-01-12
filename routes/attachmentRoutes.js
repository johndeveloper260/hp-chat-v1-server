const express = require("express");
const router = express.Router();
const attachmentController = require("../controller/attachmentController");
const auth = require("../middleware/auth");

// 1. Get the Signed URL (Now protected)
router.post("/generate-url", auth, async (req, res) => {
  try {
    const { fileName, fileType, folder } = req.body; // 'announcements' or 'profiles'
    const data = await attachmentController.getPresignedUrl(
      fileName,
      fileType,
      folder
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

module.exports = router;
