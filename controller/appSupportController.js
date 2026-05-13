/**
 * App Support Controller
 *
 * Thin HTTP adapters — parse req → call service → send res → next(err).
 * All business logic lives in services/appSupportService.js.
 */
import * as appSupportService from "../services/appSupportService.js";

/**
 * Returns true when the requesting user may manage any ticket in their BU
 * (ADMIN, full-access OFFICER, or OFFICER with app_support_write/admin role).
 */
const isSupportUser = (req) => {
  const type  = (req.user.userType || "").toUpperCase();
  const roles = req.user.roles ?? [];
  if (type === "ADMIN") return true;
  if (type !== "OFFICER") return false;
  if (roles.length === 0) return true; // full-access backward compat
  return roles.includes("app_support_write") || roles.includes("app_support_admin");
};

// ─── 1. Search ────────────────────────────────────────────────────────────────

export const searchTickets = async (req, res, next) => {
  try {
    const { business_unit: businessUnit, id: userId } = req.user;
    const rows = await appSupportService.searchTickets({
      query: req.query,
      userId,
      businessUnit,
      isSupportUser: isSupportUser(req),
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

// ─── 2. Get single ticket ─────────────────────────────────────────────────────

export const getTicket = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { business_unit: userBU, id: userId } = req.user;
    const ticket = await appSupportService.getTicket({ ticketId, businessUnit: userBU });

    // Non-support users may only view their own tickets
    if (!isSupportUser(req) && String(ticket.created_by) !== String(userId)) {
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
    const { ticketId } = req.params;
    const { id: userId, business_unit: userBU } = req.user;
    const updated = await appSupportService.updateTicket({
      ticketId, body: req.body, userId, userBU, isSupportUser: isSupportUser(req),
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
    const type  = (req.user.userType || "").toUpperCase();
    const roles = req.user.roles ?? [];

    // Only ADMIN, full-access OFFICER, or app_support_admin may delete
    const canDelete =
      type === "ADMIN" ||
      (type === "OFFICER" && roles.length === 0) ||
      roles.includes("app_support_admin");

    if (!canDelete) {
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
