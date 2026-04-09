/**
 * Chat Template Service
 *
 * Business logic for chat message templates.
 * No req/res — throws AppError subclasses on failure.
 */
import * as repo from "../repositories/chatTemplateRepository.js";
import { NotFoundError } from "../errors/AppError.js";

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/** Active templates for the chat sidebar (all authenticated users). */
export const getActiveTemplates = async (businessUnit) => {
  const { rows } = await repo.findAllActive(businessUnit);
  return rows;
};

/** All non-deleted templates for the admin setup page. */
export const getAllTemplates = async (businessUnit) => {
  const { rows } = await repo.findAll(businessUnit);
  return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export const createTemplate = async (data, businessUnit, userId) => {
  const { rows } = await repo.insert({ ...data, businessUnit, userId });
  return rows[0];
};

export const updateTemplate = async (id, businessUnit, data, userId) => {
  const { rows } = await repo.updateById(id, businessUnit, data, userId);
  if (!rows[0]) throw new NotFoundError("template_not_found");
  return rows[0];
};

export const deleteTemplate = async (id, businessUnit) => {
  const { rowCount } = await repo.softDeleteById(id, businessUnit);
  if (rowCount === 0) throw new NotFoundError("template_not_found");
};

/** Bulk-updates sort_order so the admin can drag-reorder templates. */
export const reorderTemplates = async (updates, businessUnit) => {
  await repo.bulkUpdateSortOrder(updates, businessUnit);
};
