/**
 * App Support Controller
 *
 * Thin HTTP adapters — parse req → call service → send res → next(err).
 * All business logic lives in services/appSupportService.js.
 */
import * as appSupportService from "../services/appSupportService.js";
import env from "../config/env.js";

/** Officers and admins see all BU tickets and can manage workflow fields. */
const isSupportUser = (req) => {
  const type = (req.user.userType || "").toUpperCase();
  return type === "OFFICER" || type === "ADMIN";
};

/** Cross-BU access — user whose UUID matches PLATFORM_ADMIN_ID env var. */
const isPlatformAdmin = (req) =>
  !!env.appSupport.platformAdminId &&
  String(req.user.id) === String(env.appSupport.platformAdminId);

// ─── 1. Search ────────────────────────────────────────────────────────────────

export const searchTickets = async (req, res, next) => {
  try {
    const { business_unit: businessUnit, id: userId } = req.user;
    const rows = await appSupportService.searchTickets({
      query: req.query,
      userId,
      businessUnit,
      isSupportUser: isSupportUser(req),
      isPlatformAdmin: isPlatformAdmin(req),
    });
    res.json(rows);
  } catch (err) {
    console.error("[AppSupport search error]", err.message, err.detail ?? "");
    next(err);
  }
};

// ─── 2. Get single ticket ─────────────────────────────────────────────────────

export const getTicket = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { business_unit: userBU, id: userId } = req.user;
    const ticket = await appSupportService.getTicket({
      ticketId,
      businessUnit: isPlatformAdmin(req) ? null : userBU,
    });

    // Regular users may only view their own tickets
    if (!isSupportUser(req) && !isPlatformAdmin(req) && String(ticket.created_by) !== String(userId)) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json(ticket);
  } catch (err) {
    next(err);
  }
};

// ─── 3. Create ────────────────────────────────────────────────────────────────

export const createTicket = async (req, res, next) => {
  try {
    const { id: userId, business_unit: userBU } = req.user;
    const ticket = await appSupportService.createTicket({ body: req.body, userId, userBU });
    res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
};

// ─── 4. Update ────────────────────────────────────────────────────────────────

export const updateTicket = async (req, res, next) => {
  try {
    if (!isPlatformAdmin(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { ticketId } = req.params;
    const { id: userId } = req.user;
    const updated = await appSupportService.updateTicket({
      ticketId, body: req.body, userId, userBU: null,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// ─── 5. Delete ────────────────────────────────────────────────────────────────

export const deleteTicket = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { id: userId, business_unit: userBU } = req.user;

    if (!isSupportUser(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await appSupportService.deleteTicket({ ticketId, userBU });
    res.json({ success: true, message: "Support ticket and all related data deleted." });
  } catch (err) {
    next(err);
  }
};

// ─── 6. Support agents ────────────────────────────────────────────────────────

export const getSupportAgents = async (req, res, next) => {
  try {
    const { business_unit: businessUnit } = req.user;
    const agents = await appSupportService.getSupportAgents({ businessUnit });
    res.json(agents);
  } catch (err) {
    next(err);
  }
};
