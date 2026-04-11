/**
 * Bulk User Controller
 *
 * Thin HTTP adapter: parse request → call service → send response.
 * No business logic. All errors propagate via next(err).
 */
import * as bulkUserService from "../services/bulkUserService.js";

// ── GET /bulk-users/export ─────────────────────────────────────────────────────

export const exportUsers = async (req, res, next) => {
  try {
    const { country, sending_org, company, batch_no, lang } = req.query;
    const toArr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const filters = {
      ...(country && toArr(country).length && { country: toArr(country) }),
      ...(sending_org && { sending_org }),
      ...(company && toArr(company).length && { company: toArr(company) }),
      ...(batch_no    && { batch_no }),
    };

    const csv      = await bulkUserService.exportUsersCsv(req.user.business_unit, filters, lang ?? "en");
    const today    = new Date().toISOString().slice(0, 10);
    const filename = `users_export_${today}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
};

// ── POST /bulk-users/import ────────────────────────────────────────────────────

export const importUsers = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Send a CSV as multipart field 'file'." });
    }

    // Returns immediately with logId — actual processing runs in the background.
    const { logId } = await bulkUserService.startImportJob(
      req.file.buffer,
      req.user.business_unit,
      req.user.id,
      req.file.originalname,
    );

    res.status(202).json({ logId });
  } catch (err) {
    next(err);
  }
};

// ── GET /bulk-users/reference-codes ───────────────────────────────────────────

export const getReferenceCodes = async (req, res, next) => {
  try {
    const data = await bulkUserService.getReferenceCodes(req.user.business_unit);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

// ── GET /bulk-users/history ────────────────────────────────────────────────────

export const getUploadHistory = async (req, res, next) => {
  try {
    const data = await bulkUserService.getUploadHistory(req.user.business_unit);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

// ── GET /bulk-users/history/:id ────────────────────────────────────────────────

export const getUploadHistoryDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = await bulkUserService.getUploadHistoryDetail(id, req.user.business_unit);
    res.json(data);
  } catch (err) {
    next(err);
  }
};
