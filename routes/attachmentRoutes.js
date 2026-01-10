const express = require("express");
const router = express.Router();
const attachmentController = require("../controller/attachmentController");
const auth = require("../middleware/auth");

// Apply protection to all attachment routes
router.use(auth);

// 1. Get the Signed URL (Now protected)
router.post("/generate-url", async (req, res) => {
  try {
    // You can now access req.user.id to ensure the user is allowed to upload
    const { fileName, fileType } = req.body;
    const data = await attachmentController.getPresignedUrl(fileName, fileType);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Confirm the upload (Now protected)
router.post("/confirm", async (req, res) => {
  try {
    // Ensure the user has permission to attach files to this specific relation_id
    const result = await attachmentController.createAttachment(req.body);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
