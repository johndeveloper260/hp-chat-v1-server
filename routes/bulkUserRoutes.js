/**
 * Bulk User Routes
 *
 * Requires the upload_user_data_write role for all endpoints.
 */
import express    from "express";
import multer     from "multer";
import auth       from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  exportUsers,
  importUsers,
  getReferenceCodes,
  getUploadHistory,
  getUploadHistoryDetail,
} from "../controller/bulkUserController.js";

const router = express.Router();

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only .csv files are accepted"));
    }
  },
});

router.get("/export",         auth, requireRole("upload_user_data_write"), exportUsers);
router.post("/import",        auth, requireRole("upload_user_data_write"), upload.single("file"), importUsers);
router.get("/reference-codes",auth, requireRole("upload_user_data_write"), getReferenceCodes);
router.get("/history",        auth, requireRole("upload_user_data_write"), getUploadHistory);
router.get("/history/:id",    auth, requireRole("upload_user_data_write"), getUploadHistoryDetail);

export default router;
