/**
 * App Support Service
 *
 * Business logic for v4.app_support_ticket_tbl.
 * Separate from the Inquiry module — uses its own table, routes, and permissions.
 */
import { getPool }            from "../config/getPool.js";
import { deleteFromS3 }       from "../utils/s3Client.js";
import { createNotification } from "./notificationService.js";
import * as repo              from "../repositories/appSupportRepository.js";
import { NotFoundError, ValidationError } from "../errors/AppError.js";

// ─── 1. Search ────────────────────────────────────────────────────────────────

export const searchTickets = async ({ query: filters, userId, businessUnit, isSupportUser, isPlatformAdmin }) => {
  return repo.searchTickets({ businessUnit, userId, isSupportUser, isPlatformAdmin, filters });
};

// ─── 2. Get single ────────────────────────────────────────────────────────────

export const getTicket = async ({ ticketId, businessUnit }) => {
  const { row } = await repo.findTicketById(ticketId, businessUnit ?? null);
  if (!row) throw new NotFoundError("record_not_found");
  return row;
};

// ─── 3. Create ────────────────────────────────────────────────────────────────

export const createTicket = async ({ body, userId, userBU }) => {
  const {
    title, description, category, severity,
    source_page, browser_info, app_version, company_id,
  } = body;

  const ticket = await repo.insertTicket({
    businessUnit: userBU, userId,
    title, description, category, severity,
    source_page, browser_info, app_version, company_id,
  });

  // Notify support agents about the new ticket (URGENT/HIGH get priority)
  const agentIds = await repo.findSupportUsersForBU(userBU);
  const notifyIds = agentIds.filter((id) => String(id) !== String(userId));

  if (notifyIds.length > 0) {
    const creatorName = await repo.findUserName(userId);
    const titleKey = (severity === "URGENT" || severity === "HIGH")
      ? "app_support_created_urgent"
      : "app_support_created";

    await Promise.all(
      notifyIds.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey,
          bodyKey: "app_support_created_body",
          bodyParams: { name: creatorName, title },
          skipPush: true,
          data: {
            type:   "app_support",
            rowId:  ticket.ticket_id,
            screen: "AppSupport",
            params: { ticketId: ticket.ticket_id },
          },
        }),
      ),
    );
  }

  return ticket;
};

// ─── 4. Update ────────────────────────────────────────────────────────────────

export const updateTicket = async ({ ticketId, body, userId, userBU }) => {
  // userBU is null for platform admin (cross-BU lookup)
  const { row: oldTicket } = await repo.findTicketById(ticketId, userBU);
  if (!oldTicket) throw new NotFoundError("record_not_found");

  // Auto-set closed_at when closing
  let { closed_at } = body;
  if (body.status === "CLOSED" && !closed_at && oldTicket.status !== "CLOSED") {
    closed_at = new Date().toISOString();
  }
  // Clear closed_at when reopening
  if (body.status && body.status !== "CLOSED" && oldTicket.status === "CLOSED") {
    closed_at = null;
  }

  const updated = await repo.updateTicket({
    ticketId, businessUnit: userBU, userId,
    ...body,
    closed_at,
  });
  if (!updated) throw new NotFoundError("record_not_found");

  // Notifications
  const recipientsSet = new Set();
  // Notify creator when platform admin changes their ticket
  if (String(oldTicket.created_by) !== String(userId)) {
    recipientsSet.add(oldTicket.created_by);
  }
  // Notify new assignee
  if (body.assigned_to && String(body.assigned_to) !== String(userId)) {
    recipientsSet.add(body.assigned_to);
  }

  const recipients = Array.from(recipientsSet).filter(Boolean);
  if (recipients.length > 0) {
    const updaterName = await repo.findUserName(userId);
    let titleKey = "app_support_updated";
    let bodyKey  = "updated_inquiry"; // reuse existing translation key

    if (body.status && body.status !== oldTicket.status) {
      titleKey = "app_support_status_changed";
      bodyKey  = "changed_status_to";
    } else if (body.assigned_to && body.assigned_to !== oldTicket.assigned_to) {
      titleKey = "app_support_assigned";
      bodyKey  = "assigned_to_you";
    }

    await Promise.all(
      recipients.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey,
          bodyKey,
          bodyParams: { name: updaterName, title: updated.title, status: body.status },
          skipPush: true,
          data: {
            type:   "app_support",
            rowId:  ticketId,
            screen: "AppSupport",
            params: { ticketId },
          },
        }),
      ),
    );
  }

  return updated;
};

// ─── 5. Delete ────────────────────────────────────────────────────────────────

export const deleteTicket = async ({ ticketId, userBU }) => {
  const id = parseInt(ticketId, 10);
  if (isNaN(id)) throw new ValidationError("invalid_ticket_id");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const { rowCount } = await repo.findTicketById(id, userBU, client);
    if (rowCount === 0) {
      await client.query("ROLLBACK");
      throw new NotFoundError("record_not_found");
    }

    const attachKeys = await repo.findTicketAttachmentKeys(id, userBU, client);
    for (const { s3_key } of attachKeys) {
      await deleteFromS3(s3_key);
    }

    await repo.cascadeDeleteTicket(id, userBU, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── 6. Support agents lookup ─────────────────────────────────────────────────

export const getSupportAgents = async ({ businessUnit }) => {
  return repo.findSupportAgents(businessUnit);
};
