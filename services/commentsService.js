/**
 * Comments Service
 *
 * Business logic for shared_comments (inquiries and announcements).
 * Resolves the cross-controller dependency on notificationController by
 * importing directly from notificationService.
 */
import * as commentsRepo from "../repositories/commentsRepository.js";
import { createNotification } from "./notificationService.js";
import { ForbiddenError, NotFoundError } from "../errors/AppError.js";

const ELEVATED_ROLES = ["OFFICER", "ADMIN"];

// ── Guard helper ──────────────────────────────────────────────────────────────

/**
 * Verify that the parent record belongs to the requestor's business_unit.
 * Throws NotFoundError when the check fails.
 */
const assertParentBU = async (relationType, relationId, businessUnit) => {
  let ok = true;
  if (relationType === "inquiries") {
    ok = await commentsRepo.checkInquiryBU(relationId, businessUnit);
  } else if (relationType === "announcements") {
    ok = await commentsRepo.checkAnnouncementBU(relationId, businessUnit);
  }
  if (!ok) throw new NotFoundError("record_not_found");
};

// ── Fetch ──────────────────────────────────────────────────────────────────────

export const getComments = async (type, id, userBU) => {
  await assertParentBU(type, id, userBU);
  return commentsRepo.findComments(type, id);
};

// ── Add ────────────────────────────────────────────────────────────────────────

export const addComment = async (body, userId, userBU) => {
  const {
    relation_type,
    relation_id,
    content_text,
    parent_comment_id,
    metadata,
  } = body;

  await assertParentBU(relation_type, relation_id, userBU);

  // 1. Insert the comment
  const newComment = await commentsRepo.insertComment({
    relation_type,
    relation_id,
    user_id: userId,
    content_text,
    parent_comment_id,
    metadata,
    businessUnit: userBU,
  });

  // 2. Commenter name (for notification body)
  const commenterName = await commentsRepo.findCommenterName(userId);

  // 3. Resolve notification recipients
  let rawRecipients = [];
  if (relation_type === "inquiries") {
    rawRecipients = await commentsRepo.findInquiryRecipients(relation_id, userId);
  } else if (relation_type === "announcements") {
    rawRecipients = await commentsRepo.findAnnouncementRecipients(relation_id, userId);
  }

  const recipients = [...new Set(rawRecipients)].filter(
    (id) => id && String(id) !== String(userId),
  );

  // 4. Fan-out notifications
  if (recipients.length > 0) {
    const titleKey =
      relation_type === "inquiries"
        ? "comment_on_inquiry"
        : "comment_on_announcement";

    const commentPreview =
      content_text.length > 50
        ? `${content_text.substring(0, 50)}...`
        : content_text;

    await Promise.all(
      recipients.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey,
          bodyKey:    "comment_body",
          bodyParams: { name: commenterName, comment: commentPreview },
          data: {
            type:   relation_type,
            rowId:  relation_id,
            screen: relation_type === "inquiries" ? "Inquiry" : "Home",
            params:
              relation_type === "inquiries"
                ? { ticketId: relation_id }
                : { rowId: relation_id },
          },
        }),
      ),
    );
  }

  return newComment;
};

// ── Edit ───────────────────────────────────────────────────────────────────────

export const editComment = async (commentId, content_text, userId, userBU) => {
  const exists = await commentsRepo.checkCommentExists(commentId);
  if (!exists) throw new NotFoundError("comment_not_found");

  const { row, updated } = await commentsRepo.updateComment(
    commentId,
    userId,
    userBU,
    content_text,
  );
  if (!updated) throw new ForbiddenError();
  return row;
};

// ── Delete ─────────────────────────────────────────────────────────────────────

export const deleteComment = async (commentId, userId, userBU, userRole) => {
  // First, locate the comment and verify parent BU
  const relation = await commentsRepo.findCommentRelation(commentId);
  if (!relation) throw new NotFoundError("comment_not_found");

  await assertParentBU(relation.relation_type, relation.relation_id, userBU);

  const isElevated = ELEVATED_ROLES.includes(
    (userRole || "").toUpperCase(),
  );

  const deleted = isElevated
    ? await commentsRepo.deleteCommentAsOfficer(commentId)
    : await commentsRepo.deleteCommentAsOwner(commentId, userId);

  if (deleted === 0) throw new ForbiddenError();
};
