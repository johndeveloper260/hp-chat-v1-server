/**
 * Inquiry Controller
 *
 * Thin HTTP adapters — parse req → call service → send res → next(err).
 * All business logic lives in services/inquiryService.js.
 *
 * Cross-controller dependencies resolved:
 *   createNotification  → notificationService  (via inquiryService)
 *   deleteFromS3        → utils/s3Client        (via inquiryService)
 */
import * as inquiryService from "../services/inquiryService.js";

// ─── 1. Search ────────────────────────────────────────────────────────────────

export const searchInquiries = async (req, res, next) => {
  try {
    const { business_unit: businessUnit, id: userId, userType } = req.user;
    const userRole = userType?.toUpperCase() || "";

    const rows = await inquiryService.searchInquiries({
      query: req.query,
      userId,
      businessUnit,
      userRole,
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

// ─── 2. Create ────────────────────────────────────────────────────────────────

export const createInquiry = async (req, res, next) => {
  try {
    const { id: userId, business_unit: userBU } = req.user;
    const inquiry = await inquiryService.createInquiry({ body: req.body, userId, userBU });
    res.status(201).json(inquiry);
  } catch (err) {
    next(err);
  }
};

// ─── 3. Update ────────────────────────────────────────────────────────────────

export const updateInquiry = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { id: userId, business_unit: userBU } = req.user;
    const updated = await inquiryService.updateInquiry({ ticketId, body: req.body, userId, userBU });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// ─── 4. Delete ────────────────────────────────────────────────────────────────

export const deleteInquiry = async (req, res, next) => {
  try {
    await inquiryService.deleteInquiry({
      ticketId: req.params.ticketId,
      userBU:   req.user.business_unit,
    });
    res.json({ success: true, message: "Inquiry and all related data deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// ─── 5. Issue types ───────────────────────────────────────────────────────────

export const getIssues = async (req, res, next) => {
  try {
    const rows = await inquiryService.getIssues({
      userId:       req.user.id,
      businessUnit: req.user.business_unit,
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

// ─── 6. Officers by BU ────────────────────────────────────────────────────────

export const getOfficersByBU = async (req, res, next) => {
  try {
    const { business_unit: businessUnit } = req.user;
    if (!businessUnit) {
      return res.status(400).json({ error: "Business Unit missing from user token" });
    }
    const rows = await inquiryService.getOfficersByBU({ businessUnit });
    res.status(200).json(rows || []);
  } catch (err) {
    next(err);
  }
};
