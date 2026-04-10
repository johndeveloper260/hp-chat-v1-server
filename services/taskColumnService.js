/**
 * Task Column Service
 *
 * Business logic for Kanban board columns.
 * Columns are owner-scoped: owner_type ('user' | 'team') + owner_id.
 * Auto-seeds 4 default columns if the owner has none.
 */
import * as columnRepo from "../repositories/taskColumnRepository.js";
import { NotFoundError, ValidationError } from "../errors/AppError.js";

// ─── List (auto-seed defaults) ─────────────────────────────────────────────────

export const listColumns = async ({ ownerType, ownerId, bu }) => {
  return columnRepo.findColumnsByOwner(ownerType, ownerId, bu);
};

// ─── Create ────────────────────────────────────────────────────────────────────

export const createColumn = async ({ label, color, col_order, bu, ownerType, ownerId }) => {
  return columnRepo.insertColumn({
    label, color, col_order, business_unit: bu,
    owner_type: ownerType, owner_id: ownerId,
  });
};

// ─── Update ────────────────────────────────────────────────────────────────────

export const updateColumn = async ({ id, data, ownerType, ownerId, bu }) => {
  const existing = await columnRepo.findColumnById(id, bu);
  if (!existing) throw new NotFoundError("column_not_found");

  const updated = await columnRepo.updateColumn(id, data, ownerType, ownerId, bu);
  if (!updated) throw new ValidationError("nothing_to_update");

  return updated;
};

// ─── Reorder ───────────────────────────────────────────────────────────────────

export const reorderColumns = async ({ ids, ownerType, ownerId, bu }) => {
  await columnRepo.reorderColumns(ids, ownerType, ownerId, bu);
  return columnRepo.findColumnsByOwner(ownerType, ownerId, bu);
};

// ─── Delete ────────────────────────────────────────────────────────────────────

export const deleteColumn = async ({ id, ownerType, ownerId, bu }) => {
  const existing = await columnRepo.findColumnById(id, bu);
  if (!existing) throw new NotFoundError("column_not_found");

  await columnRepo.deleteColumn(id, ownerType, ownerId, bu);
};
