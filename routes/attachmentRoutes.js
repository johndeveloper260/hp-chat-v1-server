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

// 2. Confirm the upload (Now protected)
router.post("/confirm", auth, async (req, res) => {
  try {
    // Ensure the user has permission to attach files to this specific relation_id
    const result = await attachmentController.createAttachment(req.body);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", attachmentController.deleteAttachment);

module.exports = router;
